export class DeepgramTokenBrokerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepgramTokenBrokerError'
  }
}

export interface DeepgramTokenResponse {
  accessToken: string
  expiresInSeconds: number
}

export interface CreateDeepgramTokenOptions {
  apiKey: string
  ttlSeconds: number
  fetchImpl?: typeof fetch
}

interface DeepgramGrantApiResponse {
  access_token?: unknown
  expires_in?: unknown
}

export function readDeepgramApiKeyFromEnv(env: Record<string, string | undefined>): string {
  const apiKey = env.DEEPGRAM_API_KEY?.trim()
  if (!apiKey) {
    throw new DeepgramTokenBrokerError('DEEPGRAM_API_KEY must be set on the local token broker only')
  }
  return apiKey
}

export async function createDeepgramToken(options: CreateDeepgramTokenOptions): Promise<DeepgramTokenResponse> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new DeepgramTokenBrokerError('Deepgram API key is required on the server-side token broker')
  }

  const ttlSeconds = validateRange(options.ttlSeconds, 1, 3600, 'ttlSeconds')
  const url = new URL('https://api.deepgram.com/v1/auth/grant')
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  })
  if (!response.ok) {
    throw new DeepgramTokenBrokerError(`Deepgram token request failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as DeepgramGrantApiResponse
  if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new DeepgramTokenBrokerError('Deepgram token response did not include an access token')
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : ttlSeconds,
  }
}

function validateRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DeepgramTokenBrokerError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}
