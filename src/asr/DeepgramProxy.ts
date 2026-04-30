import { DEEPGRAM_STREAMING_URL } from './DeepgramStreamingClient'

export function buildDeepgramProxyUpstreamUrl(requestUrl: string): URL {
  const incoming = new URL(requestUrl, 'ws://localhost')
  const upstream = new URL(DEEPGRAM_STREAMING_URL)
  upstream.search = incoming.search
  return upstream
}

export function buildDeepgramProxyHeaders(apiKey: string): { Authorization: string } {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('Deepgram API key is required for streaming proxy')
  return { Authorization: `Token ${trimmed}` }
}
