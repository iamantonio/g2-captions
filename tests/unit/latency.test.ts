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
})
