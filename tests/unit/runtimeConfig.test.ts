import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAsrProvider,
  getClientLogEndpoint,
  getDeepgramKeyterms,
  getDeepgramRealtimeOptions,
  getDefaultStreamingEndpoint,
  getDefaultTokenEndpoint,
  getElevenLabsRealtimeOptions,
  getElevenLabsKeyterms,
  getElevenLabsTokenEndpoint,
  getOpenAiStreamingEndpoint,
  getOpenAiRealtimeOptions,
  getSpeechFixtureUrl,
  isDebugMode,
  shouldAutoRunHardwareSmoke,
} from '../../src/app/runtimeConfig'

describe('runtime config for Hub hardware smoke tests', () => {
  it('uses local broker on 127.0.0.1 when running local browser preview', () => {
    const endpoint = getDefaultTokenEndpoint(new URL('http://127.0.0.1:5173/'))

    expect(endpoint).toBe('http://127.0.0.1:8787/deepgram/token')
  })

  it('uses the LAN host that served the app when running on a phone/Hub WebView', () => {
    const endpoint = getDefaultTokenEndpoint(new URL('http://172.20.10.5:5173/'))

    expect(endpoint).toBe('http://172.20.10.5:8787/deepgram/token')
  })

  it('uses the same LAN broker for the local Deepgram streaming proxy', () => {
    expect(getDefaultStreamingEndpoint(new URL('http://127.0.0.1:5173/'))).toBe('ws://127.0.0.1:8787/deepgram/listen')
    expect(getDefaultStreamingEndpoint(new URL('http://172.20.10.5:5173/'))).toBe(
      'ws://172.20.10.5:8787/deepgram/listen',
    )
    expect(getDefaultStreamingEndpoint(new URL('https://hub.local/apps/g2-captions/'))).toBe(
      'wss://hub.local:8787/deepgram/listen',
    )
  })

  it('selects Deepgram by default and experimental providers only via explicit ?asr test flags', () => {
    expect(getAsrProvider(new URL('http://172.20.10.5:5173/'))).toBe('deepgram')
    expect(getAsrProvider(new URL('http://172.20.10.5:5173/?asr=elevenlabs'))).toBe('elevenlabs')
    expect(getAsrProvider(new URL('http://172.20.10.5:5173/?asr=openai'))).toBe('openai')
    expect(getAsrProvider(new URL('http://172.20.10.5:5173/?asr=unknown'))).toBe('deepgram')
  })

  it('derives the experimental OpenAI websocket endpoint from the broker so API keys stay server-side', () => {
    expect(getOpenAiStreamingEndpoint(new URL('http://127.0.0.1:5173/'))).toBe('ws://127.0.0.1:8787/openai/transcribe')
    expect(getOpenAiStreamingEndpoint(new URL('http://172.20.10.5:5173/'))).toBe(
      'ws://172.20.10.5:8787/openai/transcribe',
    )
  })

  it('allows OpenAI live commit cadence and final wait timeout to be tuned from A/B URLs', () => {
    expect(getOpenAiRealtimeOptions(new URL('http://172.20.10.5:5173/?asr=openai'))).toEqual({
      liveCommitEveryMs: undefined,
      finalTranscriptWaitMs: 4000,
    })

    expect(
      getOpenAiRealtimeOptions(
        new URL('http://172.20.10.5:5173/?asr=openai&openaiCommitMs=1500&openaiFinalWaitMs=6500'),
      ),
    ).toEqual({
      liveCommitEveryMs: 1500,
      finalTranscriptWaitMs: 6500,
    })

    expect(
      getOpenAiRealtimeOptions(
        new URL('http://172.20.10.5:5173/?asr=openai&openaiCommitMs=0&openaiFinalWaitMs=not-a-number'),
      ),
    ).toEqual({
      liveCommitEveryMs: undefined,
      finalTranscriptWaitMs: 4000,
    })
  })

  it('allows Deepgram endpointing, diarization, and keyterms to be tuned from hardware A/B URLs', () => {
    const url = new URL('http://172.20.10.5:5173/?autoSmoke=0&debug=1&dgEndpointing=750&dgDiarize=0&dgKeyterms=0')

    expect(getDeepgramRealtimeOptions(url)).toEqual({
      endpointing: 750,
      diarize: false,
      interimResults: true,
    })
    expect(getDeepgramKeyterms(url)).toEqual([])
  })

  it('allows Deepgram keyterms to be overridden for vocabulary tests', () => {
    expect(getDeepgramKeyterms(new URL('http://172.20.10.5:5173/'))).toEqual(['ProvenMachine', 'Even Realities G2'])
    expect(getDeepgramKeyterms(new URL('http://172.20.10.5:5173/?dgKeyterms=Flux%20AI,G2'))).toEqual(['Flux AI', 'G2'])
  })

  it('derives the ElevenLabs single-use token endpoint from the same LAN broker host', () => {
    expect(getElevenLabsTokenEndpoint(new URL('http://127.0.0.1:5173/'))).toBe('http://127.0.0.1:8787/elevenlabs/token')
    expect(getElevenLabsTokenEndpoint(new URL('http://172.20.10.5:5173/'))).toBe(
      'http://172.20.10.5:8787/elevenlabs/token',
    )
  })

  it('uses low-latency ElevenLabs realtime options by default for the gated test path', () => {
    expect(getElevenLabsRealtimeOptions(new URL('http://172.20.10.5:5173/?asr=elevenlabs'))).toEqual({
      languageCode: 'en',
      includeTimestamps: false,
      commitStrategy: 'vad',
      vadSilenceThresholdSecs: 0.3,
      vadThreshold: 0.3,
      minSpeechDurationMs: 50,
      minSilenceDurationMs: 50,
      enableLogging: false,
      manualCommitEveryChunks: undefined,
    })
  })

  it('treats manualCommitEvery as seconds for safer ElevenLabs manual-commit hardware runs', () => {
    expect(
      getElevenLabsRealtimeOptions(
        new URL(
          'http://172.20.10.5:5173/?asr=elevenlabs&lang=es&timestamps=1&commit=manual&manualCommitEvery=3&vadSilence=0.8&vadThreshold=0.5&minSpeech=120&minSilence=200&elevenLogging=1',
        ),
      ),
    ).toEqual({
      languageCode: 'es',
      includeTimestamps: true,
      commitStrategy: 'manual',
      vadSilenceThresholdSecs: 0.8,
      vadThreshold: 0.5,
      minSpeechDurationMs: 120,
      minSilenceDurationMs: 200,
      enableLogging: true,
      manualCommitEveryChunks: 30,
    })
  })

  it('allows ElevenLabs keyterms to be disabled or overridden for latency A/B tests', () => {
    expect(getElevenLabsKeyterms(new URL('http://172.20.10.5:5173/?asr=elevenlabs'))).toEqual([
      'ProvenMachine',
      'Even Realities G2',
    ])
    expect(getElevenLabsKeyterms(new URL('http://172.20.10.5:5173/?asr=elevenlabs&elevenKeyterms=0'))).toEqual([])
    expect(
      getElevenLabsKeyterms(new URL('http://172.20.10.5:5173/?asr=elevenlabs&elevenKeyterms=Flux%20AI,G2')),
    ).toEqual(['Flux AI', 'G2'])
  })

  it('sends client diagnostics to the same LAN token broker host', () => {
    expect(getClientLogEndpoint(new URL('http://172.20.10.5:5173/'))).toBe('http://172.20.10.5:8787/client-log')
  })

  it('resolves speech fixtures relative to the app document instead of absolute site root', () => {
    expect(getSpeechFixtureUrl(new URL('http://172.20.10.5:5173/index.html'))).toBe(
      'http://172.20.10.5:5173/fixtures/speech-smoke.pcm',
    )
    expect(getSpeechFixtureUrl(new URL('https://hub.local/apps/g2-captions/index.html'))).toBe(
      'https://hub.local/apps/g2-captions/fixtures/speech-smoke.pcm',
    )
  })

  it('allows debug fixture smoke URLs to select a bundled PCM fixture by filename only', () => {
    expect(getSpeechFixtureUrl(new URL('http://127.0.0.1:5173/?fixture=two-speaker-captions.pcm'))).toBe(
      'http://127.0.0.1:5173/fixtures/two-speaker-captions.pcm',
    )
    expect(getSpeechFixtureUrl(new URL('http://127.0.0.1:5173/?fixture=https://evil.test/audio.pcm'))).toBe(
      'http://127.0.0.1:5173/fixtures/speech-smoke.pcm',
    )
  })

  it('auto-runs the fixture smoke test only when explicitly opted in by ?autoSmoke=1', () => {
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/?autoSmoke=1'), true)).toBe(true)
  })

  it('does not auto-run by default even on Hub, so live ASR requires consent', () => {
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/'), true)).toBe(false)
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/?autoSmoke=0'), true)).toBe(false)
  })

  it('does not auto-run outside the Even Hub bridge regardless of opt-in flag', () => {
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/'), false)).toBe(false)
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/?autoSmoke=1'), false)).toBe(false)
  })

  it('defaults to production UI; ?debug=1 opts into the developer panel', () => {
    expect(isDebugMode(new URL('http://172.20.10.5:5173/'))).toBe(false)
    expect(isDebugMode(new URL('http://172.20.10.5:5173/?debug=1'))).toBe(true)
    expect(isDebugMode(new URL('http://172.20.10.5:5173/?debug=0'))).toBe(false)
    expect(isDebugMode(new URL('http://172.20.10.5:5173/?debug=true'))).toBe(false)
  })
})

describe('runtime config with VITE_BROKER_BASE_URL override', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('points the token, streaming, and client-log endpoints at the deployed broker when set', () => {
    vi.stubEnv('VITE_BROKER_BASE_URL', 'https://g2-captions.fly.dev')

    expect(getDefaultTokenEndpoint(new URL('http://anything-irrelevant/'))).toBe(
      'https://g2-captions.fly.dev/deepgram/token',
    )
    expect(getDefaultStreamingEndpoint(new URL('http://anything-irrelevant/'))).toBe(
      'wss://g2-captions.fly.dev/deepgram/listen',
    )
    expect(getClientLogEndpoint(new URL('http://anything-irrelevant/'))).toBe('https://g2-captions.fly.dev/client-log')
  })

  it('downgrades wss → ws when the base URL is plain http (local-dev override)', () => {
    vi.stubEnv('VITE_BROKER_BASE_URL', 'http://local-broker.test:9000')
    expect(getDefaultStreamingEndpoint(new URL('http://anything/'))).toBe('ws://local-broker.test:9000/deepgram/listen')
  })

  it('falls back to LAN-derived URLs when the override is empty or whitespace', () => {
    vi.stubEnv('VITE_BROKER_BASE_URL', '')
    expect(getDefaultTokenEndpoint(new URL('http://172.20.10.5:5173/'))).toBe('http://172.20.10.5:8787/deepgram/token')
    vi.stubEnv('VITE_BROKER_BASE_URL', '   ')
    expect(getDefaultTokenEndpoint(new URL('http://172.20.10.5:5173/'))).toBe('http://172.20.10.5:8787/deepgram/token')
  })

  it('falls back to LAN-derived URLs when the override is not a parseable URL', () => {
    vi.stubEnv('VITE_BROKER_BASE_URL', 'not a url')
    expect(getDefaultTokenEndpoint(new URL('http://172.20.10.5:5173/'))).toBe('http://172.20.10.5:8787/deepgram/token')
  })
})
