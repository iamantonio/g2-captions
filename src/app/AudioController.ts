import type { PcmChunk } from '../audio/pcmFixture'
import type { G2AudioBridge } from '../audio/g2SdkAudio'
import type { ClientLogger } from '../observability/clientLogger'

export interface LiveAudioSource {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface LiveAudioSourceFactoryDeps {
  onChunk: (chunk: PcmChunk) => Promise<void>
  onVisualStatus: (status: string) => void
  onError: (stage: string, err: unknown, details?: Record<string, unknown>) => void
  onStageLog: (stage: string, details?: Record<string, unknown>) => void
}

export interface AudioControllerOptions {
  logger: ClientLogger
  onVisualStatus: (status: string) => void
  /** Forwards a PCM chunk to the ASR controller. */
  sendChunk: (chunk: PcmChunk) => Promise<void>
  browserMicFactory: (deps: LiveAudioSourceFactoryDeps) => LiveAudioSource
  g2SdkAudioFactory: (bridge: G2AudioBridge, deps: LiveAudioSourceFactoryDeps) => LiveAudioSource
}

/**
 * Owns the active live PCM source (browser-mic or G2 SDK). Switching
 * between sources stops the previous one. PCM chunks are forwarded to ASR
 * via `sendChunk`; chunk-send failures surface a visual status string
 * instead of throwing, so the deaf-first failure-visibility invariant
 * is preserved when the upstream WebSocket has dropped.
 */
export class AudioController {
  private liveAudioSource: LiveAudioSource | undefined

  constructor(private readonly options: AudioControllerOptions) {}

  hasActiveSource(): boolean {
    return this.liveAudioSource !== undefined
  }

  async stop(status: string, render = true): Promise<void> {
    await this.liveAudioSource?.stop()
    this.liveAudioSource = undefined
    if (render) this.options.onVisualStatus(status)
  }

  async startBrowserMic(): Promise<void> {
    await this.stop('BROWSER MIC RESTARTING — captions paused', false)
    const source = this.options.browserMicFactory(
      this.makeDeps('browser_mic', 'BROWSER MIC STREAM FAILED — captions paused'),
    )
    this.liveAudioSource = source
    try {
      await source.start()
    } catch (err) {
      this.options.logger.error('browser_mic_start_failed', err)
      this.liveAudioSource = undefined
    }
  }

  async startG2SdkAudio(bridge: G2AudioBridge | undefined): Promise<void> {
    this.options.logger.stage('g2_sdk_audio_start_requested')
    if (!bridge) {
      this.options.logger.warn('g2_sdk_audio_bridge_unavailable')
      this.options.onVisualStatus('G2 MIC FAILED — bridge unavailable')
      return
    }
    this.options.logger.stage('g2_sdk_audio_stop_previous_start')
    await this.stop('G2 MIC RESTARTING — captions paused', false)
    this.options.logger.stage('g2_sdk_audio_stop_previous_done')
    const source = this.options.g2SdkAudioFactory(
      bridge,
      this.makeDeps('g2_sdk_audio', 'G2 MIC STREAM FAILED — captions paused'),
    )
    this.liveAudioSource = source
    try {
      this.options.logger.stage('g2_sdk_audio_source_start_call')
      await source.start()
      this.options.logger.stage('g2_sdk_audio_source_start_done')
    } catch (err) {
      this.options.logger.error('g2_sdk_audio_source_start_failed', err)
      this.liveAudioSource = undefined
    }
  }

  private makeDeps(stagePrefix: string, sendFailureStatus: string): LiveAudioSourceFactoryDeps {
    return {
      onVisualStatus: this.options.onVisualStatus,
      onError: (stage, err, details) => this.options.logger.error(stage, err, details),
      onStageLog: (stage, details) => this.options.logger.stage(stage, details),
      onChunk: async (chunk) => {
        if (stagePrefix === 'g2_sdk_audio') {
          this.options.logger.stage('g2_sdk_audio_chunk_send_start', {
            seq: chunk.seq,
            byteLength: chunk.data.byteLength,
            durationMs: chunk.durationMs,
          })
        }
        try {
          await this.options.sendChunk(chunk)
          if (stagePrefix === 'g2_sdk_audio') {
            this.options.logger.stage('g2_sdk_audio_chunk_send_done', { seq: chunk.seq })
          }
        } catch (err) {
          this.options.logger.error(`${stagePrefix}_chunk_send_failed`, err, { seq: chunk.seq })
          this.options.onVisualStatus(sendFailureStatus)
        }
      },
    }
  }
}
