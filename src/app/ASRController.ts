import type { PcmChunk } from '../audio/pcmFixture'
import type { CaptionState } from '../captions/CaptionState'
import type { BenchmarkTelemetryDetails, BenchmarkTelemetryStage } from '../captions/latency'
import type { ClientLogger } from '../observability/clientLogger'
import type { RawAsrEvent } from '../types'
import { createRenderScheduler, type RenderScheduler } from './renderScheduler'
import type { TelemetryReporter } from './TelemetryReporter'

export interface AsrLiveSession {
  connect(): Promise<void>
  streamPcmChunks(chunks: PcmChunk[]): Promise<void>
  sendPcmChunk(chunk: PcmChunk): Promise<void>
  terminate(closeStatus?: string): void
}

export interface AsrLiveSessionDeps {
  onTranscript: (event: RawAsrEvent) => void
  onVisualStatus: (status: string) => void
  onTelemetry: (stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails) => void
  onError: (stage: string, err: unknown, details?: Record<string, unknown>) => void
}

export type AsrLiveSessionFactory = (deps: AsrLiveSessionDeps) => AsrLiveSession

export interface ASRControllerOptions {
  state: CaptionState
  telemetry: TelemetryReporter
  logger: ClientLogger
  sessionFactory: AsrLiveSessionFactory
  /** Forwarded after every transcript/visual-status update. */
  onShellRender: (status?: string) => void
  /** Inject a custom scheduler (test only). Defaults to a 150ms throttle. */
  renderSchedulerFactory?: (render: () => void) => RenderScheduler
}

/**
 * Owns the lifecycle of the active vendor LiveSession. main.ts wires a
 * session factory (today: DeepgramLiveSession) so the controller is
 * vendor-agnostic and unit-testable without a real WebSocket. Visual
 * statuses always flow through `onShellRender` to preserve the
 * deaf-first contract: every error or state change updates the phone shell.
 */
export class ASRController {
  private session: AsrLiveSession | undefined
  private readonly renderScheduler: RenderScheduler

  constructor(private readonly options: ASRControllerOptions) {
    const defaultFactory = (render: () => void) => createRenderScheduler({ render })
    this.renderScheduler = (options.renderSchedulerFactory ?? defaultFactory)(() => this.options.onShellRender())
  }

  isConnected(): boolean {
    return this.session !== undefined
  }

  async connect(fixtureId = 'speech-smoke'): Promise<void> {
    this.options.logger.stage('asr_connect_start', { fixtureId })
    this.renderScheduler.cancel()
    this.options.state.clear()
    this.session?.terminate()
    this.options.telemetry.start(fixtureId)
    this.session = this.options.sessionFactory({
      onTranscript: (event) => {
        // State updates are immediate so the next render reflects the latest
        // transcript regardless of debounce. Only the render call itself is
        // throttled — partials collapse to one render per scheduler window;
        // finals flush synchronously so the caption locks in without lag.
        this.options.state.applyAsrEvent(event)
        this.options.telemetry.mark('caption_formatted')
        this.options.telemetry.mark('display_update_sent')
        this.options.logger.stage('speaker_label_observed', {
          speaker: event.speaker ?? '?',
          status: event.status,
          textLength: event.text.length,
        })
        if (event.status === 'final') {
          this.renderScheduler.flushFinal()
        } else {
          this.renderScheduler.schedulePartial()
        }
      },
      onVisualStatus: (status) => this.options.onShellRender(status),
      onTelemetry: (stage, details) => this.options.telemetry.mark(stage, details),
      onError: (stage, err, details) => this.options.logger.error(stage, err, details),
    })

    try {
      await this.session.connect()
      this.options.logger.stage('asr_connect_success')
      this.options.onShellRender('ASR CONNECTED — waiting audio')
    } catch (err) {
      this.options.logger.error('asr_connect_failed', err)
      // Underlying LiveSession already rendered a visual failure state.
    }
  }

  async ensureConnected(fixtureId: string): Promise<void> {
    if (this.session) return
    await this.connect(fixtureId)
  }

  async streamPcmChunks(chunks: PcmChunk[]): Promise<void> {
    if (!this.session) throw new Error('ASR session is not connected')
    await this.session.streamPcmChunks(chunks)
  }

  async sendPcmChunk(chunk: PcmChunk): Promise<void> {
    if (!this.session) throw new Error('ASR session is not connected')
    await this.session.sendPcmChunk(chunk)
  }

  terminate(closeStatus?: string): void {
    this.renderScheduler.cancel()
    this.session?.terminate(closeStatus)
    this.session = undefined
  }
}
