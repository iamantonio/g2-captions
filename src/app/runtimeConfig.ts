export function getDefaultTokenEndpoint(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  const brokerHost = host === 'localhost' ? '127.0.0.1' : host
  return `${locationUrl.protocol}//${brokerHost}:8787/deepgram/token`
}

export function getDefaultStreamingEndpoint(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  const brokerHost = host === 'localhost' ? '127.0.0.1' : host
  const protocol = locationUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${brokerHost}:8787/deepgram/listen`
}

export function getClientLogEndpoint(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  const brokerHost = host === 'localhost' ? '127.0.0.1' : host
  return `${locationUrl.protocol}//${brokerHost}:8787/client-log`
}

export function getSpeechFixtureUrl(locationUrl: URL): string {
  return new URL('fixtures/speech-smoke.pcm', locationUrl).toString()
}

export function shouldAutoRunHardwareSmoke(locationUrl: URL, hasEvenBridge: boolean): boolean {
  if (locationUrl.searchParams.get('autoSmoke') === '0') return false
  return hasEvenBridge
}
