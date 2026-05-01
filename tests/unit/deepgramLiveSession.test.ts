import { describe, expect, it, vi } from 'vitest'
import { DeepgramLiveSession } from '../../src/asr/DeepgramLiveSession'
import { buildDeepgramCloseStreamMessage } from '../../src/asr/DeepgramStreamingClient'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly sent: Array<string | ArrayBuffer> = []
  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
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

describe('DeepgramLiveSession', () => {
  it('fetches a temporary token, opens Deepgram WebSocket with subprotocol auth, maps Results, and terminates cleanly', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const onVisualStatus = vi.fn()
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ accessToken: 'dg-temp-token', expiresInSeconds: 60 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const session = new DeepgramLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/deepgram/token',
      fetchImpl,
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 500,
      onTranscript,
      onVisualStatus,
      keyterms: ['ProvenMachine'],
    })

    await session.connect()
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/deepgram/token', { method: 'POST' })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toContain('api.deepgram.com/v1/listen')
    expect(new URL(FakeWebSocket.instances[0].url).searchParams.getAll('keyterm')).toEqual(['ProvenMachine'])
    expect(FakeWebSocket.instances[0].protocols).toEqual(['token', 'dg-temp-token'])
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — token')
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — ASR')
    expect(onVisualStatus).toHaveBeenCalledWith('ASR CONNECTED — waiting audio')

    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'Results',
          is_final: true,
          channel: {
            alternatives: [{ transcript: 'hello Tony', words: [{ word: 'hello', start: 0, end: 0.2, speaker: 1 }] }],
          },
        }),
      }),
    )
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'deepgram', text: 'hello Tony', status: 'final', speaker: '1' }),
    )

    session.terminate()
    expect(FakeWebSocket.instances[0].sent).toEqual([buildDeepgramCloseStreamMessage()])
  })

  it('opens the local streaming proxy directly without fetching a browser token', async () => {
    FakeWebSocket.instances = []
    const fetchImpl = vi.fn()
    const session = new DeepgramLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/deepgram/listen',
      fetchImpl,
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      keyterms: ['ProvenMachine'],
    })

    await session.connect()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toContain('127.0.0.1:8787/deepgram/listen')
    expect(new URL(FakeWebSocket.instances[0].url).searchParams.get('model')).toBe('nova-3')
    expect(new URL(FakeWebSocket.instances[0].url).searchParams.getAll('keyterm')).toEqual(['ProvenMachine'])
    expect(FakeWebSocket.instances[0].protocols).toBeUndefined()
  })

  it('renders token failures visually and never opens a WebSocket', async () => {
    FakeWebSocket.instances = []
    const onVisualStatus = vi.fn()
    const session = new DeepgramLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/deepgram/token',
      fetchImpl: vi.fn(async () => new Response('nope', { status: 502 })),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 100,
      onTranscript: vi.fn(),
      onVisualStatus,
    })

    await expect(session.connect()).rejects.toThrow(/token/i)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(onVisualStatus).toHaveBeenCalledWith('ASR TOKEN FAILED — check broker')
  })

  it('sendPcmChunk emits first_audio_chunk_sent on the first call so live-mic latency metrics are computable', async () => {
    // Reproduces Bug B from the 2026-05-01 G2 hardware run: live-mic
    // sessions never emitted first_audio_chunk_sent (only streamPcmChunks
    // did), so firstPartialFromFirstAudioMs and finalTranscriptFromFirstAudioMs
    // were never computable for a real on-device session.
    FakeWebSocket.instances = []
    const onTelemetry = vi.fn()
    const session = new DeepgramLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/deepgram/listen',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      onTelemetry,
    })
    await session.connect()
    onTelemetry.mockClear()

    await session.sendPcmChunk({ seq: 7, data: new ArrayBuffer(8), durationMs: 100 })
    await session.sendPcmChunk({ seq: 8, data: new ArrayBuffer(8), durationMs: 100 })
    await session.sendPcmChunk({ seq: 9, data: new ArrayBuffer(8), durationMs: 100 })

    const firstAudioCalls = onTelemetry.mock.calls.filter(([stage]) => stage === 'first_audio_chunk_sent')
    expect(firstAudioCalls).toHaveLength(1)
    expect(firstAudioCalls[0][1]).toEqual({ seq: 7 })
  })

  it('streamPcmChunks followed by sendPcmChunk does not double-mark first_audio_chunk_sent in the same session', async () => {
    FakeWebSocket.instances = []
    const onTelemetry = vi.fn()
    const session = new DeepgramLiveSession({
      streamingEndpoint: 'ws://127.0.0.1:8787/deepgram/listen',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      onTelemetry,
      sleep: async () => undefined,
    })
    await session.connect()
    onTelemetry.mockClear()

    await session.streamPcmChunks([{ seq: 0, data: new ArrayBuffer(2), durationMs: 0 }])
    await session.sendPcmChunk({ seq: 99, data: new ArrayBuffer(2), durationMs: 0 })

    const firstAudioCalls = onTelemetry.mock.calls.filter(([stage]) => stage === 'first_audio_chunk_sent')
    expect(firstAudioCalls).toHaveLength(1)
    expect(firstAudioCalls[0][1]).toEqual({ seq: 0 })
  })
})
