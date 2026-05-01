import { describe, expect, it } from 'vitest'
import { buildDeepgramProxyUpstreamUrl, buildDeepgramProxyHeaders } from '../../src/asr/DeepgramProxy'

describe('Deepgram local streaming proxy helpers', () => {
  it('forwards listen query params to Deepgram and keeps auth out of the browser URL', () => {
    const upstream = buildDeepgramProxyUpstreamUrl(
      '/deepgram/listen?model=nova-3&encoding=linear16&keyterm=ProvenMachine',
    )

    expect(upstream.origin).toBe('wss://api.deepgram.com')
    expect(upstream.pathname).toBe('/v1/listen')
    expect(upstream.searchParams.get('model')).toBe('nova-3')
    expect(upstream.searchParams.get('encoding')).toBe('linear16')
    expect(upstream.searchParams.getAll('keyterm')).toEqual(['ProvenMachine'])
    expect(upstream.toString()).not.toContain('server-side-key')
  })

  it('builds upstream Authorization headers from the server-side key only', () => {
    expect(buildDeepgramProxyHeaders('server-side-key')).toEqual({ Authorization: 'Token server-side-key' })
  })
})
