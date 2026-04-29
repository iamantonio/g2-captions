import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { chunkPcmS16Le, createSilentPcmS16LeFixture, loadPcmS16LeFixtureFromUrl } from '../audio/pcmFixture'
import { AssemblyAiLiveSession } from '../asr/AssemblyAiLiveSession'
import { CaptionState } from '../captions/CaptionState'
import { formatCaptionFrame } from '../captions/formatter'
import { G2LensDisplay } from '../display/g2LensDisplay'
import type { RawAsrEvent } from '../types'
import { runFixturePrototype } from './runFixturePrototype'
import { getDefaultTokenEndpoint, getSpeechFixtureUrl, shouldAutoRunHardwareSmoke } from './runtimeConfig'

const app = document.querySelector<HTMLElement>('#app')
const state = new CaptionState()
let session: AssemblyAiLiveSession | undefined
let g2Display: G2LensDisplay | undefined
let lastFrameText = ''

if (app) {
  renderShell('READY — token broker required')
  void initializeG2Display()
}

async function initializeG2Display(): Promise<void> {
  try {
    const bridge = await waitForEvenAppBridge()
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

  const stop = document.createElement('button')
  stop.textContent = 'Terminate'
  stop.addEventListener('click', () => {
    session?.terminate()
    session = undefined
    renderShell('ASR TERMINATED')
  })
  app.append(stop)
}

async function runHardwareSpeechSmoke(): Promise<void> {
  renderShell('HARDWARE SMOKE — connecting ASR')
  await connectAssemblyAi()
  if (!session) return
  await streamSpeechFixture()
}

async function connectAssemblyAi(): Promise<void> {
  state.clear()
  session?.terminate()
  session = new AssemblyAiLiveSession({
    tokenEndpoint: getDefaultTokenEndpoint(new URL(window.location.href)),
    keyterms: ['ProvenMachine'],
    onTranscript: (event: RawAsrEvent) => {
      state.applyAsrEvent(event)
      renderShell('ASR CONNECTED — waiting audio')
    },
    onVisualStatus: renderShell,
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
