import { FixtureAsrClient } from '../asr/FixtureAsrClient'
import { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame, type CaptionFrame } from '../captions/formatter'
import { summarizeLatencyBudget, type LatencySummary } from '../captions/latency'
import { applyVocabularyCorrections } from '../vocab/corrector'
import type { FixtureAsrScriptEvent, LatencyEvent, VocabularyCorrection, VocabularyEntry } from '../types'

export interface FixturePrototypeInput {
  events: FixtureAsrScriptEvent[]
  vocabulary: VocabularyEntry[]
}

export interface FixturePrototypeResult {
  frame: CaptionFrame
  corrections: VocabularyCorrection[]
  latency: LatencySummary
}

export async function runFixturePrototype(input: FixturePrototypeInput): Promise<FixturePrototypeResult> {
  const client = new FixtureAsrClient(input.events)
  const asrEvents = await client.transcribeFixture()
  const state = new CaptionState()
  const corrections: VocabularyCorrection[] = []
  const latencyEvents: LatencyEvent[] = []

  asrEvents.forEach((event, index) => {
    const seq = index + 1
    const correction = applyVocabularyCorrections(event.text, input.vocabulary)
    corrections.push(...correction.corrections)
    state.applyAsrEvent({ ...event, text: correction.text })
    latencyEvents.push(
      { seq, stage: 'audio_chunk_captured', atMs: event.startMs },
      { seq, stage: 'asr_partial_received', atMs: event.receivedAtMs },
      { seq, stage: 'caption_formatted', atMs: event.receivedAtMs + 25 },
      { seq, stage: 'display_update_sent', atMs: event.receivedAtMs + 150 },
      { seq, stage: 'glyph_visible', atMs: event.receivedAtMs + 240 },
    )
  })

  const frame = formatCaptionFrame(state.segments(), {
    title: 'G2 CAPTIONS',
    status: 'NET OK  MIC FIXTURE  ASR FIX',
    maxLines: 6,
    lineWidth: 28,
    showLiveLatencyMs: asrEvents.at(-1)?.receivedAtMs,
  })

  return { frame, corrections, latency: summarizeLatencyBudget(latencyEvents) }
}
