import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BrowserMicrophonePcmSource } from '../audio/browserMicrophone'
import { G2SdkAudioSource, type G2AudioBridge } from '../audio/g2SdkAudio'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { DeepgramLiveSession } from '../asr/DeepgramLiveSession'
import { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import { createBenchmarkTelemetryRecorder, type BenchmarkTelemetryRecorder } from '../captions/latency'
import { G2LensDisplay } from '../display/g2LensDisplay'
import type { RawAsrEvent } from '../types'
import { runFixturePrototype } from './runFixturePrototype'
import { getClientLogEndpoint, getDefaultStreamingEndpoint, getDefaultTokenEndpoint, getSpeechFixtureUrl, shouldAutoRunHardwareSmoke } from './runtimeConfig'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
let session: DeepgramLiveSession | undefined
let g2Display: G2LensDisplay | undefined
let g2AudioBridge: G2AudioBridge | undefined
let liveAudioSource: { stop: () => Promise<void> } | undefined
let lastFrameText = ''
let currentVisualStatus = 'READY — starting caption check'
let telemetry: BenchmarkTelemetryRecorder | undefined

if (app) {
  logClientStage('app_boot', { href: window.location.href })
  renderShell('READY — starting caption check')
  void initializeG2Display()
}

function logClientStage(stage: string, details: Record<string, unknown> = {}): void {
  console.info(`[g2-captions] ${stage}`, details)
  const locationUrl = new URL(window.location.href)
  void fetch(getClientLogEndpoint(locationUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, details, href: window.location.href, at: new Date().toISOString() }),
  }).catch(() => undefined)
}

async function initializeG2Display(): Promise<void> {
  try {
    logClientStage('bridge_wait_start')
    const bridge = await waitForEvenAppBridge()
    logClientStage('bridge_ready')
    g2AudioBridge = bridge as unknown as G2AudioBridge
    g2Display = new G2LensDisplay(bridge)
    await renderLens(lastFrameText)
    if (shouldAutoRunHardwareSmoke(new URL(window.location.href), true)) {
      logClientStage('auto_smoke_start')
      void runHardwareSpeechSmoke()
    }
  } catch (error) {
    logClientStage('bridge_init_failed', { message: error instanceof Error ? error.message : String(error) })
    // Browser/local preview path. Keep every state visible in the phone shell.
  }
}

async function renderLens(frameText: string): Promise<void> {
  if (!g2Display) return
  const result = await g2Display.render(frameText)
  if (result.ok === false && app) {
    logClientStage('g2_display_failed', { visualStatus: result.visualStatus, frameText })
    const warning = document.createElement('div')
    warning.setAttribute('role', 'status')
    warning.textContent = result.visualStatus
    app.append(warning)
  }
}

function renderShell(status: string): void {
  currentVisualStatus = status
  if (!app) return
  const frame = formatCaptionFrame(state.segments(), {
    title: 'G2 CAPTIONS',
    status,
    maxLines: 6,
    lineWidth: 34,
  })
  lastFrameText = frame.text

  app.innerHTML = ''
  const pre = document.createElement('pre')
  pre.textContent = frame.text
  app.append(pre)
  void renderLens(frame.text)
  renderTelemetryReport()

  const connect = document.createElement('button')
  connect.textContent = 'Connect Deepgram'
  connect.addEventListener('click', () => {
    logClientStage('button_connect_deepgram')
    void connectDeepgram()
  })
  app.append(connect)

  const streamFixture = document.createElement('button')
  streamFixture.textContent = 'Stream Silent PCM Fixture'
  streamFixture.addEventListener('click', () => {
    logClientStage('button_stream_silent_fixture')
    void streamSilentFixture()
  })
  app.append(streamFixture)

  const streamSpeechFixtureButton = document.createElement('button')
  streamSpeechFixtureButton.textContent = 'Stream Speech PCM Fixture'
  streamSpeechFixtureButton.addEventListener('click', () => {
    logClientStage('button_stream_speech_fixture')
    void streamSpeechFixture()
  })
  app.append(streamSpeechFixtureButton)

  const browserMic = document.createElement('button')
  browserMic.textContent = 'Start Browser Mic'
  browserMic.addEventListener('click', () => {
    logClientStage('button_start_browser_mic')
    void startBrowserMicrophone()
  })
  app.append(browserMic)

  const g2Mic = document.createElement('button')
  g2Mic.textContent = 'Start G2 SDK Audio'
  g2Mic.addEventListener('click', () => {
    logClientStage('button_start_g2_sdk_audio')
    void startG2SdkAudio()
  })
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
  await connectDeepgram()
  if (!session) return
  await streamSpeechFixture()
}

async function connectDeepgram(fixtureId = 'speech-smoke'): Promise<void> {
  logClientStage('asr_connect_start', { fixtureId })
  state.clear()
  session?.terminate()
  telemetry = createBenchmarkTelemetryRecorder({ provider: 'deepgram', fixtureId })
  const locationUrl = new URL(window.location.href)
  session = new DeepgramLiveSession({
    tokenEndpoint: getDefaultTokenEndpoint(locationUrl),
    streamingEndpoint: getDefaultStreamingEndpoint(locationUrl),
    keyterms: ['ProvenMachine'],
    onTranscript: (event: RawAsrEvent) => {
      state.applyAsrEvent(event)
      telemetry?.mark('caption_formatted')
      telemetry?.mark('display_update_sent')
      logClientStage('speaker_label_observed', {
        speaker: event.speaker ?? '?',
        status: event.status,
        textLength: event.text.length,
      })
      renderShell(currentVisualStatus)
    },
    onVisualStatus: renderShell,
    onTelemetry: (stage, details) => telemetry?.mark(stage, details),
  })

  try {
    await session.connect()
    logClientStage('asr_connect_success')
    renderShell('ASR CONNECTED — waiting audio')
  } catch (error) {
    logClientStage('asr_connect_failed', { message: error instanceof Error ? error.message : String(error) })
    // DeepgramLiveSession already rendered a visual failure state.
  }
}

async function streamSilentFixture(): Promise<void> {
  if (!session) {
    await ensureDeepgramConnected('silent-fixture')
    if (!session) {
      renderShell('AUDIO STREAM FAILED — ASR not connected')
      return
    }
  }

  const fixture = createSilentPcmS16LeFixture({ durationMs: 1000, sampleRate: 16_000 })
  try {
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
  } catch {
    // DeepgramLiveSession already rendered a visual failure state.
  }
}

async function startBrowserMicrophone(): Promise<void> {
  await ensureDeepgramConnected('browser-mic')
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
  logClientStage('g2_sdk_audio_start_requested')
  await ensureDeepgramConnected('g2-sdk-audio')
  logClientStage('g2_sdk_audio_asr_ready', { connected: Boolean(session) })
  if (!session) return
  if (!g2AudioBridge) {
    logClientStage('g2_sdk_audio_bridge_unavailable')
    renderShell('G2 MIC FAILED — bridge unavailable')
    return
  }
  logClientStage('g2_sdk_audio_stop_previous_start')
  await stopLiveAudio('G2 MIC RESTARTING — captions paused', false)
  logClientStage('g2_sdk_audio_stop_previous_done')
  const source = new G2SdkAudioSource({
    bridge: g2AudioBridge,
    onVisualStatus: renderShell,
    onStageLog: logClientStage,
    onChunk: async (chunk) => {
      logClientStage('g2_sdk_audio_chunk_send_start', {
        seq: chunk.seq,
        byteLength: chunk.data.byteLength,
        durationMs: chunk.durationMs,
      })
      try {
        await session?.sendPcmChunk(chunk)
        logClientStage('g2_sdk_audio_chunk_send_done', { seq: chunk.seq })
      } catch (error) {
        logClientStage('g2_sdk_audio_chunk_send_failed', {
          seq: chunk.seq,
          message: error instanceof Error ? error.message : String(error),
        })
        renderShell('G2 MIC STREAM FAILED — captions paused')
      }
    },
  })
  liveAudioSource = source
  try {
    logClientStage('g2_sdk_audio_source_start_call')
    await source.start()
    logClientStage('g2_sdk_audio_source_start_done')
  } catch (error) {
    logClientStage('g2_sdk_audio_source_start_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    liveAudioSource = undefined
  }
}

async function ensureDeepgramConnected(fixtureId: string): Promise<void> {
  if (session) return
  telemetry = createBenchmarkTelemetryRecorder({ provider: 'deepgram', fixtureId })
  await connectDeepgram(fixtureId)
}

async function stopLiveAudio(status: string, render = true): Promise<void> {
  await liveAudioSource?.stop()
  liveAudioSource = undefined
  if (render) renderShell(status)
}

async function streamSpeechFixture(): Promise<void> {
  if (!session) {
    await ensureDeepgramConnected('speech-smoke')
    if (!session) {
      renderShell('AUDIO STREAM FAILED — ASR not connected')
      return
    }
  }

  let stage: 'load' | 'stream' | 'terminate' = 'load'
  try {
    renderShell('AUDIO SPEECH FIXTURE LOADING')
    const fixture = await loadPcmS16LeFixtureFromUrl(getSpeechFixtureUrl(new URL(window.location.href)), { sampleRate: 16_000 })
    stage = 'stream'
    renderShell('AUDIO SPEECH FIXTURE STREAMING')
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
    stage = 'terminate'
    session.terminate('SMOKE COMPLETE — captions verified')
    session = undefined
    renderShell('AUDIO SPEECH FIXTURE SENT — finalizing ASR')
  } catch {
    const visualStage = stage === 'load' ? 'LOAD' : stage === 'stream' ? 'STREAM' : 'FINALIZE'
    renderShell(`AUDIO SPEECH ${visualStage} FAILED — captions paused`)
  }
}

export { connectDeepgram, runFixturePrototype, streamSilentFixture, streamSpeechFixture }
