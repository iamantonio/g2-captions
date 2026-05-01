import { describe, expect, it, vi } from 'vitest'
import { ASRController, type AsrLiveSession, type AsrLiveSessionDeps } from '../../src/app/ASRController'
import { CaptionState } from '../../src/captions/CaptionState'
import { TelemetryReporter } from '../../src/app/TelemetryReporter'
import type { RenderScheduler } from '../../src/app/renderScheduler'
import type { ClientLogger } from '../../src/observability/clientLogger'
import type { PcmChunk } from '../../src/audio/pcmFixture'
import type { RawAsrEvent } from '../../src/types'

interface FakeSession extends AsrLiveSession {
  capturedDeps: AsrLiveSessionDeps
  connect: ReturnType<typeof vi.fn>
  streamPcmChunks: ReturnType<typeof vi.fn>
  sendPcmChunk: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

function makeFakeSession(connectImpl: () => Promise<void> = async () => undefined): FakeSession {
  let captured: AsrLiveSessionDeps = {
    onTranscript: () => undefined,
    onVisualStatus: () => undefined,
    onTelemetry: () => undefined,
    onError: () => undefined,
  }
  const session = {
    get capturedDeps() {
      return captured
    },
    connect: vi.fn(connectImpl),
    streamPcmChunks: vi.fn(async () => undefined),
    sendPcmChunk: vi.fn(async () => undefined),
    terminate: vi.fn(),
  } as unknown as FakeSession
  ;(session as unknown as { __setDeps: (d: AsrLiveSessionDeps) => void }).__setDeps = (d) => {
    captured = d
  }
  return session
}

function makeLogger(): ClientLogger & {
  stage: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { stage: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

interface BuildControllerOpts {
  sessionFactoryImpl?: (deps: AsrLiveSessionDeps) => AsrLiveSession
  renderSchedulerFactory?: (render: () => void) => RenderScheduler
}

function buildController(opts: BuildControllerOpts = {}) {
  const state = new CaptionState()
  const telemetry = new TelemetryReporter()
  const logger = makeLogger()
  const onShellRender = vi.fn()
  const sessions: FakeSession[] = []
  const sessionFactory =
    opts.sessionFactoryImpl ??
    ((deps) => {
      const session = makeFakeSession()
      ;(session as unknown as { __setDeps: (d: AsrLiveSessionDeps) => void }).__setDeps(deps)
      sessions.push(session)
      return session
    })
  const controller = new ASRController({
    state,
    telemetry,
    logger,
    sessionFactory,
    onShellRender,
    ...(opts.renderSchedulerFactory ? { renderSchedulerFactory: opts.renderSchedulerFactory } : {}),
  })
  return { state, telemetry, logger, onShellRender, sessions, controller }
}

describe('ASRController', () => {
  it('starts disconnected and reports isConnected accordingly', () => {
    const { controller } = buildController()
    expect(controller.isConnected()).toBe(false)
  })

  it('connect() builds a session via the factory, calls session.connect(), and renders ASR CONNECTED', async () => {
    const { controller, sessions, onShellRender, logger, telemetry } = buildController()
    await controller.connect('speech-smoke')

    expect(sessions).toHaveLength(1)
    expect(sessions[0].connect).toHaveBeenCalledOnce()
    expect(controller.isConnected()).toBe(true)
    expect(onShellRender).toHaveBeenLastCalledWith('ASR CONNECTED — waiting audio')
    expect(logger.stage).toHaveBeenCalledWith('asr_connect_start', { fixtureId: 'speech-smoke' })
    expect(logger.stage).toHaveBeenCalledWith('asr_connect_success')
    expect(telemetry.isStarted()).toBe(true)
  })

  it('connect() clears prior caption state and terminates any prior session', async () => {
    const { controller, state, sessions } = buildController()
    state.applyAsrEvent({ text: 'leftover', startMs: 0, endMs: 500, status: 'partial', speaker: 'A' } as RawAsrEvent)
    expect(state.segments()).toHaveLength(1)

    await controller.connect()
    expect(state.segments()).toHaveLength(0)

    await controller.connect()
    expect(sessions).toHaveLength(2)
    expect(sessions[0].terminate).toHaveBeenCalled()
  })

  it('forwards a final transcript into CaptionState and renders the shell synchronously (immediate flush)', async () => {
    const { controller, state, sessions, onShellRender, telemetry, logger } = buildController()
    await controller.connect()
    onShellRender.mockClear()

    sessions[0].capturedDeps.onTranscript({
      text: 'hello world',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
    } as RawAsrEvent)

    expect(state.segments()).toHaveLength(1)
    expect(state.segments()[0].text).toBe('hello world')
    // Final → flushFinal() → synchronous render with no debounce delay.
    expect(onShellRender).toHaveBeenCalledWith()
    expect(logger.stage).toHaveBeenCalledWith('speaker_label_observed', {
      speaker: 'A',
      status: 'final',
      textLength: 11,
    })
    const report = telemetry.report()
    expect(report?.events.map((e) => e.stage)).toContain('caption_formatted')
    expect(report?.events.map((e) => e.stage)).toContain('display_update_sent')
  })

  it('partial transcripts route through the scheduler and do not render the shell synchronously', async () => {
    const renders: Array<() => void> = []
    const fakeScheduler = {
      schedulePartial: vi.fn(() => {
        // Capture the render fn as if a real scheduler had queued it.
      }),
      flushFinal: vi.fn(),
      cancel: vi.fn(),
      hasPending: vi.fn(() => false),
    }
    const { controller, sessions, onShellRender, state } = buildController({
      renderSchedulerFactory: (render) => {
        renders.push(render)
        return fakeScheduler
      },
    })
    await controller.connect()
    onShellRender.mockClear()

    sessions[0].capturedDeps.onTranscript({
      text: 'partial text',
      startMs: 0,
      endMs: 500,
      status: 'partial',
      speaker: 'A',
    } as RawAsrEvent)

    // State is applied immediately so the next render reflects it.
    expect(state.segments()[0].text).toBe('partial text')
    // But the render call is deferred to the scheduler — no synchronous fire.
    expect(onShellRender).not.toHaveBeenCalled()
    expect(fakeScheduler.schedulePartial).toHaveBeenCalledOnce()
    expect(fakeScheduler.flushFinal).not.toHaveBeenCalled()

    // Manually invoke the captured render fn to confirm wiring.
    renders[0]()
    expect(onShellRender).toHaveBeenCalledWith()
  })

  it('a final after a pending partial calls flushFinal so the caption locks in immediately', async () => {
    const fakeScheduler = {
      schedulePartial: vi.fn(),
      flushFinal: vi.fn(),
      cancel: vi.fn(),
      hasPending: vi.fn(() => false),
    }
    const { controller, sessions } = buildController({
      renderSchedulerFactory: () => fakeScheduler,
    })
    await controller.connect()

    sessions[0].capturedDeps.onTranscript({
      text: 'partial',
      startMs: 0,
      endMs: 100,
      status: 'partial',
      speaker: 'A',
    } as RawAsrEvent)
    sessions[0].capturedDeps.onTranscript({
      text: 'partial final',
      startMs: 0,
      endMs: 500,
      status: 'final',
      speaker: 'A',
    } as RawAsrEvent)

    expect(fakeScheduler.schedulePartial).toHaveBeenCalledOnce()
    expect(fakeScheduler.flushFinal).toHaveBeenCalledOnce()
  })

  it('terminate() cancels any pending scheduler render', async () => {
    const fakeScheduler = {
      schedulePartial: vi.fn(),
      flushFinal: vi.fn(),
      cancel: vi.fn(),
      hasPending: vi.fn(() => false),
    }
    const { controller } = buildController({
      renderSchedulerFactory: () => fakeScheduler,
    })
    await controller.connect()
    controller.terminate()
    expect(fakeScheduler.cancel).toHaveBeenCalled()
  })

  it('connect() cancels any pending scheduler render before clearing state', async () => {
    const fakeScheduler = {
      schedulePartial: vi.fn(),
      flushFinal: vi.fn(),
      cancel: vi.fn(),
      hasPending: vi.fn(() => false),
    }
    const { controller } = buildController({
      renderSchedulerFactory: () => fakeScheduler,
    })
    await controller.connect()
    fakeScheduler.cancel.mockClear()
    await controller.connect()
    expect(fakeScheduler.cancel).toHaveBeenCalled()
  })

  it('forwards session visual statuses through onShellRender so the deaf-first contract is preserved', async () => {
    const { controller, sessions, onShellRender } = buildController()
    await controller.connect()
    onShellRender.mockClear()
    sessions[0].capturedDeps.onVisualStatus('ASR LOST — reconnecting')
    expect(onShellRender).toHaveBeenCalledWith('ASR LOST — reconnecting')
  })

  it('routes session onError through the logger', async () => {
    const { controller, sessions, logger } = buildController()
    await controller.connect()
    const err = new Error('boom')
    sessions[0].capturedDeps.onError('asr_lost', err, { detail: 'x' })
    expect(logger.error).toHaveBeenCalledWith('asr_lost', err, { detail: 'x' })
  })

  it('connect() failures still log asr_connect_failed; the session ref is left as-is so the underlying LiveSession can manage its own visual state', async () => {
    const session = makeFakeSession(async () => {
      throw new Error('ws refused')
    })
    const { controller, logger } = buildController({
      sessionFactoryImpl: (deps) => {
        ;(session as unknown as { __setDeps: (d: AsrLiveSessionDeps) => void }).__setDeps(deps)
        return session
      },
    })
    await controller.connect()
    // The controller intentionally does not clear the session on connect-failure;
    // the underlying LiveSession may still rerender. isConnected mirrors session presence.
    expect(controller.isConnected()).toBe(true)
    expect(logger.error).toHaveBeenCalledWith('asr_connect_failed', expect.any(Error))
  })

  it('ensureConnected() short-circuits when already connected', async () => {
    const { controller, sessions } = buildController()
    await controller.connect('first')
    await controller.ensureConnected('second')
    expect(sessions).toHaveLength(1)
  })

  it('ensureConnected() connects with the supplied fixtureId when no session exists', async () => {
    const { controller, logger } = buildController()
    await controller.ensureConnected('browser-mic')
    expect(logger.stage).toHaveBeenCalledWith('asr_connect_start', { fixtureId: 'browser-mic' })
  })

  it('streamPcmChunks/sendPcmChunk throw before connect()', async () => {
    const { controller } = buildController()
    await expect(controller.streamPcmChunks([])).rejects.toThrow(/not connected/)
    const chunk: PcmChunk = { seq: 0, data: new ArrayBuffer(0), durationMs: 100 }
    await expect(controller.sendPcmChunk(chunk)).rejects.toThrow(/not connected/)
  })

  it('streamPcmChunks/sendPcmChunk forward to the session after connect()', async () => {
    const { controller, sessions } = buildController()
    await controller.connect()
    const chunk: PcmChunk = { seq: 1, data: new ArrayBuffer(2), durationMs: 100 }
    await controller.streamPcmChunks([chunk])
    await controller.sendPcmChunk(chunk)
    expect(sessions[0].streamPcmChunks).toHaveBeenCalledWith([chunk])
    expect(sessions[0].sendPcmChunk).toHaveBeenCalledWith(chunk)
  })

  it('terminate() invokes session.terminate with the supplied close-status and clears the session', async () => {
    const { controller, sessions } = buildController()
    await controller.connect()
    controller.terminate('SMOKE COMPLETE')
    expect(sessions[0].terminate).toHaveBeenCalledWith('SMOKE COMPLETE')
    expect(controller.isConnected()).toBe(false)
  })
})
