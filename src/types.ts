export type TranscriptStatus = 'partial' | 'final'
export type CaptionSegmentStatus = 'partial' | 'stable' | 'final' | 'corrected' | 'error'

export interface RawAsrEvent {
  vendor: string
  text: string
  status: TranscriptStatus
  startMs: number
  endMs: number
  confidence?: number
  words?: Array<{ text: string; startMs: number; endMs: number; confidence?: number; speaker?: string }>
  speaker?: string
  receivedAtMs: number
}

export interface CaptionSegment {
  id: string
  speakerLabel: string
  text: string
  status: CaptionSegmentStatus
  startMs: number
  endMs: number
  displayPriority: number
}

export interface VocabularyEntry {
  canonical: string
  aliases: string[]
  soundsLike?: string[]
  category?: string
  priority: number
}

export interface VocabularyCorrection {
  from: string
  to: string
  category?: string
}

export interface FixtureAsrScriptEvent {
  delayMs: number
  text: string
  status: TranscriptStatus
  speaker?: string
  startMs: number
  endMs: number
}

// Runtime-enumerable list of visual-only failure / state kinds. Tests iterate
// this constant to guarantee every kind has a deaf-first visual fallback;
// adding a new kind here forces the type union and exhaustive switches in
// formatVisualStatus to update.
export const VISUAL_STATUS_KINDS = [
  'mic-blocked',
  'g2-disconnected',
  'network-slow',
  'g2-mic-lost',
  'asr-lost',
  'vocab-loaded',
] as const
export type VisualStatusKind = (typeof VISUAL_STATUS_KINDS)[number]

export interface LatencyEvent {
  seq: number
  stage: 'audio_chunk_captured' | 'asr_partial_received' | 'caption_formatted' | 'display_update_sent' | 'glyph_visible'
  atMs: number
}
