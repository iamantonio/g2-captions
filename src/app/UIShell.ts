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
  /** When true, exposes all internal controls + telemetry. Default false. */
  debug?: boolean
}

const DEFAULT_STATUS = 'READY — starting caption check'

/** App-level lifecycle the production UI cares about. */
export type AppLifecycle = 'idle' | 'connecting' | 'live' | 'stopped'

/**
 * Owns the DOM root. Two presentation modes:
 *
 * - **Production** (default): single caption surface, single primary
 *   action button (Start / Stop captions), status pill, no debug
 *   panels. Targets end users on real hardware.
 * - **Debug** (`?debug=1`): the production caption surface plus all
 *   internal controls (fixture playback, raw Connect, browser mic,
 *   telemetry JSON). Targets developers running smoke tests.
 *
 * The lens forwarder is mode-agnostic; failures still surface as an
 * inline `role="status"` row regardless of mode (deaf-first contract).
 */
export class UIShell {
  private currentVisualStatus = DEFAULT_STATUS
  private lastFrameText = ''
  private g2Display: G2LensDisplay | undefined
  private lifecycle: AppLifecycle = 'idle'
  private readonly doc: Document
  private readonly debug: boolean

  constructor(private readonly options: UIShellOptions) {
    this.doc = options.documentImpl ?? options.root.ownerDocument
    this.debug = options.debug ?? false
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

  getLifecycle(): AppLifecycle {
    return this.lifecycle
  }

  /**
   * Production-UI lifecycle is derived from visual statuses. The
   * controllers fire visual statuses on every meaningful state change
   * (deaf-first); we map those strings into a small enum the UI uses
   * to pick the primary button label and the status pill.
   */
  setLifecycle(next: AppLifecycle): void {
    this.lifecycle = next
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
    this.lifecycle = lifecycleFromStatus(status, this.lifecycle)

    const frame = formatCaptionFrame(this.options.state.segments(), {
      title: 'G2 CAPTIONS',
      status,
      maxLines: 6,
      lineWidth: 34,
    })
    this.lastFrameText = frame.text

    this.options.root.replaceChildren()
    if (this.debug) {
      this.renderDebugView(frame.text)
    } else {
      this.renderProductionView(frame.text)
    }
    void this.renderLens(frame.text)
  }

  private renderProductionView(frameText: string): void {
    const container = this.doc.createElement('div')
    container.className = 'g2-shell g2-shell--production'

    const header = this.doc.createElement('header')
    header.className = 'g2-shell__header'
    const title = this.doc.createElement('h1')
    title.textContent = 'G2 Captions'
    header.append(title)
    const statusPill = this.doc.createElement('span')
    statusPill.className = `g2-shell__status g2-shell__status--${this.lifecycle}`
    statusPill.setAttribute('role', 'status')
    statusPill.setAttribute('aria-live', 'polite')
    statusPill.textContent = humanStatusLabel(this.lifecycle)
    header.append(statusPill)
    container.append(header)

    const captionRegion = this.doc.createElement('section')
    captionRegion.className = 'g2-shell__captions'
    captionRegion.setAttribute('aria-label', 'Live captions')
    captionRegion.setAttribute('role', 'log')
    captionRegion.setAttribute('aria-live', 'polite')
    const pre = this.doc.createElement('pre')
    pre.className = 'g2-shell__frame'
    pre.textContent = frameText
    captionRegion.append(pre)
    container.append(captionRegion)

    const controls = this.doc.createElement('footer')
    controls.className = 'g2-shell__controls'
    const primary = this.doc.createElement('button')
    primary.className = 'g2-shell__primary'
    primary.type = 'button'
    if (this.lifecycle === 'connecting') {
      primary.textContent = 'Connecting…'
      primary.disabled = true
    } else if (this.lifecycle === 'live') {
      primary.textContent = 'Stop captions'
      primary.addEventListener('click', () => this.options.handlers.onTerminate())
    } else {
      primary.textContent = this.lifecycle === 'stopped' ? 'Start again' : 'Start captions'
      primary.addEventListener('click', () => {
        this.options.logger.stage('button_start_captions')
        this.options.handlers.onStartG2SdkAudio()
      })
    }
    controls.append(primary)
    container.append(controls)

    this.options.root.append(container)
  }

  private renderDebugView(frameText: string): void {
    const container = this.doc.createElement('div')
    container.className = 'g2-shell g2-shell--debug'

    const pre = this.doc.createElement('pre')
    pre.className = 'g2-shell__frame'
    pre.textContent = frameText
    container.append(pre)

    this.renderTelemetryReport(container)
    this.renderDebugButtons(container)
    this.options.root.append(container)
  }

  private renderTelemetryReport(parent: HTMLElement): void {
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
    parent.append(details)
  }

  private renderDebugButtons(parent: HTMLElement): void {
    const { handlers, logger } = this.options
    this.appendButton(parent, 'Connect Deepgram', () => {
      logger.stage('button_connect_deepgram')
      handlers.onConnectDeepgram()
    })
    this.appendButton(parent, 'Stream Silent PCM Fixture', () => {
      logger.stage('button_stream_silent_fixture')
      handlers.onStreamSilentFixture()
    })
    this.appendButton(parent, 'Stream Speech PCM Fixture', () => {
      logger.stage('button_stream_speech_fixture')
      handlers.onStreamSpeechFixture()
    })
    this.appendButton(parent, 'Start Browser Mic', () => {
      logger.stage('button_start_browser_mic')
      handlers.onStartBrowserMic()
    })
    this.appendButton(parent, 'Start G2 SDK Audio', () => {
      logger.stage('button_start_g2_sdk_audio')
      handlers.onStartG2SdkAudio()
    })
    this.appendButton(parent, 'Stop Live Audio', () => handlers.onStopLiveAudio())
    this.appendButton(parent, 'Terminate', () => handlers.onTerminate())
  }

  private appendButton(parent: HTMLElement, label: string, onClick: () => void): void {
    const button = this.doc.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', onClick)
    parent.append(button)
  }
}

/**
 * Mapping from the controllers' visual-status strings into the small
 * lifecycle enum the production UI cares about. The status strings
 * originate in DeepgramLiveSession / AudioController / main.ts; this
 * stays a one-way function because the strings are also rendered as
 * the lens caption footer.
 */
export function lifecycleFromStatus(status: string, previous: AppLifecycle): AppLifecycle {
  if (/^G2 MIC LIVE|^BROWSER MIC LIVE|^AUDIO FIXTURE STREAMING|^AUDIO SPEECH FIXTURE STREAMING/i.test(status))
    return 'live'
  if (
    /^CONNECTING|^G2 MIC STARTING|^G2 MIC RESTARTING|^BROWSER MIC RESTARTING|^BROWSER MIC PERMISSION|^HARDWARE SMOKE|^AUDIO SPEECH FIXTURE LOADING/i.test(
      status,
    )
  )
    return 'connecting'
  if (/^ASR CONNECTED/i.test(status)) {
    // Connected but not yet streaming audio — treat as the connecting phase
    // so the primary button stays in its progress label until mic is live.
    return previous === 'live' ? 'live' : 'connecting'
  }
  if (
    /^ASR TERMINATED|^ASR CLOSED|^LIVE AUDIO STOPPED|^G2 MIC STOPPED|^BROWSER MIC STOPPED|^SMOKE COMPLETE|^AUDIO SPEECH FIXTURE SENT|^AUDIO FIXTURE SENT/i.test(
      status,
    )
  )
    return 'stopped'
  if (/FAILED|DENIED|LOST|BLOCKED|SLOW/i.test(status)) {
    return previous === 'live' ? 'stopped' : 'idle'
  }
  return previous
}

function humanStatusLabel(lifecycle: AppLifecycle): string {
  switch (lifecycle) {
    case 'idle':
      return 'Ready'
    case 'connecting':
      return 'Connecting…'
    case 'live':
      return 'Listening'
    case 'stopped':
      return 'Stopped'
  }
}
