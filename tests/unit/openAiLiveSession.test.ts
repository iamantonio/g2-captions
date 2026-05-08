import { describe, expect, it, vi } from 'vitest'
import { OpenAiLiveSession } from '../../src/asr/OpenAiLiveSession'
import {
  buildOpenAiCommitMessage,
  buildOpenAiInputAudioAppendMessage,
  buildOpenAiSessionUpdateMessage,
} from '../../src/asr/OpenAiRealtimeClient'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly sent: Array<string | ArrayBuffer> = []
  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

describe('OpenAiLiveSession', () => {
  it('opens only the broker streaming endpoint, sends session config, maps transcript events, and closes cleanly', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const onVisualStatus = vi.fn()
    const session = new OpenAiLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/openai/transcribe',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 1_000,
      onTranscript,
      onVisualStatus,
      language: 'en',
    })

    await session.connect()

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:8787/openai/transcribe')
    expect(FakeWebSocket.instances[0].sent[0]).toBe(buildOpenAiSessionUpdateMessage({ language: 'en' }))
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — OpenAI ASR')
    expect(onVisualStatus).toHaveBeenCalledWith('OPENAI ASR CONNECTED — waiting audio')

    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item_1',
          transcript: 'hello Tony',
        }),
      }),
    )
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'openai', text: 'hello Tony', status: 'final', speaker: '?' }),
    )

    session.terminate('ASR TERMINATED')
    expect(FakeWebSocket.instances[0].readyState).toBe(3)
  })

  it('sends resampled JSON/base64 audio and periodically commits live audio when configured', async () => {
    FakeWebSocket.instances = []
    const onTelemetry = vi.fn()
    const session = new OpenAiLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/openai/transcribe',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      onTelemetry,
      liveCommitEveryMs: 250,
    })
    await session.connect()
    onTelemetry.mockClear()

    const chunk = { seq: 7, data: new Int16Array([0, 1000, 2000, 3000]).buffer, durationMs: 100 }
    await session.sendPcmChunk(chunk)
    await session.sendPcmChunk({ ...chunk, seq: 8 })
    await session.sendPcmChunk({ ...chunk, seq: 9 })
    await session.sendPcmChunk({ ...chunk, seq: 10 })

    expect(FakeWebSocket.instances[0].sent.slice(1)).toEqual([
      buildOpenAiInputAudioAppendMessage(chunk.data),
      buildOpenAiInputAudioAppendMessage(chunk.data),
      buildOpenAiInputAudioAppendMessage(chunk.data),
      buildOpenAiCommitMessage(),
      buildOpenAiInputAudioAppendMessage(chunk.data),
    ])
    const firstAudioCalls = onTelemetry.mock.calls.filter(([stage]) => stage === 'first_audio_chunk_sent')
    expect(firstAudioCalls).toHaveLength(1)
    expect(firstAudioCalls[0][1]).toEqual({ seq: 7 })
    expect(onTelemetry).toHaveBeenCalledWith('provider_commit_sent', { seq: 9 })
  })

  it('commits fixture audio and waits for the completed transcript before resolving streamPcmChunks', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const session = new OpenAiLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/openai/transcribe',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript,
      onVisualStatus: vi.fn(),
      sleep: async () => undefined,
    })
    await session.connect()

    let resolved = false
    const chunk = { seq: 1, data: new Int16Array([0, 1000, 2000, 3000]).buffer, durationMs: 100 }
    const streamPromise = session.streamPcmChunks([chunk]).then(() => {
      resolved = true
    })
    await Promise.resolve()

    expect(FakeWebSocket.instances[0].sent.slice(1)).toEqual([
      buildOpenAiInputAudioAppendMessage(chunk.data),
      buildOpenAiCommitMessage(),
    ])
    expect(resolved).toBe(false)

    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item_1',
          transcript: 'Proven machine captions are ready.',
        }),
      }),
    )
    await streamPromise

    expect(resolved).toBe(true)
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'openai', text: 'Proven machine captions are ready.', status: 'final' }),
    )
  })
})
