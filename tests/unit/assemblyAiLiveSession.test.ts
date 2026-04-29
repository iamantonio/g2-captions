import { describe, expect, it, vi } from 'vitest'
import { AssemblyAiLiveSession } from '../../src/asr/AssemblyAiLiveSession'
import { buildAssemblyAiTerminateMessage } from '../../src/asr/AssemblyAiStreamingClient'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly sent: string[] = []
  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

describe('AssemblyAiLiveSession', () => {
  it('fetches a temporary token, opens AssemblyAI WebSocket, maps Turn events, and terminates cleanly', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const onVisualStatus = vi.fn()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'temp-token', expiresInSeconds: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const session = new AssemblyAiLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/assemblyai/token',
      fetchImpl,
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 500,
      onTranscript,
      onVisualStatus,
      keyterms: ['ProvenMachine'],
    })

    await session.connect()
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/assemblyai/token', { method: 'POST' })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toContain('token=temp-token')
    expect(new URL(FakeWebSocket.instances[0].url).searchParams.get('keyterms_prompt')).toBe(JSON.stringify(['ProvenMachine']))
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — token')
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — ASR')
    expect(onVisualStatus).toHaveBeenCalledWith('ASR CONNECTED — waiting audio')

    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'Turn', transcript: 'hello Tony', end_of_turn: true, speaker_label: 'A' }),
      }),
    )
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'assemblyai', text: 'hello Tony', status: 'final', speaker: 'A' }),
    )

    session.terminate()
    expect(FakeWebSocket.instances[0].sent).toEqual([buildAssemblyAiTerminateMessage()])
  })

  it('renders token failures visually and never opens a WebSocket', async () => {
    FakeWebSocket.instances = []
    const onVisualStatus = vi.fn()
    const session = new AssemblyAiLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/assemblyai/token',
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

  it('renders malformed ASR messages visually instead of relying on audio alerts', async () => {
    FakeWebSocket.instances = []
    const onVisualStatus = vi.fn()
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
      onVisualStatus,
    })

    await session.connect()
    FakeWebSocket.instances[0].onmessage?.(new MessageEvent('message', { data: '{' }))

    expect(onVisualStatus).toHaveBeenCalledWith('ASR MESSAGE FAILED — captions paused')
  })
})
