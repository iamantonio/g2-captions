import { describe, expect, it, vi } from 'vitest'
import { AssemblyAiLiveSession } from '../../src/asr/AssemblyAiLiveSession'
import { createSilentPcmS16LeFixture, chunkPcmS16Le } from '../../src/audio/pcmFixture'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly sent: unknown[] = []
  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

describe('AssemblyAI paced PCM streaming', () => {
  it('sends each PCM chunk as binary and waits for each chunk duration', async () => {
    FakeWebSocket.instances = []
    const waits: number[] = []
    const session = new AssemblyAiLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/assemblyai/token',
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ token: 'temp-token', expiresInSeconds: 60 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 100,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      sleep: async (ms: number) => {
        waits.push(ms)
      },
    })

    await session.connect()
    const fixture = createSilentPcmS16LeFixture({ durationMs: 250, sampleRate: 16_000 })
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))

    expect(FakeWebSocket.instances[0].sent).toHaveLength(3)
    expect(FakeWebSocket.instances[0].sent.every((sent) => sent instanceof ArrayBuffer)).toBe(true)
    expect(waits).toEqual([100, 100, 50])
  })

  it('renders audio streaming failures visually when the socket is not connected', async () => {
    const onVisualStatus = vi.fn()
    const session = new AssemblyAiLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/assemblyai/token',
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus,
    })

    await expect(session.streamPcmChunks([])).rejects.toThrow(/not connected/i)
    expect(onVisualStatus).toHaveBeenCalledWith('AUDIO STREAM FAILED — ASR not connected')
  })
})
