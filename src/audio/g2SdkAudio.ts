import type { PcmChunk } from './pcmFixture'

export interface G2AudioBridgeEvent {
  audioEvent?: { audioPcm: Uint8Array }
}

export interface G2AudioBridge {
  audioControl(isOpen: boolean): Promise<boolean>
  onEvenHubEvent(callback: (event: G2AudioBridgeEvent) => void): () => void
}

export interface G2SdkAudioSourceOptions {
  bridge: G2AudioBridge
  onChunk: (chunk: PcmChunk) => void | Promise<void>
  onVisualStatus: (status: string) => void
  sampleRate?: number
}

export class G2SdkAudioSource {
  private seq = 0
  private unsubscribe: (() => void) | undefined

  constructor(private readonly options: G2SdkAudioSourceOptions) {}

  async start(): Promise<void> {
    this.options.onVisualStatus('G2 MIC STARTING — waiting audio')
    this.unsubscribe = this.options.bridge.onEvenHubEvent((event) => {
      if (!event.audioEvent) return
      this.handleAudioPcm(event.audioEvent.audioPcm)
    })
    const ok = await this.options.bridge.audioControl(true)
    if (!ok) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.options.onVisualStatus('G2 MIC FAILED — captions paused')
      throw new Error('G2 SDK audio failed to start')
    }
    this.options.onVisualStatus('G2 MIC LIVE — captions streaming')
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.options.bridge.audioControl(false)
    this.options.onVisualStatus('G2 MIC STOPPED — captions paused')
  }

  private handleAudioPcm(audioPcm: Uint8Array): void {
    this.seq += 1
    const data = new Uint8Array(audioPcm).buffer
    void this.options.onChunk({
      seq: this.seq,
      data,
      durationMs: Math.round((audioPcm.byteLength / 2 / (this.options.sampleRate ?? 16_000)) * 1000),
    })
  }
}
