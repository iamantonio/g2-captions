import { describe, expect, it, vi } from 'vitest'
import { AudioController, type LiveAudioSource, type LiveAudioSourceFactoryDeps } from '../../src/app/AudioController'
import type { ClientLogger } from '../../src/observability/clientLogger'
import type { G2AudioBridge } from '../../src/audio/g2SdkAudio'
import type { PcmChunk } from '../../src/audio/pcmFixture'

interface FakeSource extends LiveAudioSource {
  capturedDeps: LiveAudioSourceFactoryDeps
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function makeFakeSource(opts: { startThrows?: Error } = {}): FakeSource {
  let captured: LiveAudioSourceFactoryDeps | undefined
  const source = {
    get capturedDeps() {
      if (!captured) throw new Error('capturedDeps read before factory call')
      return captured
    },
    start: vi.fn(async () => {
      if (opts.startThrows) throw opts.startThrows
    }),
    stop: vi.fn(async () => undefined),
  } as unknown as FakeSource
  ;(source as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps = (d) => {
    captured = d
  }
  return source
}

function makeLogger(): ClientLogger & {
  stage: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { stage: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeBridge(): G2AudioBridge {
  return {
    audioControl: vi.fn(async () => true),
    onEvenHubEvent: vi.fn(() => () => undefined),
  }
}

interface BuildOpts {
  browserMicSource?: FakeSource
  g2Source?: FakeSource
  sendChunkImpl?: (chunk: PcmChunk) => Promise<void>
}

function buildController(opts: BuildOpts = {}) {
  const logger = makeLogger()
  const onVisualStatus = vi.fn()
  const sendChunk = vi.fn(opts.sendChunkImpl ?? (async () => undefined))
  const browserSource = opts.browserMicSource ?? makeFakeSource()
  const g2Source = opts.g2Source ?? makeFakeSource()
  const browserMicFactory = vi.fn((deps: LiveAudioSourceFactoryDeps) => {
    ;(browserSource as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps(deps)
    return browserSource
  })
  const g2SdkAudioFactory = vi.fn((bridge: G2AudioBridge, deps: LiveAudioSourceFactoryDeps) => {
    ;(g2Source as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps(deps)
    return g2Source
  })
  const controller = new AudioController({
    logger,
    onVisualStatus,
    sendChunk,
    browserMicFactory,
    g2SdkAudioFactory,
  })
  return {
    logger,
    onVisualStatus,
    sendChunk,
    browserSource,
    g2Source,
    browserMicFactory,
    g2SdkAudioFactory,
    controller,
  }
}

describe('AudioController', () => {
  it('starts with no active source', () => {
    const { controller } = buildController()
    expect(controller.hasActiveSource()).toBe(false)
  })

  it('startBrowserMic builds a source via the factory and starts it', async () => {
    const { controller, browserMicFactory, browserSource } = buildController()
    await controller.startBrowserMic()
    expect(browserMicFactory).toHaveBeenCalled()
    expect(browserSource.start).toHaveBeenCalled()
    expect(controller.hasActiveSource()).toBe(true)
  })

  it('startBrowserMic stops the previous source first (without re-rendering its status)', async () => {
    const first = makeFakeSource()
    const { controller } = buildController({ browserMicSource: first })
    await controller.startBrowserMic()
    expect(first.stop).not.toHaveBeenCalled()

    const second = makeFakeSource()
    const ctx = buildController({ browserMicSource: first })
    await ctx.controller.startBrowserMic()
    ctx.browserMicFactory.mockImplementationOnce((deps) => {
      ;(second as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps(deps)
      return second
    })
    await ctx.controller.startBrowserMic()
    expect(first.stop).toHaveBeenCalled()
  })

  it('startBrowserMic surfaces start failures via the logger and clears the active source', async () => {
    const failingSource = makeFakeSource({ startThrows: new Error('mic denied') })
    const { controller, logger } = buildController({ browserMicSource: failingSource })
    await controller.startBrowserMic()
    expect(logger.error).toHaveBeenCalledWith('browser_mic_start_failed', expect.any(Error))
    expect(controller.hasActiveSource()).toBe(false)
  })

  it('startG2SdkAudio short-circuits when no bridge is provided and surfaces a visual status', async () => {
    const { controller, logger, onVisualStatus } = buildController()
    await controller.startG2SdkAudio(undefined)
    expect(logger.warn).toHaveBeenCalledWith('g2_sdk_audio_bridge_unavailable')
    expect(onVisualStatus).toHaveBeenCalledWith('G2 MIC FAILED — bridge unavailable')
    expect(controller.hasActiveSource()).toBe(false)
  })

  it('startG2SdkAudio builds a source from the bridge and starts it', async () => {
    const { controller, g2SdkAudioFactory, g2Source } = buildController()
    const bridge = makeBridge()
    await controller.startG2SdkAudio(bridge)
    expect(g2SdkAudioFactory).toHaveBeenCalled()
    expect(g2SdkAudioFactory.mock.calls[0][0]).toBe(bridge)
    expect(g2Source.start).toHaveBeenCalled()
    expect(controller.hasActiveSource()).toBe(true)
  })

  it('source.onChunk is wired to sendChunk; failures surface via onVisualStatus and the logger', async () => {
    const sendChunk = vi.fn(async () => {
      throw new Error('socket closed')
    })
    const { controller, browserSource, onVisualStatus, logger } = buildController({ sendChunkImpl: sendChunk })
    await controller.startBrowserMic()

    const chunk: PcmChunk = { seq: 7, data: new ArrayBuffer(4), durationMs: 100 }
    await browserSource.capturedDeps.onChunk(chunk)

    expect(sendChunk).toHaveBeenCalledWith(chunk)
    expect(onVisualStatus).toHaveBeenCalledWith('BROWSER MIC STREAM FAILED — captions paused')
    expect(logger.error).toHaveBeenCalledWith('browser_mic_chunk_send_failed', expect.any(Error), { seq: 7 })
  })

  it('G2 source onChunk emits start/done stage logs for hardware tracing', async () => {
    const { controller, g2Source, logger } = buildController()
    await controller.startG2SdkAudio(makeBridge())
    const chunk: PcmChunk = { seq: 3, data: new ArrayBuffer(8), durationMs: 100 }
    await g2Source.capturedDeps.onChunk(chunk)

    expect(logger.stage).toHaveBeenCalledWith('g2_sdk_audio_chunk_send_start', {
      seq: 3,
      byteLength: 8,
      durationMs: 100,
    })
    expect(logger.stage).toHaveBeenCalledWith('g2_sdk_audio_chunk_send_done', { seq: 3 })
  })

  it('G2 source visual statuses bubble through onVisualStatus and stage logs through logger.stage', async () => {
    const { controller, g2Source, onVisualStatus, logger } = buildController()
    await controller.startG2SdkAudio(makeBridge())
    g2Source.capturedDeps.onVisualStatus('G2 MIC LIVE — captions streaming')
    g2Source.capturedDeps.onStageLog('g2_audio_listener_registered')
    expect(onVisualStatus).toHaveBeenCalledWith('G2 MIC LIVE — captions streaming')
    expect(logger.stage).toHaveBeenCalledWith('g2_audio_listener_registered', undefined)
  })

  it('stop() awaits the active source.stop and renders the supplied status by default', async () => {
    const { controller, browserSource, onVisualStatus } = buildController()
    await controller.startBrowserMic()
    await controller.stop('LIVE AUDIO STOPPED — captions paused')
    expect(browserSource.stop).toHaveBeenCalled()
    expect(onVisualStatus).toHaveBeenCalledWith('LIVE AUDIO STOPPED — captions paused')
    expect(controller.hasActiveSource()).toBe(false)
  })

  it('stop(status, false) skips the visual-status callback (used during source-restart)', async () => {
    const { controller, onVisualStatus } = buildController()
    await controller.startBrowserMic()
    onVisualStatus.mockClear()
    await controller.stop('SILENT', false)
    expect(onVisualStatus).not.toHaveBeenCalled()
  })
})
