// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASRController, type AsrLiveSession, type AsrLiveSessionDeps } from '../../src/app/ASRController'
import { AudioController, type LiveAudioSource, type LiveAudioSourceFactoryDeps } from '../../src/app/AudioController'
import { CaptionState } from '../../src/captions/CaptionState'
import { TelemetryReporter } from '../../src/app/TelemetryReporter'
import { UIShell } from '../../src/app/UIShell'
import type { ClientLogger } from '../../src/observability/clientLogger'
import type { G2AudioBridge } from '../../src/audio/g2SdkAudio'
import type { PcmChunk } from '../../src/audio/pcmFixture'

/**
 * End-to-end wiring smoke test: composes the four entry-point modules the
 * way main.ts does and asserts that each button click invokes the right
 * downstream method on the fake LiveSession / AudioSource. This covers the
 * single integration concern that the per-module unit tests don't: that
 * the `handlers` object passed into UIShell really does dispatch into
 * ASRController and AudioController in the expected shape.
 */

function makeLogger(): ClientLogger {
  return { stage: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

interface FakeSession extends AsrLiveSession {
  capturedDeps: AsrLiveSessionDeps
  connect: ReturnType<typeof vi.fn>
  streamPcmChunks: ReturnType<typeof vi.fn>
  sendPcmChunk: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

function makeFakeSession(): FakeSession {
  let captured!: AsrLiveSessionDeps
  const session = {
    get capturedDeps(): AsrLiveSessionDeps {
      return captured
    },
    connect: vi.fn(async () => undefined),
    streamPcmChunks: vi.fn(async () => undefined),
    sendPcmChunk: vi.fn(async () => undefined),
    terminate: vi.fn(),
  } as unknown as FakeSession
  ;(session as unknown as { __setDeps: (d: AsrLiveSessionDeps) => void }).__setDeps = (d) => {
    captured = d
  }
  return session
}

function makeFakeAudioSource(): LiveAudioSource & {
  capturedDeps: LiveAudioSourceFactoryDeps
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  let captured!: LiveAudioSourceFactoryDeps
  const source = {
    get capturedDeps() {
      return captured
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as LiveAudioSource & {
    capturedDeps: LiveAudioSourceFactoryDeps
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }
  ;(source as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps = (d) => {
    captured = d
  }
  return source
}

function makeBridge(): G2AudioBridge {
  return {
    audioControl: vi.fn(async () => true),
    onEvenHubEvent: vi.fn(() => () => undefined),
  }
}

function setupApp() {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)

  const state = new CaptionState()
  const telemetry = new TelemetryReporter()
  const logger = makeLogger()
  const session = makeFakeSession()
  const browserSource = makeFakeAudioSource()
  const g2Source = makeFakeAudioSource()

  const asr = new ASRController({
    state,
    telemetry,
    logger,
    sessionFactory: (deps) => {
      ;(session as unknown as { __setDeps: (d: AsrLiveSessionDeps) => void }).__setDeps(deps)
      return session
    },
    onShellRender: (status) => shell.render(status),
  })

  const audio = new AudioController({
    logger,
    onVisualStatus: (status) => shell.render(status),
    sendChunk: (chunk) => asr.sendPcmChunk(chunk),
    browserMicFactory: (deps) => {
      ;(browserSource as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps(deps)
      return browserSource
    },
    g2SdkAudioFactory: (_bridge, deps) => {
      ;(g2Source as unknown as { __setDeps: (d: LiveAudioSourceFactoryDeps) => void }).__setDeps(deps)
      return g2Source
    },
  })

  let connectCalls = 0
  const shell = new UIShell({
    root,
    state,
    telemetry,
    logger,
    // The wiring smoke exercises every button-driven flow, so we use the
    // debug-mode UI which exposes all of them. Production-mode end-user
    // wiring is covered by the per-mode UIShell unit tests.
    debug: true,
    handlers: {
      onConnectDeepgram: () => {
        connectCalls += 1
        void asr.connect()
      },
      onStreamSilentFixture: () => undefined,
      onStreamSpeechFixture: () => undefined,
      onStartBrowserMic: async () => {
        await asr.ensureConnected('browser-mic')
        await audio.startBrowserMic()
      },
      onStartG2SdkAudio: async () => {
        await asr.ensureConnected('g2-sdk-audio')
        await audio.startG2SdkAudio(makeBridge())
      },
      onStopLiveAudio: () => void audio.stop('LIVE AUDIO STOPPED — captions paused'),
      onTerminate: () => {
        asr.terminate('ASR TERMINATED')
        void audio.stop('ASR TERMINATED')
      },
      onPauseCaptions: () => void audio.stop('CAPTIONS PAUSED — tap ring to resume'),
      onResumeCaptions: async () => {
        await asr.ensureConnected('g2-sdk-audio')
        await audio.startG2SdkAudio(makeBridge())
      },
    },
  })

  shell.render('READY — starting caption check')

  return {
    root,
    state,
    telemetry,
    logger,
    asr,
    audio,
    shell,
    session,
    browserSource,
    g2Source,
    getConnectCalls: () => connectCalls,
  }
}

const byLabel = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)!

describe('app wiring', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('Connect Deepgram button drives ASRController.connect, which calls session.connect once', async () => {
    const ctx = setupApp()
    byLabel(ctx.root, 'Connect Deepgram').click()
    await Promise.resolve()
    expect(ctx.getConnectCalls()).toBe(1)
    expect(ctx.session.connect).toHaveBeenCalledOnce()
    expect(ctx.asr.isConnected()).toBe(true)
  })

  it('Start Browser Mic button connects ASR if needed and starts the browser-mic source', async () => {
    const ctx = setupApp()
    byLabel(ctx.root, 'Start Browser Mic').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.session.connect).toHaveBeenCalledOnce()
    expect(ctx.browserSource.start).toHaveBeenCalledOnce()
  })

  it('Start G2 SDK Audio button reuses the active session and starts the G2 source', async () => {
    const ctx = setupApp()
    await ctx.asr.connect()
    byLabel(ctx.root, 'Start G2 SDK Audio').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.session.connect).toHaveBeenCalledOnce() // not re-connected
    expect(ctx.g2Source.start).toHaveBeenCalledOnce()
  })

  it('Terminate button calls session.terminate and stops the active source', async () => {
    const ctx = setupApp()
    await ctx.asr.connect()
    byLabel(ctx.root, 'Start Browser Mic').click()
    await new Promise((r) => setTimeout(r, 0))

    byLabel(ctx.root, 'Terminate').click()
    await new Promise((r) => setTimeout(r, 0))

    expect(ctx.session.terminate).toHaveBeenCalledWith('ASR TERMINATED')
    expect(ctx.browserSource.stop).toHaveBeenCalled()
    expect(ctx.asr.isConnected()).toBe(false)
  })

  it('PCM chunks emitted by the audio source flow into session.sendPcmChunk via AudioController', async () => {
    const ctx = setupApp()
    await ctx.asr.connect()
    await ctx.audio.startBrowserMic()

    const chunk: PcmChunk = { seq: 1, data: new ArrayBuffer(8), durationMs: 100 }
    await ctx.browserSource.capturedDeps.onChunk(chunk)
    expect(ctx.session.sendPcmChunk).toHaveBeenCalledWith(chunk)
  })

  it('A session transcript event re-renders the shell with the caption text', async () => {
    const ctx = setupApp()
    await ctx.asr.connect()
    ctx.session.capturedDeps.onTranscript({
      vendor: 'deepgram',
      text: 'wired together',
      startMs: 0,
      endMs: 1000,
      status: 'final',
      speaker: 'A',
      receivedAtMs: 1100,
    })
    expect(ctx.root.querySelector('pre')?.textContent).toContain('wired together')
  })
})
