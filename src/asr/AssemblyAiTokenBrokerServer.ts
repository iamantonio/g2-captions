export function getTokenBrokerBindHost(env: NodeJS.ProcessEnv): string {
  return env.ASSEMBLYAI_TOKEN_BROKER_HOST || env.HOST || '127.0.0.1'
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

export function isAllowedTokenBrokerOrigin(origin: string | undefined): boolean {
  if (!origin) return true

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && url.port === '5173' && isPrivateLanHost(url.hostname)
  } catch {
    return false
  }
}

export function getTokenBrokerCorsOrigin(origin: string | undefined): string {
  if (origin && isAllowedTokenBrokerOrigin(origin)) return origin
  return 'http://127.0.0.1:5173'
}
