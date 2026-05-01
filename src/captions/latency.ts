import type { LatencyEvent } from '../types'

export interface LatencyFrameSummary {
  seq: number
  endToEndMs: number
  withinTarget: boolean
}

export interface LatencySummary {
  frames: LatencyFrameSummary[]
  p95EndToEndMs: number
  withinTargetRate: number
}

const TARGET_MS = 800

export type BenchmarkTelemetryStage =
  | 'token_request_start'
  | 'token_request_end'
  | 'websocket_open'
  | 'first_audio_chunk_sent'
  | 'final_audio_chunk_sent'
  | 'provider_terminate_sent'
  | 'first_partial_received'
  | 'final_transcript_received'
  | 'caption_formatted'
  | 'display_update_sent'
  | 'websocket_closed'
  | 'websocket_error'

export interface BenchmarkTelemetryDetails {
  seq?: number
  transcript?: string
  speaker?: string
  message?: string
}

export interface BenchmarkTelemetryEvent extends BenchmarkTelemetryDetails {
  stage: BenchmarkTelemetryStage
  atMs: number
}

export interface BenchmarkTelemetryMetrics {
  tokenRequestMs?: number
  websocketOpenFromStartMs?: number
  firstPartialFromFirstAudioMs?: number
  finalTranscriptFromFirstAudioMs?: number
  displayUpdateFromFinalTranscriptMs?: number
}

export interface BenchmarkTelemetryReport {
  provider: string
  fixtureId: string
  startedAtMs: number
  events: BenchmarkTelemetryEvent[]
  metrics: BenchmarkTelemetryMetrics
}

export interface BenchmarkTelemetryRecorderOptions {
  provider: string
  fixtureId: string
  nowMs?: () => number
}

export interface BenchmarkTelemetryRecorder {
  mark: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  report: () => BenchmarkTelemetryReport
}

export function createBenchmarkTelemetryRecorder(
  options: BenchmarkTelemetryRecorderOptions,
): BenchmarkTelemetryRecorder {
  const nowMs = options.nowMs ?? Date.now
  const events: BenchmarkTelemetryEvent[] = []
  let cached: BenchmarkTelemetryReport | undefined
  let cachedAtLength = -1

  return {
    mark(stage, details = {}) {
      events.push({ stage, atMs: nowMs(), ...details })
      cached = undefined
    },
    report() {
      if (cached && cachedAtLength === events.length) return cached
      const snapshot = events.map((event) => ({ ...event }))
      cached = {
        provider: options.provider,
        fixtureId: options.fixtureId,
        startedAtMs: snapshot[0]?.atMs ?? nowMs(),
        events: snapshot,
        metrics: calculateBenchmarkTelemetryMetrics(snapshot),
      }
      cachedAtLength = events.length
      return cached
    },
  }
}

function calculateBenchmarkTelemetryMetrics(events: BenchmarkTelemetryEvent[]): BenchmarkTelemetryMetrics {
  const first = (stage: BenchmarkTelemetryStage) => events.find((event) => event.stage === stage)
  // For metrics like "render after final", the relevant display_update_sent
  // is the one that fired AFTER the final, not the first one in the session.
  // display_update_sent fires for partials too, so first() across the whole
  // session would beat the first final by definition and produce a negative.
  const firstAfter = (stage: BenchmarkTelemetryStage, after: BenchmarkTelemetryEvent) =>
    events.find((event) => event.stage === stage && event.atMs >= after.atMs)
  const tokenStart = first('token_request_start')
  const tokenEnd = first('token_request_end')
  const websocketOpen = first('websocket_open')
  const firstAudio = first('first_audio_chunk_sent')
  const firstPartial = first('first_partial_received')
  const finalTranscript = first('final_transcript_received')
  const displayUpdateAfterFinal = finalTranscript ? firstAfter('display_update_sent', finalTranscript) : undefined

  return {
    ...(tokenStart && tokenEnd ? { tokenRequestMs: tokenEnd.atMs - tokenStart.atMs } : {}),
    ...(tokenStart && websocketOpen ? { websocketOpenFromStartMs: websocketOpen.atMs - tokenStart.atMs } : {}),
    ...(firstAudio && firstPartial ? { firstPartialFromFirstAudioMs: firstPartial.atMs - firstAudio.atMs } : {}),
    ...(firstAudio && finalTranscript
      ? { finalTranscriptFromFirstAudioMs: finalTranscript.atMs - firstAudio.atMs }
      : {}),
    ...(finalTranscript && displayUpdateAfterFinal
      ? { displayUpdateFromFinalTranscriptMs: displayUpdateAfterFinal.atMs - finalTranscript.atMs }
      : {}),
  }
}

export function summarizeLatencyBudget(events: LatencyEvent[]): LatencySummary {
  const bySeq = new Map<number, LatencyEvent[]>()
  for (const event of events) {
    const existing = bySeq.get(event.seq) ?? []
    existing.push(event)
    bySeq.set(event.seq, existing)
  }

  const frames: LatencyFrameSummary[] = [...bySeq.entries()]
    .map(([seq, seqEvents]) => {
      const start = seqEvents.find((event) => event.stage === 'audio_chunk_captured')
      const end = seqEvents.find((event) => event.stage === 'glyph_visible')
      if (!start || !end) return undefined
      const endToEndMs = end.atMs - start.atMs
      return { seq, endToEndMs, withinTarget: endToEndMs <= TARGET_MS }
    })
    .filter((frame): frame is LatencyFrameSummary => Boolean(frame))
    .sort((a, b) => a.seq - b.seq)

  const sorted = frames.map((frame) => frame.endToEndMs).sort((a, b) => a - b)
  const p95Index = sorted.length === 0 ? -1 : Math.ceil(sorted.length * 0.95) - 1
  const p95EndToEndMs = p95Index >= 0 ? sorted[p95Index] : 0
  const withinTargetRate = frames.length === 0 ? 0 : frames.filter((frame) => frame.withinTarget).length / frames.length
  return { frames, p95EndToEndMs, withinTargetRate }
}
