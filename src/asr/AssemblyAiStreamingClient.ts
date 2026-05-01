import type { RawAsrEvent } from '../types'

export const ASSEMBLYAI_STREAMING_ORIGIN = 'wss://streaming.assemblyai.com'
export const ASSEMBLYAI_STREAMING_URL = `${ASSEMBLYAI_STREAMING_ORIGIN}/v3/ws`
export const ASSEMBLYAI_DEFAULT_MODEL = 'u3-rt-pro'

export interface AssemblyAiStreamingUrlOptions {
  token: string
  sampleRate?: number
  encoding?: 'pcm_s16le' | 'pcm_mulaw'
  speechModel?: string
  speakerLabels?: boolean
  maxSpeakers?: number
  keyterms?: string[]
}

interface AssemblyAiWord {
  text?: unknown
  start?: unknown
  end?: unknown
  confidence?: unknown
  speaker?: unknown
}

export interface AssemblyAiTurnEvent {
  type?: unknown
  transcript?: unknown
  end_of_turn?: unknown
  speaker_label?: unknown
  turn_order?: unknown
  words?: AssemblyAiWord[]
}

export interface AssemblyAiTurnMapContext {
  receivedAtMs: number
  fallbackStartMs: number
}

// AssemblyAI raw API keys are 32-character hex (and never sent to the WebView).
// Reject anything that matches that shape to catch a pasted key. Also reject
// OpenAI-style sk_ / sk- prefixes as belt-and-braces against pasted credentials.
const ASSEMBLYAI_API_KEY_SHAPE = /^[a-f0-9]{32}$/i
const OPENAI_KEY_PREFIX = /^sk[_-]/i

export function validateAssemblyAiToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed || ASSEMBLYAI_API_KEY_SHAPE.test(trimmed) || OPENAI_KEY_PREFIX.test(trimmed)) {
    throw new Error('AssemblyAI streaming requires a temporary token; never embed an API key in the WebView')
  }
  return trimmed
}

export function buildAssemblyAiStreamingUrl(options: AssemblyAiStreamingUrlOptions): URL {
  const url = new URL(ASSEMBLYAI_STREAMING_URL)
  url.searchParams.set('token', validateAssemblyAiToken(options.token))
  url.searchParams.set('speech_model', options.speechModel ?? ASSEMBLYAI_DEFAULT_MODEL)
  url.searchParams.set('sample_rate', String(options.sampleRate ?? 16_000))
  url.searchParams.set('encoding', options.encoding ?? 'pcm_s16le')
  url.searchParams.set('speaker_labels', String(options.speakerLabels ?? true))

  if (options.maxSpeakers !== undefined) {
    url.searchParams.set('max_speakers', String(options.maxSpeakers))
  }

  const keyterms = (options.keyterms ?? []).map((keyterm) => keyterm.trim()).filter(Boolean)
  if (keyterms.length > 0) {
    url.searchParams.set('keyterms_prompt', JSON.stringify(keyterms))
  }

  return url
}

export function mapAssemblyAiTurnToRawAsrEvent(
  turn: AssemblyAiTurnEvent,
  context: AssemblyAiTurnMapContext,
): RawAsrEvent {
  if (turn.type !== 'Turn') {
    throw new Error(`Unsupported AssemblyAI event type: ${String(turn.type)}`)
  }

  const words = Array.isArray(turn.words)
    ? turn.words.map((word) => ({
        text: String(word.text ?? ''),
        startMs: numberOr(word.start, context.fallbackStartMs),
        endMs: numberOr(word.end, context.receivedAtMs),
        confidence: optionalNumber(word.confidence),
        speaker: optionalString(word.speaker),
      }))
    : undefined

  const firstWordStart = words?.find((word) => Number.isFinite(word.startMs))?.startMs
  const lastWordEnd =
    words === undefined ? undefined : [...words].reverse().find((word) => Number.isFinite(word.endMs))?.endMs

  return {
    vendor: 'assemblyai',
    text: String(turn.transcript ?? ''),
    status: turn.end_of_turn === true ? 'final' : 'partial',
    startMs: firstWordStart ?? context.fallbackStartMs,
    endMs: lastWordEnd ?? context.receivedAtMs,
    speaker: optionalString(turn.speaker_label) ?? '?',
    receivedAtMs: context.receivedAtMs,
    words,
  }
}

export function buildAssemblyAiTerminateMessage(): string {
  return JSON.stringify({ type: 'Terminate' })
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
