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
  onStageLog?: (stage: string, details?: Record<string, unknown>) => void
  sampleRate?: number
  /**
   * G2 mic PCM can arrive too quiet for far-field speech. Apply conservative
   * client-side gain before sending to ASR. 1 disables amplification.
   */
  inputGain?: number
}

export function amplifyPcmS16Le(audioPcm: Uint8Array, gain: number): Uint8Array {
  if (!Number.isFinite(gain) || gain <= 1) return new Uint8Array(audioPcm)

  const output = new Uint8Array(audioPcm.byteLength)
  const view = new DataView(output.buffer)
  for (let i = 0; i + 1 < audioPcm.byteLength; i += 2) {
    const sample = audioPcm[i] | (audioPcm[i + 1] << 8)
    const signed = sample & 0x8000 ? sample - 0x10000 : sample
    const amplified = Math.max(-32768, Math.min(32767, Math.round(signed * gain)))
    view.setInt16(i, amplified, true)
  }
  return output
}

export class G2SdkAudioSource {
  private seq = 0
  private unsubscribe: (() => void) | undefined

  constructor(private readonly options: G2SdkAudioSourceOptions) {}

  async start(): Promise<void> {
    this.options.onStageLog?.('g2_audio_source_start')
    this.options.onVisualStatus('G2 MIC STARTING — waiting audio')
    this.unsubscribe = this.options.bridge.onEvenHubEvent((event) => {
      if (!event.audioEvent) return
      this.handleAudioPcm(event.audioEvent.audioPcm)
    })
    this.options.onStageLog?.('g2_audio_listener_registered')
    this.options.onStageLog?.('g2_audio_control_open_start')
    const ok = await this.options.bridge.audioControl(true)
    this.options.onStageLog?.('g2_audio_control_open_result', { ok })
    if (!ok) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.options.onStageLog?.('g2_audio_control_open_failed')
      this.options.onVisualStatus('G2 MIC FAILED — captions paused')
      throw new Error('G2 SDK audio failed to start')
    }
    this.options.onVisualStatus('G2 MIC LIVE — captions streaming')
  }

  async stop(): Promise<void> {
    this.options.onStageLog?.('g2_audio_source_stop_start')
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.options.onStageLog?.('g2_audio_listener_unsubscribed')
    await this.options.bridge.audioControl(false)
    this.options.onStageLog?.('g2_audio_control_close_done')
    this.options.onVisualStatus('G2 MIC STOPPED — captions paused')
  }

  private handleAudioPcm(audioPcm: Uint8Array): void {
    this.seq += 1
    const gain = this.options.inputGain ?? 4
    const durationMs = Math.round((audioPcm.byteLength / 2 / (this.options.sampleRate ?? 16_000)) * 1000)
    this.options.onStageLog?.('g2_audio_pcm_received', {
      byteLength: audioPcm.byteLength,
      durationMs,
      inputGain: gain,
      seq: this.seq,
    })
    const amplifiedPcm = amplifyPcmS16Le(audioPcm, gain)
    const data = amplifiedPcm.buffer.slice(
      amplifiedPcm.byteOffset,
      amplifiedPcm.byteOffset + amplifiedPcm.byteLength,
    ) as ArrayBuffer
    void this.options.onChunk({
      seq: this.seq,
      data,
      durationMs,
    })
  }
}
