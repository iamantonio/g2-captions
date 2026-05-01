import type { PcmChunk } from '../audio/pcmFixture'
import type { BenchmarkTelemetryDetails, BenchmarkTelemetryStage } from '../captions/latency'
import type { RawAsrEvent } from '../types'
import {
  buildDeepgramCloseStreamMessage,
  buildDeepgramStreamingUrl,
  mapDeepgramResultsToRawAsrEvent,
  validateDeepgramAccessToken,
  type DeepgramResultsEvent,
} from './DeepgramStreamingClient'

export interface DeepgramLiveSessionOptions {
  tokenEndpoint?: string
  streamingEndpoint?: string
  fetchImpl?: typeof fetch
  WebSocketCtor?: typeof WebSocket
  nowMs?: () => number
  onTranscript: (event: RawAsrEvent) => void
  onVisualStatus: (message: string) => void
  onTelemetry?: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  /**
   * Optional structured-error sink. Called with the original caught value
   * before the LiveSession reduces it to a visual status. Use this to wire
   * Pino on the server side or createClientLogger on the WebView side.
   */
  onError?: (stage: string, err: unknown, details?: Record<string, unknown>) => void
  keyterms?: string[]
  sleep?: (ms: number) => Promise<void>
}

interface TokenBrokerResponse {
  accessToken?: unknown
  expiresInSeconds?: unknown
}

export class DeepgramLiveSession {
  private socket: WebSocket | undefined
  private closeStatus = 'ASR CLOSED — captions paused'
  private readonly fetchImpl: typeof fetch
  private readonly WebSocketCtor: typeof WebSocket
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: DeepgramLiveSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket
    this.nowMs = options.nowMs ?? Date.now
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async connect(): Promise<void> {
    this.options.onVisualStatus('CONNECTING — token')
    this.markTelemetry('token_request_start')
    const accessToken = this.options.streamingEndpoint ? undefined : await this.fetchTemporaryToken()
    this.markTelemetry('token_request_end')

    this.options.onVisualStatus('CONNECTING — ASR')
    const url = buildDeepgramStreamingUrl({ baseUrl: this.options.streamingEndpoint, keyterms: this.options.keyterms })

    this.socket = accessToken
      ? new this.WebSocketCtor(url.toString(), ['token', accessToken])
      : new this.WebSocketCtor(url.toString())
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Deepgram WebSocket was not created'))
        return
      }
      this.socket.onopen = () => {
        this.markTelemetry('websocket_open')
        this.options.onVisualStatus('ASR CONNECTED — waiting audio')
        resolve()
      }
      this.socket.onerror = () => {
        this.markTelemetry('websocket_error')
        this.options.onVisualStatus('ASR CONNECTION FAILED — captions paused')
        reject(new Error('Deepgram WebSocket connection failed'))
      }
      this.socket.onclose = () => {
        this.markTelemetry('websocket_closed')
        this.options.onVisualStatus(this.closeStatus)
      }
      this.socket.onmessage = (event: MessageEvent) => this.handleMessage(event)
    })
  }

  async streamPcmChunks(chunks: PcmChunk[]): Promise<void> {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (!this.socket || this.socket.readyState !== openState) {
      this.options.onVisualStatus('AUDIO STREAM FAILED — ASR not connected')
      throw new Error('Deepgram WebSocket is not connected')
    }

    this.options.onVisualStatus('AUDIO FIXTURE STREAMING')
    if (chunks[0]) this.markTelemetry('first_audio_chunk_sent', { seq: chunks[0].seq })
    for (const chunk of chunks) {
      this.socket.send(chunk.data)
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
      throw new Error('Deepgram WebSocket is not connected')
    }
    this.socket.send(chunk.data)
  }

  terminate(closeStatus = 'ASR CLOSED — captions paused'): void {
    this.closeStatus = closeStatus
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (this.socket && this.socket.readyState === openState) {
      this.socket.send(buildDeepgramCloseStreamMessage())
      this.markTelemetry('provider_terminate_sent')
      this.socket = undefined
      return
    }
    this.socket?.close()
    this.socket = undefined
  }

  private async fetchTemporaryToken(): Promise<string> {
    if (!this.options.tokenEndpoint) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('Deepgram token endpoint is required when no streaming proxy endpoint is configured')
    }

    let response: Response
    try {
      response = await this.fetchImpl(this.options.tokenEndpoint, { method: 'POST' })
    } catch (err) {
      this.options.onError?.('asr_token_fetch_failed', err)
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('Deepgram token request failed', { cause: err })
    }

    if (!response.ok) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error(`Deepgram token request failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as TokenBrokerResponse
    if (typeof payload.accessToken !== 'string' || !payload.accessToken.trim()) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('Deepgram token broker returned no temporary token')
    }

    return validateDeepgramAccessToken(payload.accessToken)
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const payload = JSON.parse(String(event.data)) as DeepgramResultsEvent
      if (payload.type !== 'Results') return
      const transcript = String(payload.channel?.alternatives?.[0]?.transcript ?? '')
      if (!transcript.trim()) return
      const mapped = mapDeepgramResultsToRawAsrEvent(payload, {
        receivedAtMs: this.nowMs(),
        fallbackStartMs: this.nowMs(),
      })
      const telemetryDetails: BenchmarkTelemetryDetails = { transcript: mapped.text }
      if (mapped.speaker && mapped.speaker !== '?') telemetryDetails.speaker = mapped.speaker
      this.markTelemetry(
        mapped.status === 'final' ? 'final_transcript_received' : 'first_partial_received',
        telemetryDetails,
      )
      this.options.onTranscript(mapped)
    } catch (err) {
      this.options.onError?.('asr_message_parse_failed', err)
      this.options.onVisualStatus('ASR MESSAGE FAILED — captions paused')
    }
  }

  private markTelemetry(stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails): void {
    if (details === undefined) {
      this.options.onTelemetry?.(stage)
      return
    }
    this.options.onTelemetry?.(stage, details)
  }
}
