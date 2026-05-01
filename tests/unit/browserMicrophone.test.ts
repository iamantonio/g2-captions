import { describe, expect, it, vi } from 'vitest'
import { BrowserMicrophonePcmSource, downsampleFloat32ToPcmS16Le } from '../../src/audio/browserMicrophone'

describe('downsampleFloat32ToPcmS16Le', () => {
  it('converts and downsamples microphone Float32 samples to 16kHz signed PCM', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])

    const pcm = downsampleFloat32ToPcmS16Le(input, { inputSampleRate: 48_000, outputSampleRate: 16_000 })

    expect([...new Int16Array(pcm)]).toEqual([0, 32767])
  })
})

describe('BrowserMicrophonePcmSource', () => {
  it('surfaces permission and capture states visually', async () => {
    const statuses: string[] = []
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream)
    const source = new BrowserMicrophonePcmSource({
      getUserMedia,
      createAudioContext: () => ({ close: vi.fn(async () => undefined) }) as unknown as AudioContext,
      onVisualStatus: (status) => statuses.push(status),
      onChunk: vi.fn(),
    })

    await source.start()
    await source.stop()

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false },
    })
    expect(statuses).toContain('BROWSER MIC PERMISSION — waiting')
    expect(statuses).toContain('BROWSER MIC LIVE — captions streaming')
    expect(statuses).toContain('BROWSER MIC STOPPED — captions paused')
  })

  it('renders denied microphone permission as a visual-only error', async () => {
    const statuses: string[] = []
    const source = new BrowserMicrophonePcmSource({
      getUserMedia: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
      createAudioContext: () => ({ close: vi.fn(async () => undefined) }) as unknown as AudioContext,
      onVisualStatus: (status) => statuses.push(status),
      onChunk: vi.fn(),
    })

    await expect(source.start()).rejects.toThrow(/microphone/i)

    expect(statuses).toEqual(['BROWSER MIC PERMISSION — waiting', 'BROWSER MIC DENIED — captions paused'])
  })
})
