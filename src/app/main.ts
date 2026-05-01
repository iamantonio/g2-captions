import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BrowserMicrophonePcmSource } from '../audio/browserMicrophone'
import { G2SdkAudioSource, type G2AudioBridge } from '../audio/g2SdkAudio'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { DeepgramLiveSession } from '../asr/DeepgramLiveSession'
import { CaptionState } from '../captions/CaptionState'
import { G2LensDisplay } from '../display/g2LensDisplay'
import { createClientLogger } from '../observability/clientLogger'
import { ASRController } from './ASRController'
import { AudioController } from './AudioController'
import { runFixturePrototype } from './runFixturePrototype'
import {
  getBrokerAuthToken,
  getClientLogEndpoint,
  getDefaultStreamingEndpoint,
  getDefaultTokenEndpoint,
  getSpeechFixtureUrl,
  shouldAutoRunHardwareSmoke,
} from './runtimeConfig'
import { TelemetryReporter } from './TelemetryReporter'
import { UIShell } from './UIShell'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
const locationUrl = new URL(window.location.href)
const logger = createClientLogger({
  endpoint: getClientLogEndpoint(locationUrl),
  href: window.location.href,
})
const telemetry = new TelemetryReporter({ provider: 'deepgram' })
let g2AudioBridge: G2AudioBridge | undefined

if (app) {
  logger.stage('app_boot', { href: window.location.href })

  const asr = new ASRController({
    state,
    telemetry,
    logger,
    sessionFactory: (deps) =>
      new DeepgramLiveSession({
        tokenEndpoint: getDefaultTokenEndpoint(locationUrl),
        streamingEndpoint: getDefaultStreamingEndpoint(locationUrl),
        brokerAuthToken: getBrokerAuthToken(),
        keyterms: ['ProvenMachine'],
        ...deps,
      }),
    onShellRender: (status) => shell.render(status),
  })

  const audio = new AudioController({
    logger,
    onVisualStatus: (status) => shell.render(status),
    sendChunk: (chunk) => asr.sendPcmChunk(chunk),
    browserMicFactory: (deps) =>
      new BrowserMicrophonePcmSource({
        onChunk: deps.onChunk,
        onVisualStatus: deps.onVisualStatus,
        onError: deps.onError,
      }),
    g2SdkAudioFactory: (bridge, deps) =>
      new G2SdkAudioSource({
        bridge,
        onChunk: deps.onChunk,
        onVisualStatus: deps.onVisualStatus,
        onStageLog: deps.onStageLog,
      }),
  })

  const shell = new UIShell({
    root: app,
    state,
    telemetry,
    logger,
    handlers: {
      onConnectDeepgram: () => void asr.connect(),
      onStreamSilentFixture: () => void streamSilentFixture(asr, shell),
      onStreamSpeechFixture: () => void streamSpeechFixture(asr, shell),
      onStartBrowserMic: () => void startBrowserMic(asr, audio),
      onStartG2SdkAudio: () => void startG2SdkAudio(asr, audio),
      onStopLiveAudio: () => void audio.stop('LIVE AUDIO STOPPED — captions paused'),
      onTerminate: () => {
        asr.terminate('ASR TERMINATED')
        void audio.stop('ASR TERMINATED')
        shell.render('ASR TERMINATED')
      },
    },
  })

  shell.render('READY — starting caption check')
  void initializeG2Display(shell, asr)
}

async function initializeG2Display(shell: UIShell, asr: ASRController): Promise<void> {
  try {
    logger.stage('bridge_wait_start')
    const bridge = await waitForEvenAppBridge()
    logger.stage('bridge_ready')
    g2AudioBridge = bridge as unknown as G2AudioBridge
    shell.attachG2Display(new G2LensDisplay(bridge))
    await shell.renderLens(shell.getLastFrameText())
    if (shouldAutoRunHardwareSmoke(new URL(window.location.href), true)) {
      logger.stage('auto_smoke_start')
      void runHardwareSpeechSmoke(asr, shell)
    }
  } catch (err) {
    logger.error('bridge_init_failed', err)
    // Browser/local preview path. Keep every state visible in the phone shell.
  }
}

async function runHardwareSpeechSmoke(asr: ASRController, shell: UIShell): Promise<void> {
  shell.render('HARDWARE SMOKE — connecting ASR')
  await asr.connect()
  if (!asr.isConnected()) return
  await streamSpeechFixture(asr, shell)
}

async function streamSilentFixture(asr: ASRController, shell: UIShell): Promise<void> {
  await asr.ensureConnected('silent-fixture')
  if (!asr.isConnected()) {
    shell.render('AUDIO STREAM FAILED — ASR not connected')
    return
  }

  const fixture = createSilentPcmS16LeFixture({ durationMs: 1000, sampleRate: 16_000 })
  try {
    await asr.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
  } catch (err) {
    logger.error('silent_fixture_stream_failed', err)
    // LiveSession already rendered a visual failure state.
  }
}

async function startBrowserMic(asr: ASRController, audio: AudioController): Promise<void> {
  await asr.ensureConnected('browser-mic')
  if (!asr.isConnected()) return
  await audio.startBrowserMic()
}

async function startG2SdkAudio(asr: ASRController, audio: AudioController): Promise<void> {
  await asr.ensureConnected('g2-sdk-audio')
  logger.stage('g2_sdk_audio_asr_ready', { connected: asr.isConnected() })
  if (!asr.isConnected()) return
  await audio.startG2SdkAudio(g2AudioBridge)
}

async function streamSpeechFixture(asr: ASRController, shell: UIShell): Promise<void> {
  await asr.ensureConnected('speech-smoke')
  if (!asr.isConnected()) {
    shell.render('AUDIO STREAM FAILED — ASR not connected')
    return
  }

  let stage: 'load' | 'stream' | 'terminate' = 'load'
  try {
    shell.render('AUDIO SPEECH FIXTURE LOADING')
    const fixture = await loadPcmS16LeFixtureFromUrl(getSpeechFixtureUrl(new URL(window.location.href)), {
      sampleRate: 16_000,
    })
    stage = 'stream'
    shell.render('AUDIO SPEECH FIXTURE STREAMING')
    await asr.streamPcmChunks(chunkPcmS16Le(fixture, { chunkMs: 100 }))
    stage = 'terminate'
    asr.terminate('SMOKE COMPLETE — captions verified')
    shell.render('AUDIO SPEECH FIXTURE SENT — finalizing ASR')
  } catch (err) {
    logger.error('speech_fixture_stream_failed', err, { stage })
    const visualStage = stage === 'load' ? 'LOAD' : stage === 'stream' ? 'STREAM' : 'FINALIZE'
    shell.render(`AUDIO SPEECH ${visualStage} FAILED — captions paused`)
  }
}

export { runFixturePrototype }
