// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UIShell, lifecycleFromStatus, type UIShellHandlers } from '../../src/app/UIShell'
import { CaptionState } from '../../src/captions/CaptionState'
import { TelemetryReporter } from '../../src/app/TelemetryReporter'
import type { ClientLogger } from '../../src/observability/clientLogger'
import type { G2DisplayResult, G2LensDisplay } from '../../src/display/g2LensDisplay'

function makeLogger(): ClientLogger & {
  stage: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { stage: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeHandlers(): { [K in keyof UIShellHandlers]: ReturnType<typeof vi.fn> } {
  return {
    onConnectDeepgram: vi.fn(),
    onStreamSilentFixture: vi.fn(),
    onStreamSpeechFixture: vi.fn(),
    onStartBrowserMic: vi.fn(),
    onStartG2SdkAudio: vi.fn(),
    onStopLiveAudio: vi.fn(),
    onTerminate: vi.fn(),
  }
}

interface BuildOpts {
  recorderEvents?: number
  debug?: boolean
}

function makeRoot(): HTMLElement {
  document.body.replaceChildren()
  const div = document.createElement('div')
  div.id = 'app'
  document.body.append(div)
  return div
}

function build(opts: BuildOpts = {}) {
  const root = makeRoot()
  const state = new CaptionState()
  const telemetry = new TelemetryReporter({
    recorderFactory: () => ({
      mark: vi.fn(),
      report: vi.fn(() => ({
        provider: 'deepgram',
        fixtureId: 'test',
        startedAtMs: 0,
        events: Array.from({ length: opts.recorderEvents ?? 0 }, (_, i) => ({
          stage: 'first_audio_chunk_sent' as const,
          atMs: i,
        })),
        metrics: {},
      })),
    }),
  })
  const logger = makeLogger()
  const handlers = makeHandlers()
  const shell = new UIShell({ root, state, telemetry, logger, handlers, debug: opts.debug ?? false })
  return { root, state, telemetry, logger, handlers, shell }
}

describe('UIShell — production mode (default)', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders only one primary action button — debug controls are hidden', () => {
    const { root, shell } = build()
    shell.render('READY — starting caption check')

    const buttons = Array.from(root.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toEqual(['Start captions'])
  })

  it('clicking the primary button in idle state starts the G2 SDK audio path', () => {
    const { root, handlers, logger, shell } = build()
    shell.render()

    const primary = root.querySelector('button')!
    primary.click()
    expect(handlers.onStartG2SdkAudio).toHaveBeenCalled()
    expect(logger.stage).toHaveBeenCalledWith('button_start_captions')
  })

  it('shows a Stop button while live and Terminate is invoked when clicked', () => {
    const { root, handlers, shell } = build()
    shell.render('G2 MIC LIVE — captions streaming')

    const buttons = Array.from(root.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toEqual(['Stop captions'])

    root.querySelector('button')!.click()
    expect(handlers.onTerminate).toHaveBeenCalled()
  })

  it('disables the primary button while connecting so the user cannot double-trigger', () => {
    const { root, handlers, shell } = build()
    shell.render('CONNECTING — token')

    const button = root.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Connecting…')

    button.click()
    expect(handlers.onStartG2SdkAudio).not.toHaveBeenCalled()
  })

  it('shows "Start again" after a stopped state so the user understands the action restarts', () => {
    const { root, shell } = build()
    shell.render('ASR TERMINATED')
    const button = root.querySelector('button')!
    expect(button.textContent).toBe('Start again')
  })

  it('renders a status pill with an aria-live region for screen readers', () => {
    const { root, shell } = build()
    shell.render('G2 MIC LIVE — captions streaming')

    const pill = root.querySelector('.g2-shell__status')
    expect(pill).not.toBeNull()
    expect(pill?.getAttribute('aria-live')).toBe('polite')
    expect(pill?.textContent).toBe('Listening')
    expect(pill?.classList.contains('g2-shell__status--live')).toBe(true)
  })

  it('marks the caption region as a polite live log for screen readers (deaf-first)', () => {
    const { root, shell } = build()
    shell.render()
    const region = root.querySelector('.g2-shell__captions')
    expect(region?.getAttribute('role')).toBe('log')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.getAttribute('aria-label')).toBe('Live captions')
  })

  it('hides the telemetry JSON panel even when events exist (production)', () => {
    const { telemetry, root, shell } = build({ recorderEvents: 1 })
    telemetry.start('test')
    shell.render()
    // Production mode never mounts the telemetry surface at all.
    expect(root.querySelector('details')).toBeNull()
  })

  it('shows an empty-state message before any captions arrive', () => {
    const { root, shell } = build()
    shell.render()
    const empty = root.querySelector('.g2-shell__empty') as HTMLElement | null
    expect(empty).not.toBeNull()
    expect(empty?.hidden).toBe(false)
    expect(empty?.querySelector('.g2-shell__empty-heading')?.textContent).toBe('Captions will appear here')
  })

  it('hides the empty state once a caption row mounts and renders the row text', () => {
    const { state, root, shell } = build()
    shell.render()
    state.applyAsrEvent({
      vendor: 'deepgram',
      text: 'hello there',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
      receivedAtMs: 1100,
    })
    shell.render()
    const empty = root.querySelector('.g2-shell__empty') as HTMLElement | null
    expect(empty?.hidden).toBe(true)
    expect(root.querySelector('.caption-row__text')?.textContent).toBe('hello there')
  })
})

describe('UIShell — debug mode (?debug=1)', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders all seven action buttons', () => {
    const { root, shell } = build({ debug: true })
    shell.render('READY — starting caption check')

    const buttons = Array.from(root.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons).toEqual([
      'Connect Deepgram',
      'Stream Silent PCM Fixture',
      'Stream Speech PCM Fixture',
      'Start Browser Mic',
      'Start G2 SDK Audio',
      'Stop Live Audio',
      'Terminate',
    ])
  })

  it('button clicks invoke the corresponding handler and log the button stage', () => {
    const { root, handlers, logger, shell } = build({ debug: true })
    shell.render()

    const byLabel = (label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)!

    byLabel('Connect Deepgram').click()
    expect(handlers.onConnectDeepgram).toHaveBeenCalled()
    expect(logger.stage).toHaveBeenCalledWith('button_connect_deepgram')

    byLabel('Stream Silent PCM Fixture').click()
    expect(handlers.onStreamSilentFixture).toHaveBeenCalled()
    expect(logger.stage).toHaveBeenCalledWith('button_stream_silent_fixture')

    byLabel('Stream Speech PCM Fixture').click()
    expect(handlers.onStreamSpeechFixture).toHaveBeenCalled()

    byLabel('Start Browser Mic').click()
    expect(handlers.onStartBrowserMic).toHaveBeenCalled()

    byLabel('Start G2 SDK Audio').click()
    expect(handlers.onStartG2SdkAudio).toHaveBeenCalled()

    byLabel('Stop Live Audio').click()
    expect(handlers.onStopLiveAudio).toHaveBeenCalled()

    byLabel('Terminate').click()
    expect(handlers.onTerminate).toHaveBeenCalled()
  })

  it('hides the telemetry panel when the recorder has no events, shows it once events exist', () => {
    // Debug mode mounts a single <details> element and toggles its
    // `hidden` attribute based on whether the recorder has any events.
    const empty = build({ recorderEvents: 0, debug: true })
    empty.telemetry.start('test')
    empty.shell.render()
    const emptyDetails = empty.root.querySelector('details') as HTMLDetailsElement | null
    expect(emptyDetails).not.toBeNull()
    expect(emptyDetails?.hidden).toBe(true)

    const populated = build({ recorderEvents: 1, debug: true })
    populated.telemetry.start('test')
    populated.shell.render()
    const details = populated.root.querySelector('details') as HTMLDetailsElement | null
    expect(details).not.toBeNull()
    expect(details?.hidden).toBe(false)
    expect(details?.querySelector('pre')?.getAttribute('aria-label')).toBe('Latest benchmark telemetry JSON')
  })

  it('render() clears prior buttons so re-renders never duplicate them', () => {
    const { root, shell } = build({ debug: true })
    shell.render()
    shell.render()
    expect(root.querySelectorAll('button')).toHaveLength(7)
  })
})

describe('UIShell — shared behavior across modes', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('persists the visual status across renders', () => {
    const { shell } = build()
    shell.render('AUDIO FIXTURE STREAMING')
    expect(shell.getVisualStatus()).toBe('AUDIO FIXTURE STREAMING')
    shell.render()
    expect(shell.getVisualStatus()).toBe('AUDIO FIXTURE STREAMING')
  })

  it('renders a CaptionState change after re-render so transcripts appear in the surface', () => {
    // Production mode renders captions as `.caption-row__text` rows
    // (mutated incrementally), not as a single <pre> frame text. Test
    // both modes by checking the expected per-mode location.
    const prod = build()
    prod.shell.render()
    prod.state.applyAsrEvent({
      vendor: 'deepgram',
      text: 'hello there',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
      receivedAtMs: 1100,
    })
    prod.shell.render()
    expect(prod.root.querySelector('.caption-row__text')?.textContent).toBe('hello there')

    const dbg = build({ debug: true })
    dbg.shell.render()
    dbg.state.applyAsrEvent({
      vendor: 'deepgram',
      text: 'hello there',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
      receivedAtMs: 1100,
    })
    dbg.shell.render()
    expect(dbg.root.querySelector('.g2-shell__frame')?.textContent).toContain('hello there')
  })

  it('updates lastFrameText to match the rendered text so the lens forwarder can replay it', () => {
    const { shell } = build()
    shell.render('READY — starting caption check')
    expect(shell.getLastFrameText()).toContain('G2 CAPTIONS')
  })

  it('renderLens forwards the text to the attached G2LensDisplay', async () => {
    const render = vi.fn(async (): Promise<G2DisplayResult> => ({ ok: true }))
    const display = { render } as unknown as G2LensDisplay
    const { shell } = build()
    shell.attachG2Display(display)
    await shell.renderLens('frame text')
    expect(render).toHaveBeenCalledWith('frame text')
  })

  it('skips identical lens renders to avoid wasted BLE writes', async () => {
    const render = vi.fn(async (): Promise<G2DisplayResult> => ({ ok: true }))
    const display = { render } as unknown as G2LensDisplay
    const { shell } = build()
    shell.attachG2Display(display)
    await shell.renderLens('same text')
    await shell.renderLens('same text')
    await shell.renderLens('same text')
    expect(render).toHaveBeenCalledTimes(1)
    await shell.renderLens('different text')
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('after a lens render failure, the next render is allowed through (no permanent dedupe lock)', async () => {
    const render = vi
      .fn(async (): Promise<G2DisplayResult> => ({ ok: true }))
      .mockResolvedValueOnce({ ok: false, visualStatus: 'G2 DISPLAY FAILED — startup rejected' })
    const display = { render } as unknown as G2LensDisplay
    const { shell } = build()
    shell.attachG2Display(display)
    await shell.renderLens('first')
    await shell.renderLens('first') // would normally dedupe — but the failure cleared lastLensText
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('mount-once: status pill DOM node is preserved across renders so CSS transitions can fire', () => {
    const { root, shell } = build()
    shell.render('READY — starting caption check')
    const pillBefore = root.querySelector('.g2-shell__status')
    shell.render('CONNECTING — token')
    const pillAfter = root.querySelector('.g2-shell__status')
    expect(pillBefore).toBe(pillAfter)
    expect(pillAfter?.classList.contains('g2-shell__status--connecting')).toBe(true)
    expect(pillAfter?.textContent).toBe('Connecting…')
  })

  it('mount-once: primary button DOM node is preserved across renders', () => {
    const { root, shell } = build()
    shell.render()
    const buttonBefore = root.querySelector('.g2-shell__primary')
    shell.render('G2 MIC LIVE — captions streaming')
    const buttonAfter = root.querySelector('.g2-shell__primary')
    expect(buttonBefore).toBe(buttonAfter)
    expect(buttonAfter?.textContent).toBe('Stop captions')
  })

  it('renderLens surfaces a failure as an inline aria role=status warning (deaf-first)', async () => {
    const display = {
      render: vi.fn(
        async (): Promise<G2DisplayResult> => ({
          ok: false,
          visualStatus: 'G2 DISPLAY FAILED — startup rejected',
        }),
      ),
    } as unknown as G2LensDisplay
    const { shell, root, logger } = build()
    shell.attachG2Display(display)
    await shell.renderLens('frame text')
    const statusElements = Array.from(root.querySelectorAll('[role="status"]'))
    const lensFailure = statusElements.find((el) => el.textContent === 'G2 DISPLAY FAILED — startup rejected')
    expect(lensFailure).toBeDefined()
    expect(logger.error).toHaveBeenCalledWith('g2_display_failed', expect.any(Error), { frameText: 'frame text' })
  })
})

describe('lifecycleFromStatus', () => {
  it('maps live-mic statuses to "live"', () => {
    expect(lifecycleFromStatus('G2 MIC LIVE — captions streaming', 'connecting')).toBe('live')
    expect(lifecycleFromStatus('BROWSER MIC LIVE — captions streaming', 'idle')).toBe('live')
  })

  it('maps progress statuses to "connecting"', () => {
    expect(lifecycleFromStatus('CONNECTING — token', 'idle')).toBe('connecting')
    expect(lifecycleFromStatus('CONNECTING — ASR', 'idle')).toBe('connecting')
    expect(lifecycleFromStatus('G2 MIC STARTING — waiting audio', 'idle')).toBe('connecting')
    expect(lifecycleFromStatus('HARDWARE SMOKE — connecting ASR', 'idle')).toBe('connecting')
  })

  it('treats ASR CONNECTED as still connecting until mic-live arrives', () => {
    expect(lifecycleFromStatus('ASR CONNECTED — waiting audio', 'connecting')).toBe('connecting')
  })

  it('keeps lifecycle at "live" when ASR CONNECTED arrives mid-session (re-render)', () => {
    expect(lifecycleFromStatus('ASR CONNECTED — waiting audio', 'live')).toBe('live')
  })

  it('maps termination statuses to "stopped"', () => {
    expect(lifecycleFromStatus('ASR TERMINATED', 'live')).toBe('stopped')
    expect(lifecycleFromStatus('LIVE AUDIO STOPPED — captions paused', 'live')).toBe('stopped')
    expect(lifecycleFromStatus('SMOKE COMPLETE — captions verified', 'live')).toBe('stopped')
  })

  it('demotes to "stopped" on failure mid-live, "idle" on failure pre-live', () => {
    expect(lifecycleFromStatus('G2 MIC FAILED — bridge unavailable', 'live')).toBe('stopped')
    expect(lifecycleFromStatus('G2 MIC FAILED — bridge unavailable', 'idle')).toBe('idle')
    expect(lifecycleFromStatus('BROWSER MIC DENIED — captions paused', 'live')).toBe('stopped')
  })

  it('preserves the previous lifecycle for unrecognized statuses', () => {
    expect(lifecycleFromStatus('READY — starting caption check', 'idle')).toBe('idle')
    expect(lifecycleFromStatus('READY — starting caption check', 'live')).toBe('live')
  })
})
