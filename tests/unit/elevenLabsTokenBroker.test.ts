import { describe, expect, it } from 'vitest'
import {
  createElevenLabsRealtimeToken,
  ElevenLabsTokenBrokerError,
  readElevenLabsApiKeyFromEnv,
} from '../../src/asr/ElevenLabsTokenBroker'

describe('ElevenLabsTokenBroker', () => {
  it('reads ELEVENLABS_API_KEY from server-side env only', () => {
    expect(readElevenLabsApiKeyFromEnv({ ELEVENLABS_API_KEY: '  eleven-key  ' })).toBe('eleven-key')
    expect(() => readElevenLabsApiKeyFromEnv({})).toThrow(ElevenLabsTokenBrokerError)
  })

  it('mints realtime_scribe single-use tokens without returning the API key', async () => {
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'xi-api-key': 'server-key' })
      return new Response(JSON.stringify({ token: 'single-use-token' }), { status: 200 })
    }

    await expect(createElevenLabsRealtimeToken({ apiKey: 'server-key', fetchImpl })).resolves.toEqual({
      token: 'single-use-token',
      expiresInSeconds: 900,
    })
  })
})
