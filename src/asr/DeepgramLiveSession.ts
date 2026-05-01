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
  /**
   * Pre-shared bearer token for the local broker. Sent as Authorization
   * header on the token POST and as ?auth=<token> on the WS upgrade URL.
   */
  brokerAuthToken?: string
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
  // Tracks whether `first_audio_chunk_sent` has been marked this session.
  // Required so live-mic paths (sendPcmChunk) emit the same telemetry
  // anchor that streamPcmChunks does — without it the
  // firstPartialFromFirstAudioMs / finalTranscriptFromFirstAudioMs metrics
  // are unreachable for any browser-mic or G2 SDK session.
  private sentFirstAudioChunk = false
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
    if (this.options.brokerAuthToken) {
      url.searchParams.set('auth', this.options.brokerAuthToken)
    }

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
    if (chunks[0] && !this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunks[0].seq })
      this.sentFirstAudioChunk = true
    }
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
    if (!this.sentFirstAudioChunk) {
      this.markTelemetry('first_audio_chunk_sent', { seq: chunk.seq })
      this.sentFirstAudioChunk = true
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
    const init: RequestInit = { method: 'POST' }
    if (this.options.brokerAuthToken) {
      init.headers = { authorization: `Bearer ${this.options.brokerAuthToken}` }
    }
    try {
      response = await this.fetchImpl(this.options.tokenEndpoint, init)
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
      const speakerWordCounts = computeMultiSpeakerWordCounts(mapped.words)
      if (speakerWordCounts) telemetryDetails.speakerWordCounts = speakerWordCounts
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

/**
 * Per-speaker word counts within a single Results message — but only when
 * 2+ distinct speakers appear. The asymmetry is deliberate: a session
 * where this field never appears tells us Deepgram itself isn't
 * separating voices (model limitation). A session where it appears
 * tells us the upstream IS diarizing and our top-level speaker collapse
 * is hiding it (mapper bug). Either signal answers the question with
 * one line of telemetry — see the 2026-05-01 G2 hardware run report.
 */
export function computeMultiSpeakerWordCounts(words: RawAsrEvent['words']): Record<string, number> | undefined {
  if (!words || words.length === 0) return undefined
  const counts: Record<string, number> = {}
  for (const word of words) {
    if (word.speaker === undefined) continue
    counts[word.speaker] = (counts[word.speaker] ?? 0) + 1
  }
  return Object.keys(counts).length >= 2 ? counts : undefined
}
