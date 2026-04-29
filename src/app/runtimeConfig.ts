export function getDefaultTokenEndpoint(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  const brokerHost = host === 'localhost' ? '127.0.0.1' : host
  return `${locationUrl.protocol}//${brokerHost}:8787/assemblyai/token`
}

export function getSpeechFixtureUrl(locationUrl: URL): string {
  return new URL('fixtures/speech-smoke.pcm', locationUrl).toString()
}

export function shouldAutoRunHardwareSmoke(locationUrl: URL, hasEvenHubBridge: boolean): boolean {
  if (!hasEvenHubBridge) return false
  return locationUrl.searchParams.get('autoSmoke') !== '0'
}
