import { describe, expect, it } from 'vitest'
import { summarizeLatencyBudget } from '../../src/captions/latency'

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
