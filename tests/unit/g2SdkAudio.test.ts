import { describe, expect, it, vi } from 'vitest'
import { G2SdkAudioSource, type G2AudioBridge } from '../../src/audio/g2SdkAudio'

describe('G2SdkAudioSource', () => {
  it('opens SDK audio, forwards PCM chunks, and closes capture explicitly', async () => {
    const statuses: string[] = []
    let listener: ((event: { audioEvent?: { audioPcm: Uint8Array } }) => void) | undefined
    const unsubscribe = vi.fn()
    const bridge: G2AudioBridge = {
      audioControl: vi.fn(async () => true),
      onEvenHubEvent: vi.fn((callback) => {
        listener = callback
        return unsubscribe
      }),
    }
    const onChunk = vi.fn()
    const source = new G2SdkAudioSource({ bridge, onChunk, onVisualStatus: (status) => statuses.push(status) })

    await source.start()
    listener?.({ audioEvent: { audioPcm: new Uint8Array([1, 0, 2, 0]) } })
    await source.stop()

    expect(bridge.audioControl).toHaveBeenNthCalledWith(1, true)
    expect(bridge.audioControl).toHaveBeenNthCalledWith(2, false)
    expect(unsubscribe).toHaveBeenCalled()
    expect(onChunk).toHaveBeenCalledWith({ seq: 1, data: expect.any(ArrayBuffer), durationMs: 0 })
    expect([...new Uint8Array(onChunk.mock.calls[0][0].data)]).toEqual([1, 0, 2, 0])
    expect(statuses).toContain('G2 MIC LIVE — captions streaming')
    expect(statuses).toContain('G2 MIC STOPPED — captions paused')
  })

  it('renders SDK audio startup failure visually', async () => {
    const statuses: string[] = []
    const bridge: G2AudioBridge = {
      audioControl: vi.fn(async () => false),
      onEvenHubEvent: vi.fn(() => vi.fn()),
    }
    const source = new G2SdkAudioSource({ bridge, onChunk: vi.fn(), onVisualStatus: (status) => statuses.push(status) })

    await expect(source.start()).rejects.toThrow(/g2 sdk audio/i)

    expect(statuses).toEqual(['G2 MIC STARTING — waiting audio', 'G2 MIC FAILED — captions paused'])
  })
})
