import type { RawAsrEvent } from '../types'

export const ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
export const ELEVENLABS_REALTIME_MODEL = 'scribe_v2_realtime'

export interface ElevenLabsRealtimeUrlOptions {
  baseUrl?: string
  token?: string
  modelId?: string
  audioFormat?: 'pcm_8000' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100' | 'pcm_48000' | 'ulaw_8000'
  includeTimestamps?: boolean
  includeLanguageDetection?: boolean
  languageCode?: string
  commitStrategy?: 'manual' | 'vad'
  keyterms?: string[]
  noVerbatim?: boolean
  vadSilenceThresholdSecs?: number
  vadThreshold?: number
  minSpeechDurationMs?: number
  minSilenceDurationMs?: number
  enableLogging?: boolean
}

export interface ElevenLabsInputAudioChunkOptions {
  data: ArrayBuffer
  sampleRate: number
  commit: boolean
  previousText?: string
}

interface ElevenLabsWord {
  text?: unknown
  start?: unknown
  end?: unknown
  type?: unknown
  speaker_id?: unknown
  logprob?: unknown
}

export interface ElevenLabsRealtimeMessage {
  message_type?: unknown
  text?: unknown
  language_code?: unknown
  words?: ElevenLabsWord[] | null
  error?: unknown
}

export interface ElevenLabsMapContext {
  receivedAtMs: number
  fallbackStartMs: number
}

export function buildElevenLabsRealtimeUrl(options: ElevenLabsRealtimeUrlOptions = {}): URL {
  const url = new URL(options.baseUrl ?? ELEVENLABS_REALTIME_URL)
  url.searchParams.set('model_id', options.modelId ?? ELEVENLABS_REALTIME_MODEL)
  url.searchParams.set('audio_format', options.audioFormat ?? 'pcm_16000')
  url.searchParams.set('include_timestamps', String(options.includeTimestamps ?? true))
  url.searchParams.set('commit_strategy', options.commitStrategy ?? 'vad')

  if (options.token?.trim()) url.searchParams.set('token', options.token.trim())
  if (options.includeLanguageDetection !== undefined) {
    url.searchParams.set('include_language_detection', String(options.includeLanguageDetection))
  }
  if (options.languageCode?.trim()) url.searchParams.set('language_code', options.languageCode.trim())
  if (options.noVerbatim !== undefined) url.searchParams.set('no_verbatim', String(options.noVerbatim))
  if (options.vadSilenceThresholdSecs !== undefined) {
    url.searchParams.set('vad_silence_threshold_secs', String(options.vadSilenceThresholdSecs))
  }
  if (options.vadThreshold !== undefined) url.searchParams.set('vad_threshold', String(options.vadThreshold))
  if (options.minSpeechDurationMs !== undefined) {
    url.searchParams.set('min_speech_duration_ms', String(options.minSpeechDurationMs))
  }
  if (options.minSilenceDurationMs !== undefined) {
    url.searchParams.set('min_silence_duration_ms', String(options.minSilenceDurationMs))
  }
  if (options.enableLogging !== undefined) url.searchParams.set('enable_logging', String(options.enableLogging))

  for (const keyterm of (options.keyterms ?? []).map((entry) => entry.trim()).filter(Boolean)) {
    url.searchParams.append('keyterms', keyterm)
  }

  return url
}

export function buildElevenLabsInputAudioChunkMessage(options: ElevenLabsInputAudioChunkOptions): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: arrayBufferToBase64(options.data),
    commit: options.commit,
    sample_rate: options.sampleRate,
    ...(options.previousText ? { previous_text: options.previousText } : {}),
  })
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function mapElevenLabsRealtimeMessageToRawAsrEvent(
  message: ElevenLabsRealtimeMessage,
  context: ElevenLabsMapContext,
): RawAsrEvent {
  const messageType = String(message.message_type ?? '')
  if (
    messageType !== 'partial_transcript' &&
    messageType !== 'committed_transcript' &&
    messageType !== 'committed_transcript_with_timestamps'
  ) {
    throw new Error(`Unsupported ElevenLabs event type: ${messageType}`)
  }

  const words = Array.isArray(message.words)
    ? message.words
        .filter((word) => word.type === 'word')
        .map((word) => ({
          text: String(word.text ?? ''),
          startMs: secondsToMsOr(word.start, context.fallbackStartMs),
          endMs: secondsToMsOr(word.end, context.receivedAtMs),
          confidence: optionalNumber(word.logprob),
          speaker: optionalSpeaker(word.speaker_id),
        }))
    : undefined

  const firstWordStart = words?.find((word) => Number.isFinite(word.startMs))?.startMs
  const lastWordEnd =
    words === undefined ? undefined : [...words].reverse().find((word) => Number.isFinite(word.endMs))?.endMs
  const startMs = firstWordStart ?? context.fallbackStartMs
  const endMs = lastWordEnd ?? Math.max(startMs, context.receivedAtMs)

  return {
    vendor: 'elevenlabs',
    text: String(message.text ?? ''),
    status: messageType === 'partial_transcript' ? 'partial' : 'final',
    startMs,
    endMs,
    speaker: words?.find((word) => word.speaker !== undefined)?.speaker ?? '?',
    receivedAtMs: context.receivedAtMs,
    words,
  }
}

export function isElevenLabsErrorMessage(message: ElevenLabsRealtimeMessage): boolean {
  return [
    'error',
    'auth_error',
    'quota_exceeded',
    'commit_throttled',
    'unaccepted_terms',
    'rate_limited',
    'queue_overflow',
    'resource_exhausted',
    'session_time_limit_exceeded',
    'input_error',
    'chunk_size_exceeded',
    'insufficient_audio_activity',
    'transcriber_error',
  ].includes(String(message.message_type ?? ''))
}

function secondsToMsOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalSpeaker(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
