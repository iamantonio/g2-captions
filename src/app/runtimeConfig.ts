const TOKEN_BROKER_PORT = 8787

export type AsrProvider = 'deepgram' | 'elevenlabs' | 'openai'

export interface DeepgramRealtimeTuningOptions {
  endpointing: number | boolean
  diarize: boolean
  interimResults: boolean
}

export interface ElevenLabsRealtimeTuningOptions {
  languageCode: string
  includeTimestamps: boolean
  commitStrategy: 'manual' | 'vad'
  vadSilenceThresholdSecs: number
  vadThreshold: number
  minSpeechDurationMs: number
  minSilenceDurationMs: number
  enableLogging: boolean
  manualCommitEveryChunks?: number
}

export interface OpenAiRealtimeTuningOptions {
  liveCommitEveryMs?: number
  finalTranscriptWaitMs: number
}

function resolveBrokerHost(locationUrl: URL): string {
  const host = locationUrl.hostname || '127.0.0.1'
  return host === 'localhost' ? '127.0.0.1' : host
}

/**
 * Reads a build-time-injected base URL for the deployed broker. When set,
 * overrides the LAN-derived URLs returned by the helpers below — required
 * for production .ehpk distribution where the WebView has no LAN context.
 *
 * Set via `VITE_BROKER_BASE_URL=https://<host>` at build time. Examples:
 *   VITE_BROKER_BASE_URL=https://g2-captions.fly.dev npm run build
 *   VITE_BROKER_BASE_URL=https://broker.example.com npm run build
 *
 * Unset → fall back to LAN-derived URLs (current dev-time behavior).
 */
function getBrokerBaseUrl(): URL | undefined {
  const value = import.meta.env?.VITE_BROKER_BASE_URL
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return new URL(value.trim())
  } catch {
    return undefined
  }
}

export function getDefaultTokenEndpoint(locationUrl: URL): string {
  const base = getBrokerBaseUrl()
  if (base) return new URL('/deepgram/token', base).toString()
  return `${locationUrl.protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/deepgram/token`
}

export function getElevenLabsTokenEndpoint(locationUrl: URL): string {
  const base = getBrokerBaseUrl()
  if (base) return new URL('/elevenlabs/token', base).toString()
  return `${locationUrl.protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/elevenlabs/token`
}

export function getAsrProvider(locationUrl: URL): AsrProvider {
  const provider = locationUrl.searchParams.get('asr')
  if (provider === 'elevenlabs' || provider === 'openai') return provider
  return 'deepgram'
}

export function getDeepgramRealtimeOptions(locationUrl: URL): DeepgramRealtimeTuningOptions {
  return {
    endpointing: readDeepgramEndpointingParam(locationUrl),
    diarize: readBooleanParam(locationUrl, 'dgDiarize', true),
    interimResults: readBooleanParam(locationUrl, 'dgInterim', true),
  }
}

export function getDeepgramKeyterms(locationUrl: URL): string[] {
  const value = locationUrl.searchParams.get('dgKeyterms')?.trim()
  if (value === '0') return []
  if (!value || value === '1') return ['ProvenMachine', 'Even Realities G2']
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getElevenLabsRealtimeOptions(locationUrl: URL): ElevenLabsRealtimeTuningOptions {
  return {
    languageCode: readStringParam(locationUrl, 'lang', 'en'),
    includeTimestamps: readBooleanParam(locationUrl, 'timestamps', false),
    commitStrategy: readCommitStrategyParam(locationUrl),
    vadSilenceThresholdSecs: readNumberParam(locationUrl, 'vadSilence', 0.3, 0.3, 3),
    vadThreshold: readNumberParam(locationUrl, 'vadThreshold', 0.3, 0.1, 0.9),
    minSpeechDurationMs: readIntegerParam(locationUrl, 'minSpeech', 50, 50, 2_000),
    minSilenceDurationMs: readIntegerParam(locationUrl, 'minSilence', 50, 50, 2_000),
    enableLogging: readBooleanParam(locationUrl, 'elevenLogging', false),
    manualCommitEveryChunks:
      readCommitStrategyParam(locationUrl) === 'manual' ? readManualCommitEveryChunks(locationUrl) : undefined,
  }
}

export function getOpenAiRealtimeOptions(locationUrl: URL): OpenAiRealtimeTuningOptions {
  return {
    liveCommitEveryMs: readOpenAiLiveCommitEveryMs(locationUrl),
    finalTranscriptWaitMs: readIntegerParam(locationUrl, 'openaiFinalWaitMs', 4_000, 1_000, 10_000),
  }
}

function readOpenAiLiveCommitEveryMs(locationUrl: URL): number | undefined {
  const raw = locationUrl.searchParams.get('openaiCommitMs')
  if (raw === null || raw.trim() === '' || raw.trim() === '0') return undefined
  return readIntegerParam(locationUrl, 'openaiCommitMs', 1_500, 500, 5_000)
}

function readDeepgramEndpointingParam(locationUrl: URL): number | boolean {
  const raw = locationUrl.searchParams.get('dgEndpointing')?.trim().toLowerCase()
  if (raw === 'false' || raw === '0') return false
  if (raw === 'true') return true
  return readIntegerParam(locationUrl, 'dgEndpointing', 250, 50, 2_000)
}

function readStringParam(locationUrl: URL, name: string, fallback: string): string {
  const value = locationUrl.searchParams.get(name)?.trim()
  return value ? value : fallback
}

function readCommitStrategyParam(locationUrl: URL): 'manual' | 'vad' {
  return locationUrl.searchParams.get('commit') === 'manual' ? 'manual' : 'vad'
}

export function getElevenLabsKeyterms(locationUrl: URL): string[] {
  const value = locationUrl.searchParams.get('elevenKeyterms')?.trim()
  if (value === '0') return []
  if (!value || value === '1') return ['ProvenMachine', 'Even Realities G2']
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function readBooleanParam(locationUrl: URL, name: string, fallback: boolean): boolean {
  const value = locationUrl.searchParams.get(name)
  if (value === '1') return true
  if (value === '0') return false
  return fallback
}

function readNumberParam(locationUrl: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = locationUrl.searchParams.get(name)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function readIntegerParam(locationUrl: URL, name: string, fallback: number, min: number, max: number): number {
  return Math.round(readNumberParam(locationUrl, name, fallback, min, max))
}

function readManualCommitEveryChunks(locationUrl: URL): number {
  // The G2 live source currently emits 100 ms PCM chunks. The query param is
  // intentionally interpreted as seconds, not raw chunks: committing every
  // 100-200 ms caused ElevenLabs realtime sessions to close during mic start
  // before useful captions could arrive.
  const seconds = readNumberParam(locationUrl, 'manualCommitEvery', 1, 1, 30)
  return Math.max(1, Math.round(seconds * 10))
}

export function getDefaultStreamingEndpoint(locationUrl: URL): string {
  const base = getBrokerBaseUrl()
  if (base) {
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${base.host}/deepgram/listen`
  }
  const protocol = locationUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/deepgram/listen`
}

export function getOpenAiStreamingEndpoint(locationUrl: URL): string {
  const base = getBrokerBaseUrl()
  if (base) {
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${base.host}/openai/transcribe`
  }
  const protocol = locationUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/openai/transcribe`
}

export function getClientLogEndpoint(locationUrl: URL): string {
  const base = getBrokerBaseUrl()
  if (base) return new URL('/client-log', base).toString()
  return `${locationUrl.protocol}//${resolveBrokerHost(locationUrl)}:${TOKEN_BROKER_PORT}/client-log`
}

export function getSpeechFixtureUrl(locationUrl: URL): string {
  const fixtureParam = locationUrl.searchParams.get('fixture')?.trim()
  const fixtureName = fixtureParam && /^[a-z0-9-]+\.pcm$/i.test(fixtureParam) ? fixtureParam : 'speech-smoke.pcm'
  return new URL(`fixtures/${fixtureName}`, locationUrl).toString()
}

// Auto-smoke is opt-in: it kicks off a billable Deepgram session, so the
// caller has to set ?autoSmoke=1 explicitly. The hardware-readiness QR
// generator already adds this flag for the documented hardware-smoke path
// (see src/hardware/readiness.ts).
export function shouldAutoRunHardwareSmoke(locationUrl: URL, hasEvenBridge: boolean): boolean {
  if (!hasEvenBridge) return false
  return locationUrl.searchParams.get('autoSmoke') === '1'
}

/**
 * Debug mode exposes all internal controls (fixture buttons, browser-mic,
 * raw connect, telemetry JSON panel). Default mode (no flag) shows only
 * the user-facing caption surface and a single Start/Stop action.
 *
 * Set `?debug=1` on the URL to enable. The hardware-readiness QR keeps the
 * default off so a real device install doesn't surface developer controls
 * to end users.
 */
export function isDebugMode(locationUrl: URL): boolean {
  return locationUrl.searchParams.get('debug') === '1'
}

/**
 * Reads the broker bearer token from Vite's build-time-injected env. The
 * broker reads the same VITE_BROKER_AUTH_TOKEN value at boot. Returns
 * undefined when unset — the broker accepts unauthenticated requests in that
 * mode (loopback-bound dev). Set it in .env before LAN-binding.
 */
export function getBrokerAuthToken(): string | undefined {
  // Vite replaces import.meta.env.VITE_* at build time; in non-Vite test
  // environments the property is undefined.
  const value = import.meta.env?.VITE_BROKER_AUTH_TOKEN
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
