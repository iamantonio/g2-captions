export function getTokenBrokerBindHost(env: NodeJS.ProcessEnv): string {
  // TOKEN_BROKER_HOST is the documented name. ASSEMBLYAI_TOKEN_BROKER_HOST is
  // the legacy AssemblyAI-only name kept for backward-compat with existing
  // .env files. HOST is the generic fallback used by hardware-readiness
  // commands ("HOST=0.0.0.0 npm run token-broker").
  return env.TOKEN_BROKER_HOST || env.ASSEMBLYAI_TOKEN_BROKER_HOST || env.HOST || '127.0.0.1'
}

function isPrivateLanHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  )
}

/**
 * Comma-separated list of additional allowed origins, read from the
 * `BROKER_ALLOWED_ORIGINS` env var. Used by the production deploy to
 * allow the Even Hub portal origin (or any other production WebView
 * host) without a code change. Local-dev behavior is unchanged when
 * the env var is unset.
 *
 * Example: `BROKER_ALLOWED_ORIGINS=https://hub.evenrealities.com,https://g2-captions-broker.fly.dev`
 */
export function getExtraAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.BROKER_ALLOWED_ORIGINS
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
}

export function isAllowedTokenBrokerOrigin(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return true

  if (getExtraAllowedOrigins(env).has(origin)) return true

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && url.port === '5173' && isPrivateLanHost(url.hostname)
  } catch {
    return false
  }
}

/**
 * The Access-Control-Allow-Origin response header. We echo back the
 * caller's Origin when it's present so the browser will accept the
 * response — the actual security boundary is the bearer-token gate on
 * the request, not the CORS reply. When the caller sends no Origin
 * (curl, scripts), we fall back to a benign default that won't grant
 * any browser meaningful access.
 *
 * Note: this is permissive on purpose. If the origin allowlist needs to
 * be the security gate (e.g., bearer is unset and we're in pure dev
 * mode), the rejection happens earlier on the actual request — by then
 * we've already returned a 4xx, so the ACAO reflection doesn't matter.
 */
export function getTokenBrokerCorsOrigin(origin: string | undefined, _env: NodeJS.ProcessEnv = process.env): string {
  if (origin && origin.length > 0) return origin
  return 'http://127.0.0.1:5173'
}
