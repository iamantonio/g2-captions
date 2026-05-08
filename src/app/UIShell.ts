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
  /** Pause: stop the live audio source but keep the ASR session ready. */
  onPauseCaptions(): void
  /** Resume: restart the live audio source after a pause. */
  onResumeCaptions(): void
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
  /** Optional fixed phrases shown for controlled provider hardware benchmark reads. */
  hardwareBenchmarkPhrases?: readonly string[]
}

const DEFAULT_STATUS = 'READY — starting caption check'

/** App-level lifecycle the production UI cares about. */
export type AppLifecycle = 'idle' | 'connecting' | 'live' | 'paused' | 'stopped'

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
  private endSessionLink: HTMLButtonElement | undefined
  private primaryAction: 'start' | 'pause' | 'resume' = 'start'
  private endConfirmOverlay: HTMLElement | undefined
  private endConfirmCountdown: HTMLElement | undefined
  private endConfirmVisible = false

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

  /**
   * Toggle the end-session confirmation overlay. Triggered by main.ts
   * after a ring double-tap during a live or paused session — gives the
   * user a 4-second window to double-tap again to confirm. The overlay
   * dims the caption surface and shows a countdown so the gesture's
   * effect is unmistakable. Called with `false` on confirm, on cancel,
   * and on auto-timeout.
   */
  setEndConfirmation(visible: boolean): void {
    this.endConfirmVisible = visible
    const overlay = this.endConfirmOverlay
    const countdown = this.endConfirmCountdown
    if (!overlay || !countdown) return
    if (visible) {
      overlay.hidden = false
      // Restart the countdown animation by toggling the class — direct
      // animation restart on the same element requires a reflow trigger,
      // and removing/adding the class is the cleanest way.
      countdown.classList.remove('g2-shell__confirm-countdown--active')
      void countdown.offsetWidth // force reflow so the next add re-runs the animation
      countdown.classList.add('g2-shell__confirm-countdown--active')
    } else {
      overlay.hidden = true
      countdown.classList.remove('g2-shell__confirm-countdown--active')
    }
  }

  isEndConfirmationVisible(): boolean {
    return this.endConfirmVisible
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

    const benchmarkPanel = this.buildBenchmarkPanel()

    const controls = this.doc.createElement('footer')
    controls.className = 'g2-shell__controls'
    const primary = this.doc.createElement('button')
    primary.className = 'g2-shell__primary'
    primary.type = 'button'
    primary.addEventListener('click', () => {
      if (primary.disabled) return
      switch (this.primaryAction) {
        case 'pause':
          this.options.logger.stage('button_pause_captions')
          this.options.handlers.onPauseCaptions()
          return
        case 'resume':
          this.options.logger.stage('button_resume_captions')
          this.options.handlers.onResumeCaptions()
          return
        case 'start':
        default:
          this.options.logger.stage('button_start_captions')
          this.options.handlers.onStartG2SdkAudio()
      }
    })
    controls.append(primary)
    this.primaryButton = primary

    // Secondary "End session" link surfaces stop/terminate during a live or
    // paused session. Hidden in idle/connecting/stopped states. The primary
    // button stays Pause/Resume/Start; users who want a clean session end
    // tap this. Ring double-tap also lands here (see GestureController).
    const endSession = this.doc.createElement('button')
    endSession.className = 'g2-shell__secondary'
    endSession.type = 'button'
    endSession.textContent = 'End session'
    endSession.hidden = true
    endSession.addEventListener('click', () => {
      this.options.logger.stage('button_end_session')
      this.options.handlers.onTerminate()
    })
    controls.append(endSession)
    this.endSessionLink = endSession

    // End-session confirmation overlay — hidden by default, surfaced by
    // setEndConfirmation(true) when the user double-taps the ring during
    // a live or paused session. Auto-cancel timing lives in main.ts; this
    // module only renders the visual.
    const confirmOverlay = this.doc.createElement('div')
    confirmOverlay.className = 'g2-shell__confirm-overlay'
    confirmOverlay.setAttribute('role', 'alertdialog')
    confirmOverlay.setAttribute('aria-labelledby', 'g2-confirm-heading')
    confirmOverlay.hidden = true

    const confirmCard = this.doc.createElement('div')
    confirmCard.className = 'g2-shell__confirm-card'

    const confirmHeading = this.doc.createElement('h2')
    confirmHeading.id = 'g2-confirm-heading'
    confirmHeading.className = 'g2-shell__confirm-heading'
    confirmHeading.textContent = 'End session?'

    const confirmHint = this.doc.createElement('p')
    confirmHint.className = 'g2-shell__confirm-hint'
    confirmHint.textContent = 'Double-tap the ring again to confirm.'

    const confirmCountdown = this.doc.createElement('div')
    confirmCountdown.className = 'g2-shell__confirm-countdown'

    const confirmActions = this.doc.createElement('div')
    confirmActions.className = 'g2-shell__confirm-actions'
    const cancelButton = this.doc.createElement('button')
    cancelButton.className = 'g2-shell__confirm-cancel'
    cancelButton.type = 'button'
    cancelButton.textContent = 'Cancel'
    cancelButton.addEventListener('click', () => {
      this.options.logger.stage('button_cancel_end_session')
      // Cancellation is also an "intent to dismiss the dialog without
      // ending"; we surface it the same way the auto-timeout does, by
      // hiding the overlay. main.ts owns the timer so it knows when to
      // call setEndConfirmation(false) on cancel; here we proactively
      // hide the visual and let main.ts catch up via the click handler.
      this.setEndConfirmation(false)
    })
    confirmActions.append(cancelButton)

    confirmCard.append(confirmHeading, confirmHint, confirmCountdown, confirmActions)
    confirmOverlay.append(confirmCard)

    this.endConfirmOverlay = confirmOverlay
    this.endConfirmCountdown = confirmCountdown

    if (benchmarkPanel) container.append(header, benchmarkPanel, captionRegion, controls, confirmOverlay)
    else container.append(header, captionRegion, controls, confirmOverlay)
    this.options.root.append(container)
  }

  private buildBenchmarkPanel(): HTMLElement | undefined {
    const phrases = this.options.hardwareBenchmarkPhrases
    if (!phrases || phrases.length === 0) return undefined
    const panel = this.doc.createElement('section')
    panel.className = 'g2-shell__benchmark'
    panel.setAttribute('aria-label', 'Hardware benchmark script')

    const heading = this.doc.createElement('h2')
    heading.textContent = 'Hardware benchmark script'
    panel.append(heading)

    const list = this.doc.createElement('ol')
    phrases.forEach((phrase, index) => {
      const item = this.doc.createElement('li')
      item.textContent = `${index + 1}. ${phrase}`
      list.append(item)
    })
    panel.append(list)
    return panel
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
      this.primaryAction = desired.action
    }

    const endSession = this.endSessionLink
    if (endSession) {
      const shouldShow = this.lifecycle === 'live' || this.lifecycle === 'paused'
      if (endSession.hidden === shouldShow) endSession.hidden = !shouldShow
    }
  }

  private primaryFromLifecycle(): { label: string; disabled: boolean; action: 'start' | 'pause' | 'resume' } {
    switch (this.lifecycle) {
      case 'connecting':
        return { label: 'Connecting…', disabled: true, action: 'start' }
      case 'live':
        return { label: 'Pause captions', disabled: false, action: 'pause' }
      case 'paused':
        return { label: 'Resume captions', disabled: false, action: 'resume' }
      case 'stopped':
        return { label: 'Start again', disabled: false, action: 'start' }
      case 'idle':
      default:
        return { label: 'Start captions', disabled: false, action: 'start' }
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

    const benchmarkPanel = this.buildBenchmarkPanel()
    if (benchmarkPanel) container.append(benchmarkPanel)

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
  if (/^CAPTIONS PAUSED|^G2 MIC PAUSED|^BROWSER MIC PAUSED/i.test(status)) return 'paused'
  if (
    /^ASR TERMINATED|^ASR CLOSED|^LIVE AUDIO STOPPED|^G2 MIC STOPPED|^BROWSER MIC STOPPED|^SMOKE COMPLETE|^AUDIO SPEECH FIXTURE SENT|^AUDIO FIXTURE SENT/i.test(
      status,
    )
  )
    return 'stopped'
  if (/FAILED|DENIED|LOST|BLOCKED|SLOW/i.test(status)) {
    return previous === 'live' ? 'stopped' : previous === 'paused' ? 'stopped' : 'idle'
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
    case 'paused':
      return 'Paused'
    case 'stopped':
      return 'Stopped'
  }
}
