import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { BrowserMicrophonePcmSource } from '../audio/browserMicrophone'
import { G2SdkAudioSource, type G2AudioBridge } from '../audio/g2SdkAudio'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { DeepgramLiveSession } from '../asr/DeepgramLiveSession'
import { ElevenLabsLiveSession } from '../asr/ElevenLabsLiveSession'
import { OpenAiLiveSession } from '../asr/OpenAiLiveSession'
import { DEFAULT_HARDWARE_BENCHMARK_PHRASES, isHardwareBenchmarkMode } from '../benchmark/hardwareBenchmark'
import { CaptionState } from '../captions/CaptionState'
import { G2LensDisplay } from '../display/g2LensDisplay'
import { createClientLogger } from '../observability/clientLogger'
import { ASRController } from './ASRController'
import { AudioController } from './AudioController'
import { GestureController, type GestureBridge } from './GestureController'
import { runFixturePrototype } from './runFixturePrototype'
import {
  getAsrProvider,
  getBrokerAuthToken,
  getClientLogEndpoint,
  getDeepgramKeyterms,
  getDeepgramRealtimeOptions,
  getDefaultStreamingEndpoint,
  getDefaultTokenEndpoint,
  getElevenLabsRealtimeOptions,
  getElevenLabsKeyterms,
  getElevenLabsTokenEndpoint,
  getOpenAiRealtimeOptions,
  getOpenAiStreamingEndpoint,
  getSpeechFixtureUrl,
  isDebugMode,
  shouldAutoRunHardwareSmoke,
} from './runtimeConfig'
import { TelemetryReporter } from './TelemetryReporter'
import { UIShell } from './UIShell'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
const locationUrl = new URL(window.location.href)
const asrProvider = getAsrProvider(locationUrl)
const hardwareBenchmarkPhrases = isHardwareBenchmarkMode(locationUrl) ? DEFAULT_HARDWARE_BENCHMARK_PHRASES : undefined
const logger = createClientLogger({
  endpoint: getClientLogEndpoint(locationUrl),
  href: window.location.href,
  brokerAuthToken: getBrokerAuthToken(),
})
const telemetry = new TelemetryReporter({ provider: asrProvider })
let g2AudioBridge: G2AudioBridge | undefined

if (app) {
  logger.stage('app_boot', { href: window.location.href })

  const asr = new ASRController({
    state,
    telemetry,
    logger,
    sessionFactory: (deps) => {
      if (asrProvider === 'elevenlabs') {
        return new ElevenLabsLiveSession({
          tokenEndpoint: getElevenLabsTokenEndpoint(locationUrl),
          brokerAuthToken: getBrokerAuthToken(),
          keyterms: getElevenLabsKeyterms(locationUrl),
          realtimeOptions: getElevenLabsRealtimeOptions(locationUrl),
          manualCommitEveryChunks: getElevenLabsRealtimeOptions(locationUrl).manualCommitEveryChunks,
          ...deps,
        })
      }
      if (asrProvider === 'openai') {
        return new OpenAiLiveSession({
          streamingEndpoint: getOpenAiStreamingEndpoint(locationUrl),
          brokerAuthToken: getBrokerAuthToken(),
          language: 'en',
          ...getOpenAiRealtimeOptions(locationUrl),
          ...deps,
        })
      }
      return new DeepgramLiveSession({
        tokenEndpoint: getDefaultTokenEndpoint(locationUrl),
        streamingEndpoint: getDefaultStreamingEndpoint(locationUrl),
        brokerAuthToken: getBrokerAuthToken(),
        keyterms: getDeepgramKeyterms(locationUrl),
        streamingOptions: getDeepgramRealtimeOptions(locationUrl),
        ...deps,
      })
    },
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
    getTelemetryReport: () => telemetry.report(),
    hardwareBenchmarkPhrases,
  })

  const shell = new UIShell({
    root: app,
    state,
    telemetry,
    logger,
    debug: isDebugMode(locationUrl),
    hardwareBenchmarkPhrases,
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
      onPauseCaptions: () => void audio.stop('CAPTIONS PAUSED — double-tap ring to resume'),
      onResumeCaptions: () => void startG2SdkAudio(asr, audio),
    },
  })

  shell.render('READY — starting caption check')
  void initializeG2Display(shell, asr, audio)
}

async function initializeG2Display(shell: UIShell, asr: ASRController, audio: AudioController): Promise<void> {
  try {
    logger.stage('bridge_wait_start')
    const bridge = await waitForEvenAppBridge()
    logger.stage('bridge_ready')
    g2AudioBridge = bridge as unknown as G2AudioBridge
    shell.attachG2Display(new G2LensDisplay(bridge))
    await shell.renderLens(shell.getLastFrameText())

    // Wire ring + temple gestures.
    //
    // Hardware-verified behavior (2026-05-01 broker logs, /docs/13):
    // - Single-tap on the ring is RESERVED BY THE EVEN REALITIES OS for
    //   menu back-navigation. It never reaches the WebView and we cannot
    //   bind to it.
    // - Double-tap arrives as sysEvent eventType:3 with eventSource:ring.
    //   This is the only "press" gesture available to third-party apps.
    // - Scroll up / scroll down arrive as textEvent on the focused
    //   capture-target (our caption container), eventType:1 / 2. These
    //   are routed through to onScrollUp / onScrollDown handlers but no-
    //   op in Phase 1 (Phase 2 will use them for caption-history
    //   scrollback).
    //
    // So double-tap is the ONLY tap gesture, which makes it the
    // context-aware primary action: live → pause, paused → resume,
    // idle/stopped → start. End-session stays on the on-screen
    // "End session" link — no gesture for it (rare action, the on-
    // screen affordance is fine).
    new GestureController({
      bridge: bridge as unknown as GestureBridge,
      logger,
      onSingleTap: () => {
        // OS-reserved on G2. We log the call so we can detect SDK
        // changes (e.g., a future firmware that lets apps bind single-
        // tap) — at that point this handler can be wired up.
        logger.stage('gesture_single_tap_unbound')
      },
      onDoubleTap: () => handleGesturePrimaryAction(asr, audio, shell),
    })

    if (shouldAutoRunHardwareSmoke(new URL(window.location.href), true)) {
      logger.stage('auto_smoke_start')
      void runHardwareSpeechSmoke(asr, shell)
    }
  } catch (err) {
    logger.error('bridge_init_failed', err)
    // Browser/local preview path. Keep every state visible in the phone shell.
  }
}

/**
 * Double-tap is the only tap gesture available to apps on G2 (single-
 * tap is OS-reserved for back-nav). It now opens an end-session
 * confirmation overlay; a second double-tap within the confirm window
 * actually terminates the session. From idle/stopped it just starts
 * captions (no destructive action to confirm).
 *
 * Pause / resume stays on the on-screen primary button (no gesture
 * for it now that double-tap is bound to the confirm flow). Phase 2
 * may map a scroll gesture to pause/resume.
 */
const END_CONFIRM_TIMEOUT_MS = 4000
let endConfirmTimer: ReturnType<typeof setTimeout> | undefined

function clearEndConfirmTimer(): void {
  if (endConfirmTimer !== undefined) {
    clearTimeout(endConfirmTimer)
    endConfirmTimer = undefined
  }
}

function handleGesturePrimaryAction(asr: ASRController, audio: AudioController, shell: UIShell): void {
  // If a confirmation is already showing, the second double-tap commits
  // the destructive action — terminate the session.
  if (shell.isEndConfirmationVisible()) {
    logger.stage('gesture_end_session_confirmed')
    clearEndConfirmTimer()
    shell.setEndConfirmation(false)
    asr.terminate('ASR TERMINATED')
    void audio.stop('ASR TERMINATED')
    shell.render('ASR TERMINATED')
    return
  }

  switch (shell.getLifecycle()) {
    case 'live':
    case 'paused': {
      // First double-tap during a live or paused session: open the
      // confirmation dialog. Auto-dismiss in END_CONFIRM_TIMEOUT_MS.
      logger.stage('gesture_end_session_prompted')
      shell.setEndConfirmation(true)
      clearEndConfirmTimer()
      endConfirmTimer = setTimeout(() => {
        logger.stage('gesture_end_session_timeout')
        endConfirmTimer = undefined
        shell.setEndConfirmation(false)
      }, END_CONFIRM_TIMEOUT_MS)
      return
    }
    case 'idle':
    case 'stopped':
      // Nothing destructive to confirm yet — just start captions.
      void startG2SdkAudio(asr, audio)
      return
    case 'connecting':
    default:
      // Ignore double-taps while the connection is in flight — accidental
      // taps shouldn't double-trigger or queue actions.
      return
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
