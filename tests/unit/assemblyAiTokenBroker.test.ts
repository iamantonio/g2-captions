import { describe, expect, it, vi } from 'vitest'
import {
  AssemblyAiTokenBrokerError,
  createAssemblyAiToken,
  readAssemblyAiApiKeyFromEnv,
} from '../../src/asr/AssemblyAiTokenBroker'

describe('AssemblyAI token broker', () => {
  it('reads the API key from process env without accepting missing values', () => {
    expect(() => readAssemblyAiApiKeyFromEnv({})).toThrow(/ASSEMBLYAI_API_KEY/)
    expect(readAssemblyAiApiKeyFromEnv({ ASSEMBLYAI_API_KEY: 'local-key' })).toBe('local-key')
  })

  it('requests a short-lived temporary token without exposing the API key in the response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'temp-token', expires_in_seconds: 60 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await createAssemblyAiToken({
      apiKey: 'server-side-key',
      expiresInSeconds: 60,
      maxSessionDurationSeconds: 600,
      fetchImpl: fetchMock,
    })

    expect(result).toEqual({ token: 'temp-token', expiresInSeconds: 60 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=600',
    )
    expect(init.headers).toEqual({ Authorization: 'server-side-key' })
    expect(JSON.stringify(result)).not.toContain('server-side-key')
  })

  it('fails closed when AssemblyAI rejects token generation', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }))

    await expect(
      createAssemblyAiToken({ apiKey: 'bad-key', expiresInSeconds: 60, fetchImpl: fetchMock }),
    ).rejects.toThrow(AssemblyAiTokenBrokerError)
  })
})
