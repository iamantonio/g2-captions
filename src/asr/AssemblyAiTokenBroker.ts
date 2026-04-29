export class AssemblyAiTokenBrokerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyAiTokenBrokerError'
  }
}

export interface AssemblyAiTokenResponse {
  token: string
  expiresInSeconds: number
}

export interface CreateAssemblyAiTokenOptions {
  apiKey: string
  expiresInSeconds: number
  maxSessionDurationSeconds?: number
  fetchImpl?: typeof fetch
}

interface AssemblyAiTokenApiResponse {
  token?: unknown
  expires_in_seconds?: unknown
}

export function readAssemblyAiApiKeyFromEnv(env: Record<string, string | undefined>): string {
  const apiKey = env.ASSEMBLYAI_API_KEY?.trim()
  if (!apiKey) {
    throw new AssemblyAiTokenBrokerError('ASSEMBLYAI_API_KEY must be set on the local token broker only')
  }
  return apiKey
}

export async function createAssemblyAiToken(options: CreateAssemblyAiTokenOptions): Promise<AssemblyAiTokenResponse> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) {
    throw new AssemblyAiTokenBrokerError('AssemblyAI API key is required on the server-side token broker')
  }

  const expiresInSeconds = validateRange(options.expiresInSeconds, 1, 600, 'expiresInSeconds')
  const url = new URL('https://streaming.assemblyai.com/v3/token')
  url.searchParams.set('expires_in_seconds', String(expiresInSeconds))

  if (options.maxSessionDurationSeconds !== undefined) {
    url.searchParams.set(
      'max_session_duration_seconds',
      String(validateRange(options.maxSessionDurationSeconds, 60, 10_800, 'maxSessionDurationSeconds')),
    )
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, { headers: { Authorization: apiKey } })
  if (!response.ok) {
    throw new AssemblyAiTokenBrokerError(`AssemblyAI token request failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as AssemblyAiTokenApiResponse
  if (typeof payload.token !== 'string' || !payload.token.trim()) {
    throw new AssemblyAiTokenBrokerError('AssemblyAI token response did not include a token')
  }

  return {
    token: payload.token,
    expiresInSeconds:
      typeof payload.expires_in_seconds === 'number' && Number.isFinite(payload.expires_in_seconds)
        ? payload.expires_in_seconds
        : expiresInSeconds,
  }
}

function validateRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AssemblyAiTokenBrokerError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}
