import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BrowserMicrophonePcmSource } from '../audio/browserMicrophone'
import { G2SdkAudioSource, type G2AudioBridge } from '../audio/g2SdkAudio'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { AssemblyAiLiveSession } from '../asr/AssemblyAiLiveSession'
import { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import { createBenchmarkTelemetryRecorder, type BenchmarkTelemetryRecorder } from '../captions/latency'
import { G2LensDisplay } from '../display/g2LensDisplay'
import type { RawAsrEvent } from '../types'
import { runFixturePrototype } from './runFixturePrototype'
import { getDefaultTokenEndpoint, getSpeechFixtureUrl, shouldAutoRunHardwareSmoke } from './runtimeConfig'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
let session: AssemblyAiLiveSession | undefined
let g2Display: G2LensDisplay | undefined
let g2AudioBridge: G2AudioBridge | undefined
let liveAudioSource: { stop: () => Promise<void> } | undefined
let lastFrameText = ''
let telemetry: BenchmarkTelemetryRecorder | undefined

if (app) {
  renderShell('READY — token broker required')
  void initializeG2Display()
}

async function initializeG2Display(): Promise<void> {
  try {
    const bridge = await waitForEvenAppBridge()
    g2AudioBridge = bridge as unknown as G2AudioBridge
    g2Display = new G2LensDisplay(bridge)
    await renderLens(lastFrameText)
    if (shouldAutoRunHardwareSmoke(new URL(window.location.href), true)) {
      void runHardwareSpeechSmoke()
    }
  } catch {
    // Browser/local preview path. Keep every state visible in the phone shell.
  }
}

async function renderLens(frameText: string): Promise<void> {
  if (!g2Display) return
  const result = await g2Display.render(frameText)
  if (result.ok === false && app) {
    const warning = document.createElement('div')
    warning.setAttribute('role', 'status')
    warning.textContent = result.visualStatus
    app.append(warning)
  }
}

function renderShell(status: string): void {
  if (!app) return
  const frame = formatCaptionFrame(state.segments(), {
    title: 'G2 CAPTIONS',
    status,
    maxLines: 6,
    lineWidth: 28,
  })
  lastFrameText = frame.text

  app.innerHTML = ''
  const pre = document.createElement('pre')
  pre.textContent = frame.text
  app.append(pre)
  void renderLens(frame.text)
  renderTelemetryReport()

  const connect = document.createElement('button')
  connect.textContent = 'Connect AssemblyAI'
  connect.addEventListener('click', () => void connectAssemblyAi())
  app.append(connect)

  const streamFixture = document.createElement('button')
  streamFixture.textContent = 'Stream Silent PCM Fixture'
  streamFixture.addEventListener('click', () => void streamSilentFixture())
  app.append(streamFixture)

  const streamSpeechFixtureButton = document.createElement('button')
  streamSpeechFixtureButton.textContent = 'Stream Speech PCM Fixture'
  streamSpeechFixtureButton.addEventListener('click', () => void streamSpeechFixture())
  app.append(streamSpeechFixtureButton)

  const browserMic = document.createElement('button')
  browserMic.textContent = 'Start Browser Mic'
  browserMic.addEventListener('click', () => void startBrowserMicrophone())
  app.append(browserMic)

  const g2Mic = document.createElement('button')
  g2Mic.textContent = 'Start G2 SDK Audio'
  g2Mic.addEventListener('click', () => void startG2SdkAudio())
  app.append(g2Mic)

  const stopLive = document.createElement('button')
  stopLive.textContent = 'Stop Live Audio'
  stopLive.addEventListener('click', () => void stopLiveAudio('LIVE AUDIO STOPPED — captions paused'))
  app.append(stopLive)

  const stop = document.createElement('button')
  stop.textContent = 'Terminate'
  stop.addEventListener('click', () => {
    session?.terminate()
    void stopLiveAudio('ASR TERMINATED')
    session = undefined
    renderShell('ASR TERMINATED')
  })
  app.append(stop)
}

function renderTelemetryReport(): void {
  if (!app || !telemetry) return
  const report = telemetry.report()
  if (report.events.length === 0) return

  const details = document.createElement('details')
  details.open = true
  const summary = document.createElement('summary')
  summary.textContent = 'Telemetry JSON'
  details.append(summary)

  const reportPre = document.createElement('pre')
  reportPre.setAttribute('aria-label', 'Latest benchmark telemetry JSON')
  reportPre.textContent = JSON.stringify(report, null, 2)
  details.append(reportPre)
  app.append(details)
}

async function runHardwareSpeechSmoke(): Promise<void> {
  renderShell('HARDWARE SMOKE — connecting ASR')
  await connectAssemblyAi()
  if (!session) return
  await streamSpeechFixture()
}

async function connectAssemblyAi(fixtureId = 'speech-smoke'): Promise<void> {
  state.clear()
  session?.terminate()
  telemetry = createBenchmarkTelemetryRecorder({ provider: 'assemblyai', fixtureId })
  session = new AssemblyAiLiveSession({
    tokenEndpoint: getDefaultTokenEndpoint(new URL(window.location.href)),
    keyterms: ['ProvenMachine'],
    onTranscript: (event: RawAsrEvent) => {
      state.applyAsrEvent(event)
      telemetry?.mark('caption_formatted')
      telemetry?.mark('display_update_sent')
      renderShell('ASR CONNECTED — waiting audio')
    },
    onVisualStatus: renderShell,
    onTelemetry: (stage, details) => telemetry?.mark(stage, details),
  })

  try {
    await session.connect()
    renderShell('ASR CONNECTED — waiting audio')
  } catch {
    // AssemblyAiLiveSession already rendered a visual failure state.
  }
}

async function streamSilentFixture(): Promise<void> {
  if (!session) {
    renderShell('AUDIO STREAM FAILED — ASR not connected')
    return
  }

  const fixture = createSilentPcmS16LeFixture({ durationMs: 1000, sampleRate: 16_000 })
  try {
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
  } catch {
    // AssemblyAiLiveSession already rendered a visual failure state.
  }
}

async function startBrowserMicrophone(): Promise<void> {
  await ensureAssemblyAiConnected('browser-mic')
  if (!session) return
  await stopLiveAudio('BROWSER MIC RESTARTING — captions paused', false)
  const source = new BrowserMicrophonePcmSource({
    onVisualStatus: renderShell,
    onChunk: async (chunk) => {
      try {
        await session?.sendPcmChunk(chunk)
      } catch {
        renderShell('BROWSER MIC STREAM FAILED — captions paused')
      }
    },
  })
  liveAudioSource = source
  try {
    await source.start()
  } catch {
    liveAudioSource = undefined
  }
}

async function startG2SdkAudio(): Promise<void> {
  await ensureAssemblyAiConnected('g2-sdk-audio')
  if (!session) return
  if (!g2AudioBridge) {
    renderShell('G2 MIC FAILED — bridge unavailable')
    return
  }
  await stopLiveAudio('G2 MIC RESTARTING — captions paused', false)
  const source = new G2SdkAudioSource({
    bridge: g2AudioBridge,
    onVisualStatus: renderShell,
    onChunk: async (chunk) => {
      try {
        await session?.sendPcmChunk(chunk)
      } catch {
        renderShell('G2 MIC STREAM FAILED — captions paused')
      }
    },
  })
  liveAudioSource = source
  try {
    await source.start()
  } catch {
    liveAudioSource = undefined
  }
}

async function ensureAssemblyAiConnected(fixtureId: string): Promise<void> {
  if (session) return
  telemetry = createBenchmarkTelemetryRecorder({ provider: 'assemblyai', fixtureId })
  await connectAssemblyAi(fixtureId)
}

async function stopLiveAudio(status: string, render = true): Promise<void> {
  await liveAudioSource?.stop()
  liveAudioSource = undefined
  if (render) renderShell(status)
}

async function streamSpeechFixture(): Promise<void> {
  if (!session) {
    renderShell('AUDIO STREAM FAILED — ASR not connected')
    return
  }

  let stage: 'load' | 'stream' | 'terminate' = 'load'
  try {
    renderShell('AUDIO SPEECH FIXTURE LOADING')
    const fixture = await loadPcmS16LeFixtureFromUrl(getSpeechFixtureUrl(new URL(window.location.href)), { sampleRate: 16_000 })
    stage = 'stream'
    renderShell('AUDIO SPEECH FIXTURE STREAMING')
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
    stage = 'terminate'
    session.terminate()
    session = undefined
    renderShell('AUDIO SPEECH FIXTURE SENT — finalizing ASR')
  } catch {
    const visualStage = stage === 'load' ? 'LOAD' : stage === 'stream' ? 'STREAM' : 'FINALIZE'
    renderShell(`AUDIO SPEECH ${visualStage} FAILED — captions paused`)
  }
}

export { connectAssemblyAi, runFixturePrototype, streamSilentFixture, streamSpeechFixture }
