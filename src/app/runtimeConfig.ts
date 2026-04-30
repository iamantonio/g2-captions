const TOKEN_BROKER_PORT = 8787

function resolveBrokerHost(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  return host === 'localhost' ? '127.0.0.1' : host
}

export function getDefaultTokenEndpoint(locationUrl: URL): string {
  return `${locationUrl.protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/deepgram/token`
}

export function getDefaultStreamingEndpoint(locationUrl: URL): string {
  const protocol = locationUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/deepgram/listen`
}

export function getClientLogEndpoint(locationUrl: URL): string {
  return `${locationUrl.protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/client-log`
}

export function getSpeechFixtureUrl(locationUrl: URL): string {
  return new URL('fixtures/speech-smoke.pcm', locationUrl).toString()
}

// Auto-smoke is opt-in: it kicks off a billable Deepgram session, so the
// caller has to set ?autoSmoke=1 explicitly. The hardware-readiness QR
// generator already adds this flag for the documented hardware-smoke path
// (see src/hardware/readiness.ts).
export function shouldAutoRunHardwareSmoke(locationUrl: URL, hasEvenBridge: boolean): boolean {
  if (!hasEvenBridge) return false
  return locationUrl.searchParams.get('autoSmoke') === '1'
}
