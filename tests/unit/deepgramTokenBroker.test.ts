import { describe, expect, it, vi } from 'vitest'
import {
  DeepgramTokenBrokerError,
  createDeepgramToken,
  readDeepgramApiKeyFromEnv,
} from '../../src/asr/DeepgramTokenBroker'

describe('Deepgram token broker', () => {
  it('reads the API key from process env without accepting missing values', () => {
    expect(() => readDeepgramApiKeyFromEnv({})).toThrow(/DEEPGRAM_API_KEY/)
    expect(readDeepgramApiKeyFromEnv({ DEEPGRAM_API_KEY: 'local-key' })).toBe('local-key')
  })

  it('requests a short-lived temporary token without exposing the API key in the response', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'dg-temp-token', expires_in: 60 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const result = await createDeepgramToken({ apiKey: 'server-side-key', ttlSeconds: 60, fetchImpl: fetchMock })

    expect(result).toEqual({ accessToken: 'dg-temp-token', expiresInSeconds: 60 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.deepgram.com/v1/auth/grant')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Token server-side-key', 'content-type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ ttl_seconds: 60 }))
    expect(JSON.stringify(result)).not.toContain('server-side-key')
  })

  it('fails closed when Deepgram rejects token generation', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }))

    await expect(createDeepgramToken({ apiKey: 'bad-key', ttlSeconds: 60, fetchImpl: fetchMock })).rejects.toThrow(
      DeepgramTokenBrokerError,
    )
  })
})
