import type { RawAsrEvent, TranscriptStatus } from '../types'

export const OPENAI_REALTIME_TRANSCRIPTION_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
export const OPENAI_REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
export const OPENAI_INPUT_SAMPLE_RATE = 24_000

export interface OpenAiSessionUpdateOptions {
  language?: string
  vadThreshold?: number
  prefixPaddingMs?: number
  silenceDurationMs?: number
}

export interface OpenAiTranscriptDeltaEvent {
  type: 'conversation.item.input_audio_transcription.delta'
  item_id?: string
  content_index?: number
  delta?: unknown
}

export interface OpenAiTranscriptCompletedEvent {
  type: 'conversation.item.input_audio_transcription.completed'
  item_id?: string
  content_index?: number
  transcript?: unknown
}

export type OpenAiRealtimeEvent = OpenAiTranscriptDeltaEvent | OpenAiTranscriptCompletedEvent | { type?: unknown }

export interface OpenAiMapOptions {
  receivedAtMs: number
  fallbackStartMs: number
}

export function buildOpenAiSessionUpdateMessage(options: OpenAiSessionUpdateOptions = {}): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: OPENAI_INPUT_SAMPLE_RATE },
          transcription: {
            model: OPENAI_REALTIME_TRANSCRIPTION_MODEL,
            ...(options.language ? { language: options.language } : {}),
          },
        },
      },
    },
  })
}

export function buildOpenAiInputAudioAppendMessage(pcm16kMono: ArrayBuffer): string {
  const pcm24kMono = resamplePcm16Mono16kTo24k(pcm16kMono)
  return JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: arrayBufferToBase64(pcm24kMono),
  })
}

export function buildOpenAiCommitMessage(): string {
  return JSON.stringify({ type: 'input_audio_buffer.commit' })
}

export function resamplePcm16Mono16kTo24k(input: ArrayBuffer): ArrayBuffer {
  const source = new Int16Array(input)
  if (source.length === 0) return new ArrayBuffer(0)
  if (source.length === 1) return new Int16Array([source[0]]).buffer

  const outputLength = Math.round(source.length * 1.5)
  const output = new Int16Array(outputLength)
  for (let i = 0; i < outputLength; i += 1) {
    const sourcePosition = (i * (source.length - 1)) / (outputLength - 1)
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(source.length - 1, leftIndex + 1)
    const ratio = sourcePosition - leftIndex
    output[i] = clampPcm16(Math.round(source[leftIndex] + (source[rightIndex] - source[leftIndex]) * ratio))
  }
  return output.buffer
}

export function mapOpenAiRealtimeMessageToRawAsrEvent(
  payload: OpenAiRealtimeEvent,
  options: OpenAiMapOptions,
): RawAsrEvent | undefined {
  if (payload.type === 'conversation.item.input_audio_transcription.delta') {
    const event = payload as OpenAiTranscriptDeltaEvent
    return buildRawAsrEvent(String(event.delta ?? ''), 'partial', options)
  }
  if (payload.type === 'conversation.item.input_audio_transcription.completed') {
    const event = payload as OpenAiTranscriptCompletedEvent
    return buildRawAsrEvent(String(event.transcript ?? ''), 'final', options)
  }
  return undefined
}

function buildRawAsrEvent(text: string, status: TranscriptStatus, options: OpenAiMapOptions): RawAsrEvent | undefined {
  if (!text.trim()) return undefined
  return {
    vendor: 'openai',
    text,
    status,
    startMs: options.fallbackStartMs,
    endMs: options.receivedAtMs,
    speaker: '?',
    receivedAtMs: options.receivedAtMs,
  }
}

function clampPcm16(value: number): number {
  return Math.max(-32768, Math.min(32767, value))
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary)
  return Buffer.from(bytes).toString('base64')
}
