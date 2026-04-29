import { describe, expect, it } from 'vitest'
import { getDefaultTokenEndpoint, getSpeechFixtureUrl, shouldAutoRunHardwareSmoke } from '../../src/app/runtimeConfig'

describe('runtime config for Hub hardware smoke tests', () => {
  it('uses local broker on 127.0.0.1 when running local browser preview', () => {
    const endpoint = getDefaultTokenEndpoint(new URL('http://127.0.0.1:5173/'))

    expect(endpoint).toBe('http://127.0.0.1:8787/assemblyai/token')
  })

  it('uses the LAN host that served the app when running on a phone/Hub WebView', () => {
    const endpoint = getDefaultTokenEndpoint(new URL('http://172.20.10.5:5173/'))

    expect(endpoint).toBe('http://172.20.10.5:8787/assemblyai/token')
  })

  it('resolves speech fixtures relative to the app document instead of absolute site root', () => {
    expect(getSpeechFixtureUrl(new URL('http://172.20.10.5:5173/index.html'))).toBe(
      'http://172.20.10.5:5173/fixtures/speech-smoke.pcm',
    )
    expect(getSpeechFixtureUrl(new URL('https://hub.local/apps/g2-captions/index.html'))).toBe(
      'https://hub.local/apps/g2-captions/fixtures/speech-smoke.pcm',
    )
  })

  it('auto-runs the fixture smoke test on Hub unless disabled by query param', () => {
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/'), true)).toBe(true)
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/?autoSmoke=0'), true)).toBe(false)
  })

  it('does not auto-run outside the Even Hub bridge', () => {
    expect(shouldAutoRunHardwareSmoke(new URL('http://172.20.10.5:5173/'), false)).toBe(false)
  })
})
