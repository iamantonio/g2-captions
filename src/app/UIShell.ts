import type { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import type { G2LensDisplay } from '../display/g2LensDisplay'
import type { ClientLogger } from '../observability/clientLogger'
import { CaptionView } from './captionView'
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
 * Owns the DOM root.
 *
 * The earlier version of this module rebuilt the entire production view
 * on every render() call, which was once-per-partial-transcript at ~1 Hz
 * during a live session. The button DOM, status pill, and caption surface
 * all got recreated, which made CSS transitions impossible (you can't
 * transition properties on a node that's just been created) and caused
 * the user-visible "all over the place" feel.
 *
 * The current version builds DOM once on construction and uses incremental
 * updates — the status pill mutates className/textContent only when it
 * changes; the primary button stays as the same DOM node and its label /
 * disabled state get updated; caption rows are diffed by segment id and
 * mutated in place. CSS transitions fire correctly, layout doesn't reflow
 * on every partial, and the perceived caption stream is calm.
 *
 * Two presentation modes:
 *
 * - **Production** (default): single caption surface, single primary
 *   action button (Start / Stop captions), animated status pill, no
 *   debug panels. Targets end users on real hardware.
 * - **Debug** (`?debug=1`): a raw caption frame view plus all internal
 *   controls (fixture playback, raw Connect, browser mic, telemetry
 *   JSON). Targets developers running smoke tests.
 *
 * The lens forwarder is mode-agnostic; lens-render failures still surface
 * as an inline `role="status"` row regardless of mode (deaf-first).
 * Identical lens text is deduplicated to avoid wasted BLE writes.
 */
export class UIShell {
  private currentVisualStatus = DEFAULT_STATUS
  private lastFrameText = ''
  private lastLensText: string | undefined
  private g2Display: G2LensDisplay | undefined
  private lifecycle: AppLifecycle = 'idle'
  private readonly doc: Document
  private readonly debug: boolean
  private mounted = false

  // Production-mode DOM refs
  private statusPill: HTMLElement | undefined
  private captionView: CaptionView | undefined
  private primaryButton: HTMLButtonElement | undefined
  private primaryHandler: 'start' | 'stop' = 'start'

  // Debug-mode DOM refs
  private debugFramePre: HTMLPreElement | undefined
  private debugTelemetryDetails: HTMLDetailsElement | undefined
  private debugTelemetryPre: HTMLPreElement | undefined

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

  setLifecycle(next: AppLifecycle): void {
    this.lifecycle = next
  }

  async renderLens(frameText: string): Promise<void> {
    if (!this.g2Display) return
    // Skip identical-text renders — Deepgram emits ~1 partial/sec and the
    // formatter is deterministic; if the body+footer hasn't changed,
    // there's no reason to issue another BLE textContainerUpgrade write.
    if (frameText === this.lastLensText) return
    this.lastLensText = frameText
    const result = await this.g2Display.render(frameText)
    if (result.ok === false) {
      this.options.logger.error('g2_display_failed', new Error(result.visualStatus), { frameText })
      const warning = this.doc.createElement('div')
      warning.setAttribute('role', 'status')
      warning.textContent = result.visualStatus
      this.options.root.append(warning)
      // Allow re-attempt on the next render — if the lens recovered, we
      // want it to receive the latest text rather than be stuck on the
      // dedupe.
      this.lastLensText = undefined
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

    if (!this.mounted) {
      this.options.root.replaceChildren()
      if (this.debug) this.mountDebugView()
      else this.mountProductionView()
      this.mounted = true
    }

    if (this.debug) this.updateDebugView(frame.text)
    else this.updateProductionView()

    void this.renderLens(frame.text)
  }

  // ─── Production view ────────────────────────────────────────────

  private mountProductionView(): void {
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
    this.statusPill = statusPill

    const captionRegion = this.doc.createElement('section')
    captionRegion.className = 'g2-shell__captions'
    captionRegion.setAttribute('aria-label', 'Live captions')
    captionRegion.setAttribute('role', 'log')
    captionRegion.setAttribute('aria-live', 'polite')

    const emptyState = this.doc.createElement('div')
    emptyState.className = 'g2-shell__empty'
    const emptyHeading = this.doc.createElement('p')
    emptyHeading.className = 'g2-shell__empty-heading'
    emptyHeading.textContent = 'Captions will appear here'
    const emptySub = this.doc.createElement('p')
    emptySub.className = 'g2-shell__empty-sub'
    emptySub.textContent = 'Tap Start captions and speak — partials refine into final lines as the speaker pauses.'
    emptyState.append(emptyHeading, emptySub)
    captionRegion.append(emptyState)

    const list = this.doc.createElement('ol')
    list.className = 'caption-list'
    captionRegion.append(list)

    this.captionView = new CaptionView({ list, emptyState, documentImpl: this.doc })

    const controls = this.doc.createElement('footer')
    controls.className = 'g2-shell__controls'
    const primary = this.doc.createElement('button')
    primary.className = 'g2-shell__primary'
    primary.type = 'button'
    primary.addEventListener('click', () => {
      if (primary.disabled) return
      if (this.primaryHandler === 'stop') {
        this.options.handlers.onTerminate()
      } else {
        this.options.logger.stage('button_start_captions')
        this.options.handlers.onStartG2SdkAudio()
      }
    })
    controls.append(primary)
    this.primaryButton = primary

    container.append(header, captionRegion, controls)
    this.options.root.append(container)
  }

  private updateProductionView(): void {
    const pill = this.statusPill
    if (pill) {
      const targetClass = `g2-shell__status g2-shell__status--${this.lifecycle}`
      if (pill.className !== targetClass) pill.className = targetClass
      const targetLabel = humanStatusLabel(this.lifecycle)
      if (pill.textContent !== targetLabel) pill.textContent = targetLabel
    }

    this.captionView?.update(this.options.state.segments())

    const button = this.primaryButton
    if (button) {
      const desired = this.primaryFromLifecycle()
      if (button.textContent !== desired.label) button.textContent = desired.label
      if (button.disabled !== desired.disabled) button.disabled = desired.disabled
      this.primaryHandler = desired.handler
    }
  }

  private primaryFromLifecycle(): { label: string; disabled: boolean; handler: 'start' | 'stop' } {
    switch (this.lifecycle) {
      case 'connecting':
        return { label: 'Connecting…', disabled: true, handler: 'start' }
      case 'live':
        return { label: 'Stop captions', disabled: false, handler: 'stop' }
      case 'stopped':
        return { label: 'Start again', disabled: false, handler: 'start' }
      case 'idle':
      default:
        return { label: 'Start captions', disabled: false, handler: 'start' }
    }
  }

  // ─── Debug view ─────────────────────────────────────────────────

  private mountDebugView(): void {
    const container = this.doc.createElement('div')
    container.className = 'g2-shell g2-shell--debug'

    const pre = this.doc.createElement('pre')
    pre.className = 'g2-shell__frame'
    container.append(pre)
    this.debugFramePre = pre

    const details = this.doc.createElement('details')
    details.open = true
    details.hidden = true
    const summary = this.doc.createElement('summary')
    summary.textContent = 'Telemetry JSON'
    const reportPre = this.doc.createElement('pre')
    reportPre.setAttribute('aria-label', 'Latest benchmark telemetry JSON')
    details.append(summary, reportPre)
    container.append(details)
    this.debugTelemetryDetails = details
    this.debugTelemetryPre = reportPre

    this.mountDebugButtons(container)
    this.options.root.append(container)
  }

  private mountDebugButtons(parent: HTMLElement): void {
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

  private updateDebugView(frameText: string): void {
    if (this.debugFramePre && this.debugFramePre.textContent !== frameText) {
      this.debugFramePre.textContent = frameText
    }

    const details = this.debugTelemetryDetails
    const reportPre = this.debugTelemetryPre
    if (!details || !reportPre) return
    const report = this.options.telemetry.report()
    if (!report) {
      if (!details.hidden) details.hidden = true
      return
    }
    if (details.hidden) details.hidden = false
    const json = JSON.stringify(report, null, 2)
    if (reportPre.textContent !== json) reportPre.textContent = json
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
