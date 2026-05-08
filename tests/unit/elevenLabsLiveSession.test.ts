import { describe, expect, it, vi } from 'vitest'
import { ElevenLabsLiveSession } from '../../src/asr/ElevenLabsLiveSession'

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

describe('ElevenLabsLiveSession', () => {
  it('fetches a single-use token, opens Scribe v2 realtime, sends JSON PCM chunks, and maps transcripts', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const onVisualStatus = vi.fn()
    const onTelemetry = vi.fn()
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: 'el-single-use-token', expiresInSeconds: 900 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const session = new ElevenLabsLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/elevenlabs/token',
      fetchImpl,
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      nowMs: () => 500,
      onTranscript,
      onVisualStatus,
      onTelemetry,
      keyterms: ['ProvenMachine'],
      brokerAuthToken: 'broker-token',
      realtimeOptions: {
        languageCode: 'en',
        includeTimestamps: false,
        commitStrategy: 'vad',
        vadSilenceThresholdSecs: 0.3,
        vadThreshold: 0.3,
        minSpeechDurationMs: 50,
        minSilenceDurationMs: 50,
        enableLogging: false,
      },
    })

    await session.connect()

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/elevenlabs/token', {
      method: 'POST',
      headers: { authorization: 'Bearer broker-token' },
    })
    expect(FakeWebSocket.instances).toHaveLength(1)
    const url = new URL(FakeWebSocket.instances[0].url)
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime')
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime')
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000')
    expect(url.searchParams.get('include_timestamps')).toBe('false')
    expect(url.searchParams.get('commit_strategy')).toBe('vad')
    expect(url.searchParams.get('language_code')).toBe('en')
    expect(url.searchParams.get('vad_silence_threshold_secs')).toBe('0.3')
    expect(url.searchParams.get('vad_threshold')).toBe('0.3')
    expect(url.searchParams.get('min_speech_duration_ms')).toBe('50')
    expect(url.searchParams.get('min_silence_duration_ms')).toBe('50')
    expect(url.searchParams.get('enable_logging')).toBe('false')
    expect(url.searchParams.get('token')).toBe('el-single-use-token')
    expect(url.searchParams.getAll('keyterms')).toEqual(['ProvenMachine'])
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — token')
    expect(onVisualStatus).toHaveBeenCalledWith('CONNECTING — ASR')
    expect(onVisualStatus).toHaveBeenCalledWith('ASR CONNECTED — waiting audio')

    await session.sendPcmChunk({ seq: 3, data: new Uint8Array([1, 2, 3, 4]).buffer, durationMs: 100 })
    const audioMessage = JSON.parse(FakeWebSocket.instances[0].sent[0])
    expect(audioMessage).toMatchObject({
      message_type: 'input_audio_chunk',
      audio_base_64: 'AQIDBA==',
      commit: false,
      sample_rate: 16000,
    })
    expect(onTelemetry).toHaveBeenCalledWith('first_audio_chunk_sent', { seq: 3 })

    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          message_type: 'committed_transcript',
          text: 'ProvenMachine captions are ready.',
        }),
      }),
    )
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: 'elevenlabs',
        text: 'ProvenMachine captions are ready.',
        status: 'final',
      }),
    )
    expect(onTelemetry).toHaveBeenCalledWith(
      'final_transcript_received',
      expect.objectContaining({ transcript: 'ProvenMachine captions are ready.' }),
    )
  })

  it('labels only the first partial as first_partial_received and suppresses duplicate finals', async () => {
    FakeWebSocket.instances = []
    const onTranscript = vi.fn()
    const onTelemetry = vi.fn()
    const session = new ElevenLabsLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/elevenlabs/token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token: 'token' }), { status: 200 })),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript,
      onVisualStatus: vi.fn(),
      onTelemetry,
    })

    await session.connect()
    for (const text of ['Test.', 'Testing, one, two, three.']) {
      FakeWebSocket.instances[0].onmessage?.(
        new MessageEvent('message', { data: JSON.stringify({ message_type: 'partial_transcript', text }) }),
      )
    }
    for (const text of ['Testing, one, two, three.', 'Testing, one, two, three.']) {
      FakeWebSocket.instances[0].onmessage?.(
        new MessageEvent('message', { data: JSON.stringify({ message_type: 'committed_transcript', text }) }),
      )
    }

    expect(onTelemetry).toHaveBeenCalledWith('first_partial_received', { transcript: 'Test.' })
    expect(onTelemetry).toHaveBeenCalledWith('partial_transcript_received', { transcript: 'Testing, one, two, three.' })
    expect(onTelemetry).toHaveBeenCalledWith('final_transcript_received', { transcript: 'Testing, one, two, three.' })
    expect(onTranscript).toHaveBeenCalledTimes(3)
    expect(onTranscript).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'final', text: 'Testing, one, two, three.' }),
    )
  })

  it('manual-commits PCM chunks at the configured cadence for ElevenLabs latency experiments', async () => {
    FakeWebSocket.instances = []
    const session = new ElevenLabsLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/elevenlabs/token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token: 'token' }), { status: 200 })),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      realtimeOptions: { commitStrategy: 'manual' },
      manualCommitEveryChunks: 2,
    })

    await session.connect()
    await session.sendPcmChunk({ seq: 1, data: new Uint8Array([1, 1]).buffer, durationMs: 100 })
    await session.sendPcmChunk({ seq: 2, data: new Uint8Array([2, 2]).buffer, durationMs: 100 })
    await session.sendPcmChunk({ seq: 3, data: new Uint8Array([3, 3]).buffer, durationMs: 100 })
    await session.sendPcmChunk({ seq: 4, data: new Uint8Array([4, 4]).buffer, durationMs: 100 })

    expect(FakeWebSocket.instances[0].sent.map((message) => JSON.parse(message).commit)).toEqual([
      false,
      true,
      false,
      true,
    ])
  })

  it('renders provider error messages visually and logs the structured error stage', async () => {
    FakeWebSocket.instances = []
    const onVisualStatus = vi.fn()
    const onError = vi.fn()
    const session = new ElevenLabsLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/elevenlabs/token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token: 'token' }), { status: 200 })),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus,
      onError,
    })

    await session.connect()
    FakeWebSocket.instances[0].onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ message_type: 'quota_exceeded', error: 'quota exhausted' }),
      }),
    )

    expect(onVisualStatus).toHaveBeenCalledWith('ASR PROVIDER ERROR — captions paused')
    expect(onError).toHaveBeenCalledWith(
      'asr_provider_error',
      expect.any(Error),
      expect.objectContaining({ provider: 'elevenlabs', messageType: 'quota_exceeded' }),
    )
  })

  it('records sanitized WebSocket error and close details in telemetry', async () => {
    FakeWebSocket.instances = []
    const onTelemetry = vi.fn()
    const onError = vi.fn()
    const session = new ElevenLabsLiveSession({
      tokenEndpoint: 'http://127.0.0.1:8787/elevenlabs/token',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ token: 'secret-token-value' }), { status: 200 })),
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onTranscript: vi.fn(),
      onVisualStatus: vi.fn(),
      onTelemetry,
      onError,
    })

    await session.connect()
    FakeWebSocket.instances[0].onerror?.(new ErrorEvent('error', { message: 'upstream reset token=abc123' }))
    FakeWebSocket.instances[0].onclose?.(
      new CloseEvent('close', { code: 1006, reason: 'abnormal provider close token=abc123', wasClean: false }),
    )

    expect(onTelemetry).toHaveBeenCalledWith('websocket_error', {
      eventType: 'error',
      message: 'upstream reset token=[REDACTED]',
    })
    expect(onTelemetry).toHaveBeenCalledWith('websocket_closed', {
      closeCode: 1006,
      closeReason: 'abnormal provider close token=[REDACTED]',
      closeWasClean: false,
    })
    expect(onError).toHaveBeenCalledWith(
      'asr_websocket_error',
      expect.any(Error),
      expect.objectContaining({
        provider: 'elevenlabs',
        eventType: 'error',
        message: 'upstream reset token=[REDACTED]',
      }),
    )
  })
})
