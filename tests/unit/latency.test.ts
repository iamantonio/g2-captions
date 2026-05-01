import { describe, expect, it } from 'vitest'
import { createBenchmarkTelemetryRecorder, summarizeLatencyBudget } from '../../src/captions/latency'

describe('summarizeLatencyBudget', () => {
  it('computes stage deltas and flags frames over the 800ms target', () => {
    const summary = summarizeLatencyBudget([
      { seq: 1, stage: 'audio_chunk_captured', atMs: 0 },
      { seq: 1, stage: 'asr_partial_received', atMs: 330 },
      { seq: 1, stage: 'caption_formatted', atMs: 390 },
      { seq: 1, stage: 'display_update_sent', atMs: 520 },
      { seq: 1, stage: 'glyph_visible', atMs: 760 },
      { seq: 2, stage: 'audio_chunk_captured', atMs: 1000 },
      { seq: 2, stage: 'glyph_visible', atMs: 1905 },
    ])

    expect(summary.frames).toEqual([
      { seq: 1, endToEndMs: 760, withinTarget: true },
      { seq: 2, endToEndMs: 905, withinTarget: false },
    ])
    expect(summary.p95EndToEndMs).toBe(905)
    expect(summary.withinTargetRate).toBe(0.5)
  })
})

describe('BenchmarkTelemetryRecorder', () => {
  it('records ordered fixture benchmark events and builds a JSON-safe report', () => {
    const nowValues = [1000, 1010, 1100, 1200, 1984, 2100, 2300, 2310]
    const recorder = createBenchmarkTelemetryRecorder({
      provider: 'assemblyai',
      fixtureId: 'speech-smoke',
      nowMs: () => nowValues.shift() ?? 9999,
    })

    recorder.mark('token_request_start')
    recorder.mark('token_request_end')
    recorder.mark('websocket_open')
    recorder.mark('first_audio_chunk_sent', { seq: 1 })
    recorder.mark('first_partial_received', { transcript: 'ProvenMachine' })
    recorder.mark('final_audio_chunk_sent', { seq: 20 })
    recorder.mark('final_transcript_received', { transcript: 'ProvenMachine captions are ready.', speaker: 'A' })
    recorder.mark('display_update_sent')

    const report = recorder.report()

    expect(report.provider).toBe('assemblyai')
    expect(report.fixtureId).toBe('speech-smoke')
    expect(report.events.map((event) => event.stage)).toEqual([
      'token_request_start',
      'token_request_end',
      'websocket_open',
      'first_audio_chunk_sent',
      'first_partial_received',
      'final_audio_chunk_sent',
      'final_transcript_received',
      'display_update_sent',
    ])
    expect(report.metrics).toEqual({
      tokenRequestMs: 10,
      websocketOpenFromStartMs: 100,
      firstPartialFromFirstAudioMs: 784,
      finalTranscriptFromFirstAudioMs: 1100,
      displayUpdateFromFinalTranscriptMs: 10,
    })
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })

  it('returns the same memoized report when called twice without an intervening mark', () => {
    const recorder = createBenchmarkTelemetryRecorder({
      provider: 'deepgram',
      fixtureId: 'memo-test',
      nowMs: () => 100,
    })
    recorder.mark('token_request_start')
    const first = recorder.report()
    const second = recorder.report()
    expect(second).toBe(first)

    recorder.mark('token_request_end')
    const third = recorder.report()
    expect(third).not.toBe(first)
  })

  it('displayUpdateFromFinalTranscriptMs measures the render that follows the final, not the first partial render', () => {
    // Reproduces the bug observed in the 2026-05-01 G2 hardware run:
    // display_update_sent fires for partials AND finals, so picking the
    // FIRST display update produces a negative number when partials have
    // already rendered before the first final arrives. The metric must
    // pair each final with the next display_update_sent.
    const nowValues = [
      1000, // token_request_start
      1010, // token_request_end
      1050, // websocket_open
      1100, // first_audio_chunk_sent
      1500, // first_partial_received
      1500, // display_update_sent (from partial render — this would have broken the metric)
      2000, // final_transcript_received
      2010, // display_update_sent (from final render — this is what the metric should pick)
    ]
    const recorder = createBenchmarkTelemetryRecorder({
      provider: 'deepgram',
      fixtureId: 'partial-then-final',
      nowMs: () => nowValues.shift() ?? 9999,
    })

    recorder.mark('token_request_start')
    recorder.mark('token_request_end')
    recorder.mark('websocket_open')
    recorder.mark('first_audio_chunk_sent', { seq: 1 })
    recorder.mark('first_partial_received', { transcript: 'hello' })
    recorder.mark('display_update_sent')
    recorder.mark('final_transcript_received', { transcript: 'hello world' })
    recorder.mark('display_update_sent')

    const report = recorder.report()
    // 2010 (display update after final) - 2000 (final) = 10ms render lag.
    expect(report.metrics.displayUpdateFromFinalTranscriptMs).toBe(10)
    expect(report.metrics.displayUpdateFromFinalTranscriptMs).toBeGreaterThanOrEqual(0)
  })

  it('omits displayUpdateFromFinalTranscriptMs when no display update has fired since the first final', () => {
    // Partial rendered, final received, but no render happened yet — the
    // metric should be omitted rather than reaching back to the partial render.
    const nowValues = [1000, 1500, 1500, 2000]
    const recorder = createBenchmarkTelemetryRecorder({
      provider: 'deepgram',
      fixtureId: 'pending-render',
      nowMs: () => nowValues.shift() ?? 9999,
    })

    recorder.mark('token_request_start')
    recorder.mark('first_partial_received')
    recorder.mark('display_update_sent') // partial render
    recorder.mark('final_transcript_received') // final at 2000, no render after

    const report = recorder.report()
    expect(report.metrics.displayUpdateFromFinalTranscriptMs).toBeUndefined()
  })
})
