import { describe, expect, it, vi } from 'vitest'
import { loadPcmS16LeFixtureFromUrl } from '../../src/audio/pcmFixture'

describe('PCM speech fixture loader', () => {
  it('loads a real-speech PCM fixture from a URL with explicit sample rate metadata', async () => {
    const bytes = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }))

    const fixture = await loadPcmS16LeFixtureFromUrl('/fixtures/speech-smoke.pcm', {
      sampleRate: 16_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledWith('/fixtures/speech-smoke.pcm')
    expect(fixture.sampleRate).toBe(16_000)
    expect(fixture.encoding).toBe('pcm_s16le')
    expect([...new Uint8Array(fixture.data)]).toEqual([...bytes])
  })

  it('fails closed when a speech PCM fixture cannot be loaded', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }))

    await expect(
      loadPcmS16LeFixtureFromUrl('/fixtures/missing.pcm', {
        sampleRate: 16_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/speech pcm fixture/i)
  })
})
