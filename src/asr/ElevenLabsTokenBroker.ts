export class ElevenLabsTokenBrokerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ElevenLabsTokenBrokerError'
  }
}

export interface ElevenLabsRealtimeTokenResponse {
  token: string
  expiresInSeconds: number
}

export interface CreateElevenLabsRealtimeTokenOptions {
  apiKey: string
  fetchImpl?: typeof fetch
}

interface ElevenLabsSingleUseTokenApiResponse {
  token?: unknown
}

const ELEVENLABS_REALTIME_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const ELEVENLABS_SINGLE_USE_TOKEN_TTL_SECONDS = 15 * 60

export function readElevenLabsApiKeyFromEnv(env: Record<string, string | undefined>): string {
  const apiKey = env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) {
    throw new ElevenLabsTokenBrokerError('ELEVENLABS_API_KEY must be set on the local token broker only')
  }
  return apiKey
}

export async function createElevenLabsRealtimeToken(
  options: CreateElevenLabsRealtimeTokenOptions,
): Promise<ElevenLabsRealtimeTokenResponse> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new ElevenLabsTokenBrokerError('ElevenLabs API key is required on the server-side token broker')
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(new URL(ELEVENLABS_REALTIME_TOKEN_URL), {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
  })
  if (!response.ok) {
    throw new ElevenLabsTokenBrokerError(`ElevenLabs token request failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as ElevenLabsSingleUseTokenApiResponse
  if (typeof payload.token !== 'string' || !payload.token.trim()) {
    throw new ElevenLabsTokenBrokerError('ElevenLabs token response did not include a single-use token')
  }

  return { token: payload.token, expiresInSeconds: ELEVENLABS_SINGLE_USE_TOKEN_TTL_SECONDS }
}
