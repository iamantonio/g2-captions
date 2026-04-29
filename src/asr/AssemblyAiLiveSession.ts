import type { PcmChunk } from '../audio/pcmFixture'
import type { BenchmarkTelemetryDetails, BenchmarkTelemetryStage } from '../captions/latency'
import type { RawAsrEvent } from '../types'
import {
  buildAssemblyAiStreamingUrl,
  buildAssemblyAiTerminateMessage,
  mapAssemblyAiTurnToRawAsrEvent,
  type AssemblyAiTurnEvent,
} from './AssemblyAiStreamingClient'

export interface AssemblyAiLiveSessionOptions {
  tokenEndpoint: string
  fetchImpl?: typeof fetch
  WebSocketCtor?: typeof WebSocket
  nowMs?: () => number
  onTranscript: (event: RawAsrEvent) => void
  onVisualStatus: (message: string) => void
  onTelemetry?: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  keyterms?: string[]
  maxSpeakers?: number
  sleep?: (ms: number) => Promise<void>
}

interface TokenBrokerResponse {
  token?: unknown
  expiresInSeconds?: unknown
}

export class AssemblyAiLiveSession {
  private socket: WebSocket | undefined
  private readonly fetchImpl: typeof fetch
  private readonly WebSocketCtor: typeof WebSocket
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: AssemblyAiLiveSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket
    this.nowMs = options.nowMs ?? Date.now
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async connect(): Promise<void> {
    this.options.onVisualStatus('CONNECTING — token')
    this.markTelemetry('token_request_start')
    const token = await this.fetchTemporaryToken()
    this.markTelemetry('token_request_end')

    this.options.onVisualStatus('CONNECTING — ASR')
    const url = buildAssemblyAiStreamingUrl({
      token,
      keyterms: this.options.keyterms,
      maxSpeakers: this.options.maxSpeakers ?? 2,
    })

    this.socket = new this.WebSocketCtor(url.toString())
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('AssemblyAI WebSocket was not created'))
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
        reject(new Error('AssemblyAI WebSocket connection failed'))
      }
      this.socket.onclose = () => {
        this.markTelemetry('websocket_closed')
        this.options.onVisualStatus('ASR CLOSED — captions paused')
      }
      this.socket.onmessage = (event: MessageEvent) => this.handleMessage(event)
    })
  }

  async streamPcmChunks(chunks: PcmChunk[]): Promise<void> {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (!this.socket || this.socket.readyState !== openState) {
      this.options.onVisualStatus('AUDIO STREAM FAILED — ASR not connected')
      throw new Error('AssemblyAI WebSocket is not connected')
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

  terminate(): void {
    const openState = this.WebSocketCtor.OPEN ?? 1
    if (this.socket && this.socket.readyState === openState) {
      this.socket.send(buildAssemblyAiTerminateMessage())
      this.markTelemetry('provider_terminate_sent')
      this.socket = undefined
      return
    }
    this.socket?.close()
    this.socket = undefined
  }

  private async fetchTemporaryToken(): Promise<string> {
    let response: Response
    try {
      response = await this.fetchImpl(this.options.tokenEndpoint, { method: 'POST' })
    } catch (error) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('AssemblyAI token request failed')
    }

    if (!response.ok) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error(`AssemblyAI token request failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as TokenBrokerResponse
    if (typeof payload.token !== 'string' || !payload.token.trim()) {
      this.options.onVisualStatus('ASR TOKEN FAILED — check broker')
      throw new Error('AssemblyAI token broker returned no temporary token')
    }

    return payload.token
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const payload = JSON.parse(String(event.data)) as AssemblyAiTurnEvent
      if (payload.type !== 'Turn') return
      const telemetryDetails: BenchmarkTelemetryDetails = { transcript: String(payload.transcript ?? '') }
      if (typeof payload.speaker_label === 'string' && payload.speaker_label.trim()) {
        telemetryDetails.speaker = payload.speaker_label
      }
      this.markTelemetry(payload.end_of_turn ? 'final_transcript_received' : 'first_partial_received', telemetryDetails)
      this.options.onTranscript(
        mapAssemblyAiTurnToRawAsrEvent(payload, {
          receivedAtMs: this.nowMs(),
          fallbackStartMs: this.nowMs(),
        }),
      )
    } catch (error) {
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
