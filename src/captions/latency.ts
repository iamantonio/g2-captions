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
