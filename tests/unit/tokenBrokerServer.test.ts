import { describe, expect, it } from 'vitest'
import { getTokenBrokerBindHost, isAllowedTokenBrokerOrigin } from '../../src/asr/tokenBrokerServer'

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
    expect(isAllowedTokenBrokerOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://172.20.10.5:5173')).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://192.168.1.20:5173')).toBe(true)
    expect(isAllowedTokenBrokerOrigin('http://10.0.0.10:5173')).toBe(true)
  })

  it('rejects unrelated public origins', () => {
    expect(isAllowedTokenBrokerOrigin('https://example.com')).toBe(false)
    expect(isAllowedTokenBrokerOrigin('http://172.20.10.5:9999')).toBe(false)
  })
})
