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

/**
 * Debug mode exposes all internal controls (fixture buttons, browser-mic,
 * raw connect, telemetry JSON panel). Default mode (no flag) shows only
 * the user-facing caption surface and a single Start/Stop action.
 *
 * Set `?debug=1` on the URL to enable. The hardware-readiness QR keeps the
 * default off so a real device install doesn't surface developer controls
 * to end users.
 */
export function isDebugMode(locationUrl: URL): boolean {
  return locationUrl.searchParams.get('debug') === '1'
}

/**
 * Reads the broker bearer token from Vite's build-time-injected env. The
 * broker reads the same VITE_BROKER_AUTH_TOKEN value at boot. Returns
 * undefined when unset — the broker accepts unauthenticated requests in that
 * mode (loopback-bound dev). Set it in .env before LAN-binding.
 */
export function getBrokerAuthToken(): string | undefined {
  // Vite replaces import.meta.env.VITE_* at build time; in non-Vite test
  // environments the property is undefined.
  const value = import.meta.env?.VITE_BROKER_AUTH_TOKEN
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
