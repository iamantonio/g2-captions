// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UIShell, type UIShellHandlers } from '../../src/app/UIShell'
import { CaptionState } from '../../src/captions/CaptionState'
import { TelemetryReporter } from '../../src/app/TelemetryReporter'
import type { ClientLogger } from '../../src/observability/clientLogger'
import type { G2DisplayResult, G2LensDisplay } from '../../src/display/g2LensDisplay'
import type { RawAsrEvent } from '../../src/types'

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
  const shell = new UIShell({ root, state, telemetry, logger, handlers })
  return { root, state, telemetry, logger, handlers, shell }
}

describe('UIShell', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders the caption frame and the seven action buttons on first render', () => {
    const { root, shell } = build()
    shell.render('READY — starting caption check')

    const pre = root.querySelector('pre')
    expect(pre?.textContent).toContain('G2 CAPTIONS')

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
    const { root, handlers, logger, shell } = build()
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

  it('persists the visual status across renders so re-renders without an explicit status keep state', () => {
    const { shell } = build()
    shell.render('AUDIO FIXTURE STREAMING')
    expect(shell.getVisualStatus()).toBe('AUDIO FIXTURE STREAMING')
    shell.render()
    expect(shell.getVisualStatus()).toBe('AUDIO FIXTURE STREAMING')
  })

  it('hides the telemetry panel when the recorder has no events, shows it once events exist', () => {
    const empty = build({ recorderEvents: 0 })
    empty.telemetry.start('test')
    empty.shell.render()
    expect(empty.root.querySelector('details')).toBeNull()

    const populated = build({ recorderEvents: 1 })
    populated.telemetry.start('test')
    populated.shell.render()
    const details = populated.root.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.querySelector('pre')?.getAttribute('aria-label')).toBe('Latest benchmark telemetry JSON')
  })

  it('renders a CaptionState change after re-render so transcripts appear in the frame', () => {
    const { state, root, shell } = build()
    shell.render()
    state.applyAsrEvent({
      text: 'hello there',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
    } as RawAsrEvent)
    shell.render()
    expect(root.querySelector('pre')?.textContent).toContain('hello there')
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
    const status = root.querySelector('[role="status"]')
    expect(status?.textContent).toBe('G2 DISPLAY FAILED — startup rejected')
    expect(logger.error).toHaveBeenCalledWith('g2_display_failed', expect.any(Error), { frameText: 'frame text' })
  })

  it('render() clears prior buttons so we never render duplicates after subsequent renders', () => {
    const { root, shell } = build()
    shell.render()
    shell.render()
    expect(root.querySelectorAll('button')).toHaveLength(7)
  })
})
