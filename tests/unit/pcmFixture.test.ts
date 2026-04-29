import { describe, expect, it } from 'vitest'
import { chunkPcmS16Le, createSilentPcmS16LeFixture } from '../../src/audio/pcmFixture'

describe('PCM fixture utilities', () => {
  it('creates 16 kHz 16-bit mono silence with predictable byte length', () => {
    const fixture = createSilentPcmS16LeFixture({ durationMs: 1000, sampleRate: 16_000 })

    expect(fixture.sampleRate).toBe(16_000)
    expect(fixture.encoding).toBe('pcm_s16le')
    expect(fixture.data.byteLength).toBe(32_000)
  })

  it('chunks PCM into paced 100ms frames for AssemblyAI streaming', () => {
    const fixture = createSilentPcmS16LeFixture({ durationMs: 250, sampleRate: 16_000 })
    const chunks = chunkPcmS16Le(fixture, { chunkMs: 100 })

    expect(chunks.map((chunk) => chunk.durationMs)).toEqual([100, 100, 50])
    expect(chunks.map((chunk) => chunk.data.byteLength)).toEqual([3200, 3200, 1600])
    expect(chunks.map((chunk) => chunk.seq)).toEqual([1, 2, 3])
  })
})
