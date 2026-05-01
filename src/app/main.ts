import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BrowserMicrophonePcmSource } from '../audio/browserMicrophone'
import { G2SdkAudioSource, type G2AudioBridge } from '../audio/g2SdkAudio'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { DeepgramLiveSession } from '../asr/DeepgramLiveSession'
import { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import { createBenchmarkTelemetryRecorder, type BenchmarkTelemetryRecorder } from '../captions/latency'
import { G2LensDisplay } from '../display/g2LensDisplay'
import { createClientLogger } from '../observability/clientLogger'
import type { RawAsrEvent } from '../types'
import { runFixturePrototype } from './runFixturePrototype'
import {
  getClientLogEndpoint,
  getDefaultStreamingEndpoint,
  getDefaultTokenEndpoint,
  getSpeechFixtureUrl,
  shouldAutoRunHardwareSmoke,
} from './runtimeConfig'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
const locationUrl = new URL(window.location.href)
const logger = createClientLogger({
  endpoint: getClientLogEndpoint(locationUrl),
  href: window.location.href,
})
let session: DeepgramLiveSession | undefined
let g2Display: G2LensDisplay | undefined
let g2AudioBridge: G2AudioBridge | undefined
let liveAudioSource: { stop: () => Promise<void> } | undefined
let lastFrameText = ''
let currentVisualStatus = 'READY — starting caption check'
let telemetry: BenchmarkTelemetryRecorder | undefined

if (app) {
  logger.stage('app_boot', { href: window.location.href })
  renderShell('READY — starting caption check')
  void initializeG2Display()
}

async function initializeG2Display(): Promise<void> {
  try {
    logger.stage('bridge_wait_start')
    const bridge = await waitForEvenAppBridge()
    logger.stage('bridge_ready')
    g2AudioBridge = bridge as unknown as G2AudioBridge
    g2Display = new G2LensDisplay(bridge)
    await renderLens(lastFrameText)
    if (shouldAutoRunHardwareSmoke(new URL(window.location.href), true)) {
      logger.stage('auto_smoke_start')
      void runHardwareSpeechSmoke()
    }
  } catch (err) {
    logger.error('bridge_init_failed', err)
    // Browser/local preview path. Keep every state visible in the phone shell.
  }
}

async function renderLens(frameText: string): Promise<void> {
  if (!g2Display) return
  const result = await g2Display.render(frameText)
  if (result.ok === false && app) {
    logger.error('g2_display_failed', new Error(result.visualStatus), { frameText })
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
    logger.stage('button_connect_deepgram')
    void connectDeepgram()
  })
  app.append(connect)

  const streamFixture = document.createElement('button')
  streamFixture.textContent = 'Stream Silent PCM Fixture'
  streamFixture.addEventListener('click', () => {
    logger.stage('button_stream_silent_fixture')
    void streamSilentFixture()
  })
  app.append(streamFixture)

  const streamSpeechFixtureButton = document.createElement('button')
  streamSpeechFixtureButton.textContent = 'Stream Speech PCM Fixture'
  streamSpeechFixtureButton.addEventListener('click', () => {
    logger.stage('button_stream_speech_fixture')
    void streamSpeechFixture()
  })
  app.append(streamSpeechFixtureButton)

  const browserMic = document.createElement('button')
  browserMic.textContent = 'Start Browser Mic'
  browserMic.addEventListener('click', () => {
    logger.stage('button_start_browser_mic')
    void startBrowserMicrophone()
  })
  app.append(browserMic)

  const g2Mic = document.createElement('button')
  g2Mic.textContent = 'Start G2 SDK Audio'
  g2Mic.addEventListener('click', () => {
    logger.stage('button_start_g2_sdk_audio')
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
  logger.stage('asr_connect_start', { fixtureId })
  state.clear()
  session?.terminate()
  telemetry = createBenchmarkTelemetryRecorder({ provider: 'deepgram', fixtureId })
  session = new DeepgramLiveSession({
    tokenEndpoint: getDefaultTokenEndpoint(locationUrl),
    streamingEndpoint: getDefaultStreamingEndpoint(locationUrl),
    keyterms: ['ProvenMachine'],
    onTranscript: (event: RawAsrEvent) => {
      state.applyAsrEvent(event)
      telemetry?.mark('caption_formatted')
      telemetry?.mark('display_update_sent')
      logger.stage('speaker_label_observed', {
        speaker: event.speaker ?? '?',
        status: event.status,
        textLength: event.text.length,
      })
      renderShell(currentVisualStatus)
    },
    onVisualStatus: renderShell,
    onTelemetry: (stage, details) => telemetry?.mark(stage, details),
    onError: (stage, err, details) => logger.error(stage, err, details),
  })

  try {
    await session.connect()
    logger.stage('asr_connect_success')
    renderShell('ASR CONNECTED — waiting audio')
  } catch (err) {
    logger.error('asr_connect_failed', err)
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
  } catch (err) {
    logger.error('silent_fixture_stream_failed', err)
    // DeepgramLiveSession already rendered a visual failure state.
  }
}

async function startBrowserMicrophone(): Promise<void> {
  await ensureDeepgramConnected('browser-mic')
  if (!session) return
  await stopLiveAudio('BROWSER MIC RESTARTING — captions paused', false)
  const source = new BrowserMicrophonePcmSource({
    onVisualStatus: renderShell,
    onError: (stage, err, details) => logger.error(stage, err, details),
    onChunk: async (chunk) => {
      try {
        await session?.sendPcmChunk(chunk)
      } catch (err) {
        logger.error('browser_mic_chunk_send_failed', err, { seq: chunk.seq })
        renderShell('BROWSER MIC STREAM FAILED — captions paused')
      }
    },
  })
  liveAudioSource = source
  try {
    await source.start()
  } catch (err) {
    logger.error('browser_mic_start_failed', err)
    liveAudioSource = undefined
  }
}

async function startG2SdkAudio(): Promise<void> {
  logger.stage('g2_sdk_audio_start_requested')
  await ensureDeepgramConnected('g2-sdk-audio')
  logger.stage('g2_sdk_audio_asr_ready', { connected: Boolean(session) })
  if (!session) return
  if (!g2AudioBridge) {
    logger.warn('g2_sdk_audio_bridge_unavailable')
    renderShell('G2 MIC FAILED — bridge unavailable')
    return
  }
  logger.stage('g2_sdk_audio_stop_previous_start')
  await stopLiveAudio('G2 MIC RESTARTING — captions paused', false)
  logger.stage('g2_sdk_audio_stop_previous_done')
  const source = new G2SdkAudioSource({
    bridge: g2AudioBridge,
    onVisualStatus: renderShell,
    onStageLog: (stage, details) => logger.stage(stage, details),
    onChunk: async (chunk) => {
      logger.stage('g2_sdk_audio_chunk_send_start', {
        seq: chunk.seq,
        byteLength: chunk.data.byteLength,
        durationMs: chunk.durationMs,
      })
      try {
        await session?.sendPcmChunk(chunk)
        logger.stage('g2_sdk_audio_chunk_send_done', { seq: chunk.seq })
      } catch (err) {
        logger.error('g2_sdk_audio_chunk_send_failed', err, { seq: chunk.seq })
        renderShell('G2 MIC STREAM FAILED — captions paused')
      }
    },
  })
  liveAudioSource = source
  try {
    logger.stage('g2_sdk_audio_source_start_call')
    await source.start()
    logger.stage('g2_sdk_audio_source_start_done')
  } catch (err) {
    logger.error('g2_sdk_audio_source_start_failed', err)
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
    const fixture = await loadPcmS16LeFixtureFromUrl(getSpeechFixtureUrl(new URL(window.location.href)), {
      sampleRate: 16_000,
    })
    stage = 'stream'
    renderShell('AUDIO SPEECH FIXTURE STREAMING')
    await session.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
    stage = 'terminate'
    session.terminate('SMOKE COMPLETE — captions verified')
    session = undefined
    renderShell('AUDIO SPEECH FIXTURE SENT — finalizing ASR')
  } catch (err) {
    logger.error('speech_fixture_stream_failed', err, { stage })
    const visualStage = stage === 'load' ? 'LOAD' : stage === 'stream' ? 'STREAM' : 'FINALIZE'
    renderShell(`AUDIO SPEECH ${visualStage} FAILED — captions paused`)
  }
}

export { connectDeepgram, runFixturePrototype, streamSilentFixture, streamSpeechFixture }
