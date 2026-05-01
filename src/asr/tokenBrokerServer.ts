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

export function getTokenBrokerCorsOrigin(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (origin && isAllowedTokenBrokerOrigin(origin, env)) return origin
  return 'http://127.0.0.1:5173'
}
