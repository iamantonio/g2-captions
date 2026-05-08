import type { PcmChunk } from '../audio/pcmFixture'
import type { BenchmarkTelemetryDetails, BenchmarkTelemetryStage } from '../captions/latency'
import type { RawAsrEvent } from '../types'
import {
  buildElevenLabsInputAudioChunkMessage,
  buildElevenLabsRealtimeUrl,
  isElevenLabsErrorMessage,
  mapElevenLabsRealtimeMessageToRawAsrEvent,
  type ElevenLabsRealtimeMessage,
  type ElevenLabsRealtimeUrlOptions,
} from './ElevenLabsStreamingClient'

export interface ElevenLabsLiveSessionOptions {
  tokenEndpoint: string
  streamingEndpoint?: string
  fetchImpl?: typeof fetch
  WebSocketCtor?: typeof WebSocket
  nowMs?: () => number
  onTranscript: (event: RawAsrEvent) => void
  onVisualStatus: (message: string) => void
  onTelemetry?: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  onError?: (stage: string, err: unknown, details?: Record<string, unknown>) => void
  brokerAuthToken?: string
  keyterms?: string[]
  realtimeOptions?: Omit<ElevenLabsRealtimeUrlOptions, 'baseUrl' | 'token' | 'keyterms'>
  manualCommitEveryChunks?: number
  sleep?: (ms: number) => Promise<void>
}

interface TokenBrokerResponse {
  token?: unknown
  expiresInSeconds?: unknown
}

export class ElevenLabsLiveSession {
  private socket: WebSocket | undefined
  private closeStatus = 'ASR CLOSED — captions paused'
  private sentFirstAudioChunk = false
  private receivedFirstPartial = false
  private lastFinalTranscript = ''
  private audioChunksSent = 0
  private readonly fetchImpl: typeof fetch
  private readonly WebSocketCtor: typeof WebSocket
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: ElevenLabsLiveSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket
    this.nowMs = options.nowMs ?? Date.now
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async connect(): Promise<void> {
    this.options.onVisualStatus('CONNECTING — token')
    this.markTelemetry('token_request_start')
    const token = await this.fetchSingleUseToken()
    this.markTelemetry('token_request_end')

    this.options.onVisualStatus('CONNECTING — ASR')
    const url = buildElevenLabsRealtimeUrl({
      ...this.options.realtimeOptions,
      baseUrl: this.options.streamingEndpoint,
      token,
      keyterms: this.options.keyterms,
    })

    this.socket = new this.WebSocketCtor(url.toString())
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('ElevenLabs WebSocket was not created'))
        return
      }
      this.socket.onopen = () => {
        this.markTelemetry('websocket_open')
        this.options.onVisualStatus('ASR CONNECTED — waiting audio')
        resolve()
      }
      this.socket.onerror = (event) => {
        const details = this.getWebSocketErrorTelemetryDetails(event)
        this.markTelemetry('websocket_error', details)
        this.options.onError?.('asr_websocket_error', new Error('ElevenLabs WebSocket error'), {
          provider: 'elevenlabs',
          ...details,
        })
        this.options.onVisualStatus('ASR CONNECTION FAILED — captions paused')
        reject(new Error('ElevenLabs WebSocket connection failed'))
      }
      this.socket.onclose = (event) => {
        this.markTelemetry('websocket_closed', this.getWebSocketCloseTelemetryDetails(event))
        this.options.onVisualStatus(this.closeStatus)
      }
      this.socket.onmessage = (event: MessageEvent) => this.handleMessage(event)
    })
  }

  async streamPcmChunks(chunks: PcmChunk[]): Promise<void> {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (!this.socket || this.socket.readyState !== openState) {
      this.options.onVisualStatus('AUDIO STREAM FAILED — ASR not connected')
      throw new Error('ElevenLabs WebSocket is not connected')
    }

    this.options.onVisualStatus('AUDIO FIXTURE STREAMING')
    if (chunks[0] && !this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunks[0].seq })
      this.sentFirstAudioChunk = true
    }
    for (const chunk of chunks) {
      this.socket.send(
        buildElevenLabsInputAudioChunkMessage({
          data: chunk.data,
          sampleRate: 16_000,
          commit: this.shouldCommitChunk(),
        }),
      )
      await this.sleep(chunk.durationMs)
    }
    const finalChunk = chunks.at(-1)
    if (finalChunk) this.markTelemetry('final_audio_chunk_sent', { seq: finalChunk.seq })
    this.options.onVisualStatus('AUDIO FIXTURE SENT — waiting ASR')
  }

  async sendPcmChunk(chunk: PcmChunk): Promise<void> {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (!this.socket || this.socket.readyState !== openState) {
      this.options.onVisualStatus('AUDIO STREAM FAILED — ASR not connected')
      throw new Error('ElevenLabs WebSocket is not connected')
    }
    if (!this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunk.seq })
      this.sentFirstAudioChunk = true
    }
    this.socket.send(
      buildElevenLabsInputAudioChunkMessage({ data: chunk.data, sampleRate: 16_000, commit: this.shouldCommitChunk() }),
    )
  }

  terminate(closeStatus = 'ASR CLOSED — captions paused'): void {
    this.closeStatus = closeStatus
    this.socket?.close()
    this.socket = undefined
  }

  private async fetchSingleUseToken(): Promise<string> {
    let response: Response
    const init: RequestInit = { method: 'POST' }
    if (this.options.brokerAuthToken) {
      init.headers = { authorization: `Bearer ${this.options.brokerAuthToken}` }
    }
    try {
      response = await this.fetchImpl(this.options.tokenEndpoint, init)
    } catch (err) {
      this.options.onError?.('asr_token_fetch_failed', err)
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('ElevenLabs token request failed', { cause: err })
    }

    if (!response.ok) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error(`ElevenLabs token request failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as TokenBrokerResponse
    if (typeof payload.token !== 'string' || !payload.token.trim()) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('ElevenLabs token broker returned no single-use token')
    }
    return payload.token.trim()
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const payload = JSON.parse(String(event.data)) as ElevenLabsRealtimeMessage
      const messageType = String(payload.message_type ?? '')
      if (isElevenLabsErrorMessage(payload)) {
        const err = new Error(`ElevenLabs realtime error: ${messageType}`)
        this.options.onError?.('asr_provider_error', err, { provider: 'elevenlabs', messageType })
        this.options.onVisualStatus('ASR PROVIDER ERROR — captions paused')
        return
      }
      if (
        messageType !== 'partial_transcript' &&
        messageType !== 'committed_transcript' &&
        messageType !== 'committed_transcript_with_timestamps'
      ) {
        return
      }
      if (typeof payload.text !== 'string' || !payload.text.trim()) return
      const mapped = mapElevenLabsRealtimeMessageToRawAsrEvent(payload, {
        receivedAtMs: this.nowMs(),
        fallbackStartMs: this.nowMs(),
      })
      if (mapped.status === 'final' && mapped.text.trim() === this.lastFinalTranscript) return
      const telemetryStage = this.getTranscriptTelemetryStage(mapped.status)
      if (mapped.status === 'final') this.lastFinalTranscript = mapped.text.trim()
      this.markTelemetry(telemetryStage, {
        transcript: mapped.text,
        ...(mapped.speaker && mapped.speaker !== '?' ? { speaker: mapped.speaker } : {}),
      })
      this.options.onTranscript(mapped)
    } catch (err) {
      this.options.onError?.('asr_message_parse_failed', err)
      this.options.onVisualStatus('ASR MESSAGE FAILED — captions paused')
    }
  }

  private getTranscriptTelemetryStage(status: RawAsrEvent['status']): BenchmarkTelemetryStage {
    if (status === 'final') return 'final_transcript_received'
    if (this.receivedFirstPartial) return 'partial_transcript_received'
    this.receivedFirstPartial = true
    return 'first_partial_received'
  }

  private shouldCommitChunk(): boolean {
    this.audioChunksSent += 1
    if (this.options.realtimeOptions?.commitStrategy !== 'manual') return false
    const everyChunks = Math.max(1, Math.round(this.options.manualCommitEveryChunks ?? 1))
    return this.audioChunksSent % everyChunks === 0
  }

  private getWebSocketErrorTelemetryDetails(event: Event): BenchmarkTelemetryDetails {
    const details: BenchmarkTelemetryDetails = { eventType: event.type || 'error' }
    const message = this.readEventStringProperty(event, 'message')
    if (message) details.message = this.redactDiagnosticText(message)
    return details
  }

  private getWebSocketCloseTelemetryDetails(event: CloseEvent): BenchmarkTelemetryDetails {
    const details: BenchmarkTelemetryDetails = {
      closeCode: event.code,
      closeWasClean: event.wasClean,
    }
    if (event.reason) details.closeReason = this.redactDiagnosticText(event.reason)
    return details
  }

  private readEventStringProperty(event: Event, propertyName: string): string | undefined {
    const value = (event as unknown as Record<string, unknown>)[propertyName]
    return typeof value === 'string' && value.trim() ? value : undefined
  }

  private redactDiagnosticText(value: string): string {
    return value
      .replace(/\btoken=([^\s&]+)/gi, 'token=[REDACTED]')
      .replace(/\bapi[_-]?key=([^\s&]+)/gi, 'api_key=[REDACTED]')
      .replace(/\bauthorization:\s*bearer\s+[^\s]+/gi, 'authorization: bearer [REDACTED]')
  }

  private markTelemetry(stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails): void {
    if (details === undefined) {
      this.options.onTelemetry?.(stage)
      return
    }
    this.options.onTelemetry?.(stage, details)
  }
}
