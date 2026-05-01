import type { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import type { G2LensDisplay } from '../display/g2LensDisplay'
import type { ClientLogger } from '../observability/clientLogger'
import type { TelemetryReporter } from './TelemetryReporter'

export interface UIShellHandlers {
  onConnectDeepgram(): void
  onStreamSilentFixture(): void
  onStreamSpeechFixture(): void
  onStartBrowserMic(): void
  onStartG2SdkAudio(): void
  onStopLiveAudio(): void
  onTerminate(): void
}

export interface UIShellOptions {
  root: HTMLElement
  state: CaptionState
  telemetry: TelemetryReporter
  logger: ClientLogger
  handlers: UIShellHandlers
  documentImpl?: Document
}

const DEFAULT_STATUS = 'READY — starting caption check'

/**
 * Owns the DOM root: rendered caption frame, visual status, six action
 * buttons, and the telemetry JSON `<details>` panel. Forwards the active
 * frame text to the optional G2LensDisplay; failures are surfaced inline as
 * a warning row (deaf-first: every failure must be visible).
 */
export class UIShell {
  private currentVisualStatus = DEFAULT_STATUS
  private lastFrameText = ''
  private g2Display: G2LensDisplay | undefined
  private readonly doc: Document

  constructor(private readonly options: UIShellOptions) {
    this.doc = options.documentImpl ?? options.root.ownerDocument
  }

  attachG2Display(display: G2LensDisplay): void {
    this.g2Display = display
  }

  getLastFrameText(): string {
    return this.lastFrameText
  }

  getVisualStatus(): string {
    return this.currentVisualStatus
  }

  async renderLens(frameText: string): Promise<void> {
    if (!this.g2Display) return
    const result = await this.g2Display.render(frameText)
    if (result.ok === false) {
      this.options.logger.error('g2_display_failed', new Error(result.visualStatus), { frameText })
      const warning = this.doc.createElement('div')
      warning.setAttribute('role', 'status')
      warning.textContent = result.visualStatus
      this.options.root.append(warning)
    }
  }

  render(status: string = this.currentVisualStatus): void {
    this.currentVisualStatus = status
    const frame = formatCaptionFrame(this.options.state.segments(), {
      title: 'G2 CAPTIONS',
      status,
      maxLines: 6,
      lineWidth: 34,
    })
    this.lastFrameText = frame.text

    this.options.root.replaceChildren()
    const pre = this.doc.createElement('pre')
    pre.textContent = frame.text
    this.options.root.append(pre)
    void this.renderLens(frame.text)
    this.renderTelemetryReport()
    this.renderButtons()
  }

  private renderTelemetryReport(): void {
    const report = this.options.telemetry.report()
    if (!report) return

    const details = this.doc.createElement('details')
    details.open = true
    const summary = this.doc.createElement('summary')
    summary.textContent = 'Telemetry JSON'
    details.append(summary)

    const reportPre = this.doc.createElement('pre')
    reportPre.setAttribute('aria-label', 'Latest benchmark telemetry JSON')
    reportPre.textContent = JSON.stringify(report, null, 2)
    details.append(reportPre)
    this.options.root.append(details)
  }

  private renderButtons(): void {
    const { handlers, logger } = this.options
    this.appendButton('Connect Deepgram', () => {
      logger.stage('button_connect_deepgram')
      handlers.onConnectDeepgram()
    })
    this.appendButton('Stream Silent PCM Fixture', () => {
      logger.stage('button_stream_silent_fixture')
      handlers.onStreamSilentFixture()
    })
    this.appendButton('Stream Speech PCM Fixture', () => {
      logger.stage('button_stream_speech_fixture')
      handlers.onStreamSpeechFixture()
    })
    this.appendButton('Start Browser Mic', () => {
      logger.stage('button_start_browser_mic')
      handlers.onStartBrowserMic()
    })
    this.appendButton('Start G2 SDK Audio', () => {
      logger.stage('button_start_g2_sdk_audio')
      handlers.onStartG2SdkAudio()
    })
    this.appendButton('Stop Live Audio', () => handlers.onStopLiveAudio())
    this.appendButton('Terminate', () => handlers.onTerminate())
  }

  private appendButton(label: string, onClick: () => void): void {
    const button = this.doc.createElement('button')
    button.textContent = label
    button.addEventListener('click', onClick)
    this.options.root.append(button)
  }
}
