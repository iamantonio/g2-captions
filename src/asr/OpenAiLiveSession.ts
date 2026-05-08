import type { PcmChunk } from '../audio/pcmFixture'
import type { BenchmarkTelemetryDetails, BenchmarkTelemetryStage } from '../captions/latency'
import type { RawAsrEvent } from '../types'
import {
  buildOpenAiCommitMessage,
  buildOpenAiInputAudioAppendMessage,
  buildOpenAiSessionUpdateMessage,
  mapOpenAiRealtimeMessageToRawAsrEvent,
  type OpenAiRealtimeEvent,
} from './OpenAiRealtimeClient'

export interface OpenAiLiveSessionOptions {
  streamingEndpoint: string
  WebSocketCtor?: typeof WebSocket
  nowMs?: () => number
  onTranscript: (event: RawAsrEvent) => void
  onVisualStatus: (message: string) => void
  onTelemetry?: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  onError?: (stage: string, err: unknown, details?: Record<string, unknown>) => void
  brokerAuthToken?: string
  language?: string
  sleep?: (ms: number) => Promise<void>
  finalTranscriptWaitMs?: number
  liveCommitEveryMs?: number
}

export class OpenAiLiveSession {
  private socket: WebSocket | undefined
  private closeStatus = 'ASR CLOSED — captions paused'
  private sentFirstAudioChunk = false
  private receivedFirstPartial = false
  private pendingFinalTranscript: (() => void) | undefined
  private liveAudioSinceLastCommitMs = 0
  private readonly WebSocketCtor: typeof WebSocket
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: OpenAiLiveSessionOptions) {
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket
    this.nowMs = options.nowMs ?? Date.now
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async connect(): Promise<void> {
    this.options.onVisualStatus('CONNECTING — OpenAI ASR')
    const url = new URL(this.options.streamingEndpoint)
    if (this.options.brokerAuthToken) url.searchParams.set('auth', this.options.brokerAuthToken)

    this.socket = new this.WebSocketCtor(url.toString())
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('OpenAI WebSocket was not created'))
        return
      }
      this.socket.onopen = () => {
        this.markTelemetry('websocket_open')
        this.socket?.send(buildOpenAiSessionUpdateMessage({ language: this.options.language }))
        this.options.onVisualStatus('OPENAI ASR CONNECTED — waiting audio')
        resolve()
      }
      this.socket.onerror = () => {
        this.markTelemetry('websocket_error')
        this.options.onVisualStatus('OPENAI ASR CONNECTION FAILED — captions paused')
        reject(new Error('OpenAI WebSocket connection failed'))
      }
      this.socket.onclose = () => {
        this.markTelemetry('websocket_closed')
        this.options.onVisualStatus(this.closeStatus)
      }
      this.socket.onmessage = (event: MessageEvent) => this.handleMessage(event)
    })
  }

  async streamPcmChunks(chunks: PcmChunk[]): Promise<void> {
    this.assertConnected()
    this.options.onVisualStatus('AUDIO FIXTURE STREAMING')
    if (chunks[0] && !this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunks[0].seq })
      this.sentFirstAudioChunk = true
    }
    for (const chunk of chunks) {
      this.socket?.send(buildOpenAiInputAudioAppendMessage(chunk.data))
      await this.sleep(chunk.durationMs)
    }
    const finalChunk = chunks.at(-1)
    if (finalChunk) this.markTelemetry('final_audio_chunk_sent', { seq: finalChunk.seq })
    this.socket?.send(buildOpenAiCommitMessage())
    this.options.onVisualStatus('AUDIO FIXTURE SENT — waiting ASR')
    await this.waitForFinalTranscript()
  }

  async sendPcmChunk(chunk: PcmChunk): Promise<void> {
    this.assertConnected()
    if (!this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunk.seq })
      this.sentFirstAudioChunk = true
    }
    this.socket?.send(buildOpenAiInputAudioAppendMessage(chunk.data))
    this.liveAudioSinceLastCommitMs += chunk.durationMs
    if (this.shouldCommitLiveAudio()) {
      this.socket?.send(buildOpenAiCommitMessage())
      this.markTelemetry('provider_commit_sent', { seq: chunk.seq })
      this.liveAudioSinceLastCommitMs = 0
    }
  }

  private shouldCommitLiveAudio(): boolean {
    const everyMs = this.options.liveCommitEveryMs
    return typeof everyMs === 'number' && everyMs > 0 && this.liveAudioSinceLastCommitMs >= everyMs
  }

  terminate(closeStatus = 'ASR CLOSED — captions paused'): void {
    this.closeStatus = closeStatus
    this.socket?.close()
    this.socket = undefined
  }

  private assertConnected(): void {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (!this.socket || this.socket.readyState !== openState) {
      this.options.onVisualStatus('AUDIO STREAM FAILED — ASR not connected')
      throw new Error('OpenAI WebSocket is not connected')
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const payload = JSON.parse(String(event.data)) as OpenAiRealtimeEvent
      const mapped = mapOpenAiRealtimeMessageToRawAsrEvent(payload, {
        receivedAtMs: this.nowMs(),
        fallbackStartMs: this.nowMs(),
      })
      if (!mapped) return
      const telemetryDetails: BenchmarkTelemetryDetails = { transcript: mapped.text }
      if (mapped.status === 'final') {
        this.markTelemetry('final_transcript_received', telemetryDetails)
        this.pendingFinalTranscript?.()
        this.pendingFinalTranscript = undefined
      } else if (!this.receivedFirstPartial) {
        this.receivedFirstPartial = true
        this.markTelemetry('first_partial_received', telemetryDetails)
      } else {
        this.markTelemetry('partial_transcript_received', telemetryDetails)
      }
      this.options.onTranscript(mapped)
    } catch (err) {
      this.options.onError?.('asr_message_parse_failed', err)
      this.options.onVisualStatus('OPENAI ASR MESSAGE FAILED — captions paused')
    }
  }

  private waitForFinalTranscript(): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingFinalTranscript = undefined
        resolve()
      }, this.options.finalTranscriptWaitMs ?? 4_000)
      this.pendingFinalTranscript = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
  }

  private markTelemetry(stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails): void {
    if (details === undefined) {
      this.options.onTelemetry?.(stage)
      return
    }
    this.options.onTelemetry?.(stage, details)
  }
}
