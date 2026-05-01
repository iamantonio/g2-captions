import { describe, expect, it } from 'vitest'
import {
  getExtraAllowedOrigins,
  getTokenBrokerBindHost,
  getTokenBrokerCorsOrigin,
  isAllowedTokenBrokerOrigin,
} from '../../src/asr/tokenBrokerServer'

describe('token broker server config', () => {
  it('binds to 127.0.0.1 by default for local safety', () => {
    expect(getTokenBrokerBindHost({})).toBe('127.0.0.1')
  })

  it('binds to HOST when explicitly set for Hub LAN hardware tests', () => {
    expect(getTokenBrokerBindHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0')
    expect(getTokenBrokerBindHost({ TOKEN_BROKER_HOST: '0.0.0.0' })).toBe('0.0.0.0')
    expect(getTokenBrokerBindHost({ ASSEMBLYAI_TOKEN_BROKER_HOST: '0.0.0.0' })).toBe('0.0.0.0')
  })

  it('allows localhost and private LAN Vite origins during local hardware tests', () => {
    expect(isAllowedTokenBrokerOrigin('http://127.0.0.1:5173', {})).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://localhost:5173', {})).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://172.20.10.5:5173', {})).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://192.168.1.20:5173', {})).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://10.0.0.10:5173', {})).toBe(true)
  })

  it('rejects unrelated public origins by default', () => {
    expect(isAllowedTokenBrokerOrigin('https://example.com', {})).toBe(false)
    expect(isAllowedTokenBrokerOrigin('http://172.20.10.5:9999', {})).toBe(false)
  })

  it('admits any origin listed in BROKER_ALLOWED_ORIGINS so production deploys can whitelist Even Hub or Fly origins', () => {
    const env = { BROKER_ALLOWED_ORIGINS: 'https://hub.evenrealities.com,https://g2-captions-broker.fly.dev' }
    expect(isAllowedTokenBrokerOrigin('https://hub.evenrealities.com', env)).toBe(true)
    expect(isAllowedTokenBrokerOrigin('https://g2-captions-broker.fly.dev', env)).toBe(true)
    expect(isAllowedTokenBrokerOrigin('https://other.example.com', env)).toBe(false)
  })

  it('parses BROKER_ALLOWED_ORIGINS by stripping whitespace and ignoring empty entries', () => {
    expect(getExtraAllowedOrigins({ BROKER_ALLOWED_ORIGINS: ' https://a.test , https://b.test , , ' })).toEqual(
      new Set(['https://a.test', 'https://b.test']),
    )
    expect(getExtraAllowedOrigins({ BROKER_ALLOWED_ORIGINS: '' })).toEqual(new Set())
    expect(getExtraAllowedOrigins({})).toEqual(new Set())
  })

  it('CORS reply origin reflects an env-listed origin instead of the hardcoded loopback fallback', () => {
    const env = { BROKER_ALLOWED_ORIGINS: 'https://hub.evenrealities.com' }
    expect(getTokenBrokerCorsOrigin('https://hub.evenrealities.com', env)).toBe('https://hub.evenrealities.com')
    expect(getTokenBrokerCorsOrigin('https://blocked.example.com', env)).toBe('http://127.0.0.1:5173')
  })
})
