import type { RawAsrEvent } from '../types'

export const DEEPGRAM_STREAMING_ORIGIN = 'wss://api.deepgram.com'
export const DEEPGRAM_STREAMING_URL = `${DEEPGRAM_STREAMING_ORIGIN}/v1/listen`
export const DEEPGRAM_DEFAULT_MODEL = 'nova-3'

export interface DeepgramStreamingUrlOptions {
  baseUrl?: string
  sampleRate?: number
  encoding?: 'linear16' | 'mulaw'
  model?: string
  channels?: number
  interimResults?: boolean
  punctuate?: boolean
  smartFormat?: boolean
  diarize?: boolean
  keyterms?: string[]
  endpointing?: number | boolean
}

interface DeepgramWord {
  word?: unknown
  punctuated_word?: unknown
  start?: unknown
  end?: unknown
  confidence?: unknown
  speaker?: unknown
}

interface DeepgramAlternative {
  transcript?: unknown
  confidence?: unknown
  words?: DeepgramWord[]
}

export interface DeepgramResultsEvent {
  type?: unknown
  is_final?: unknown
  speech_final?: unknown
  start?: unknown
  duration?: unknown
  channel?: { alternatives?: DeepgramAlternative[] }
}

export interface DeepgramMapContext {
  receivedAtMs: number
  fallbackStartMs: number
}

export function validateDeepgramAccessToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed || trimmed === '***') {
    throw new Error('Deepgram streaming requires a temporary token; never embed an API key in the WebView')
  }
  return trimmed
}

export function buildDeepgramStreamingUrl(options: DeepgramStreamingUrlOptions = {}): URL {
  const url = new URL(options.baseUrl ?? DEEPGRAM_STREAMING_URL)
  url.searchParams.set('model', options.model ?? DEEPGRAM_DEFAULT_MODEL)
  url.searchParams.set('encoding', options.encoding ?? 'linear16')
  url.searchParams.set('sample_rate', String(options.sampleRate ?? 16_000))
  url.searchParams.set('channels', String(options.channels ?? 1))
  url.searchParams.set('interim_results', String(options.interimResults ?? true))
  url.searchParams.set('punctuate', String(options.punctuate ?? true))
  url.searchParams.set('smart_format', String(options.smartFormat ?? true))
  url.searchParams.set('diarize', String(options.diarize ?? true))
  url.searchParams.set('endpointing', String(options.endpointing ?? 250))

  for (const keyterm of (options.keyterms ?? []).map((entry) => entry.trim()).filter(Boolean)) {
    url.searchParams.append('keyterm', keyterm)
  }

  return url
}

export function mapDeepgramResultsToRawAsrEvent(
  result: DeepgramResultsEvent,
  context: DeepgramMapContext,
): RawAsrEvent {
  if (result.type !== 'Results') {
    throw new Error(`Unsupported Deepgram event type: ${String(result.type)}`)
  }

  const alternative = result.channel?.alternatives?.[0]
  const words = Array.isArray(alternative?.words)
    ? alternative.words.map((word) => ({
        text: String(word.punctuated_word ?? word.word ?? ''),
        startMs: secondsToMsOr(word.start, context.fallbackStartMs),
        endMs: secondsToMsOr(word.end, context.receivedAtMs),
        confidence: optionalNumber(word.confidence),
        speaker: optionalSpeaker(word.speaker),
      }))
    : undefined

  const firstWordStart = words?.find((word) => Number.isFinite(word.startMs))?.startMs
  const lastWordEnd = words === undefined ? undefined : [...words].reverse().find((word) => Number.isFinite(word.endMs))?.endMs
  const startMs = firstWordStart ?? secondsToMsOr(result.start, context.fallbackStartMs)
  const endMs = lastWordEnd ?? endFromResultTiming(result, startMs, context.receivedAtMs)

  return {
    vendor: 'deepgram',
    text: String(alternative?.transcript ?? ''),
    status: result.is_final === true || result.speech_final === true ? 'final' : 'partial',
    startMs,
    endMs,
    confidence: optionalNumber(alternative?.confidence),
    speaker: words?.find((word) => word.speaker !== undefined)?.speaker ?? '?',
    receivedAtMs: context.receivedAtMs,
    words,
  }
}

export function buildDeepgramCloseStreamMessage(): string {
  return JSON.stringify({ type: 'CloseStream' })
}

function endFromResultTiming(result: DeepgramResultsEvent, startMs: number, fallback: number): number {
  if (typeof result.start === 'number' && Number.isFinite(result.start) && typeof result.duration === 'number' && Number.isFinite(result.duration)) {
    return Math.round((result.start + result.duration) * 1000)
  }
  return startMs === fallback ? fallback : Math.max(startMs, fallback)
}

function secondsToMsOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalSpeaker(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}
