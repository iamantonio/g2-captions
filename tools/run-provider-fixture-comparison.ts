import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { buildProviderComparisonReport, type ProviderSmokeResult } from '../src/benchmark/providerComparison'

const FIXTURES = [
  {
    path: 'public/fixtures/speech-smoke.pcm',
    expectedText: 'Proven machine captions are ready.',
  },
  {
    path: 'public/fixtures/custom-vocab-g2.pcm',
    expectedText: 'ProvenMachine captions are ready on G2.',
  },
  {
    path: 'public/fixtures/noisy-meeting-code.pcm',
    expectedText: 'Please repeat the meeting code slowly.',
  },
  {
    path: 'public/fixtures/two-speaker-captions.pcm',
    expectedText: 'Can you see captions? Yes, captions are visible.',
  },
] as const
const outputPath = resolve(process.argv[2] ?? 'artifacts/provider-fixture-comparison.json')

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

async function main(): Promise<void> {
  loadDotEnvIfPresent()
  const broker = await ensureBroker()
  try {
    const smokeOutputs: Array<{ expectedText: string; raw: unknown }> = []
    for (const fixture of FIXTURES) {
      for (const script of ['smoke:deepgram', 'smoke:openai', 'smoke:elevenlabs'] as const) {
        smokeOutputs.push({ expectedText: fixture.expectedText, raw: await runNpmScript(script, [fixture.path]) })
      }
    }
    const results = smokeOutputs.map((output) => toProviderSmokeResult(output.raw, output.expectedText))
    const report = buildProviderComparisonReport({
      suiteId: 'provider-fixture-comparison',
      generatedAt: new Date().toISOString(),
      results,
    })

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    console.log(`Provider fixture comparison written: ${outputPath}`)
    console.log(
      JSON.stringify(
        {
          suiteId: report.suiteId,
          audioSource: report.audioSource,
          safety: report.safety,
          fixtureCount: report.aggregate.fixtureCount,
          resultCount: report.aggregate.resultCount,
          aggregate: report.aggregate.byProvider,
          providers: report.providers.map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            fixture: entry.fixture,
            finalText: entry.finalText,
            exactMatch: entry.score.exactMatch,
            wordErrorRateLite: entry.score.wordErrorRateLite,
            firstPartialFromFirstAudioMs: entry.firstPartialFromFirstAudioMs,
            finalFromFirstAudioMs: entry.finalFromFirstAudioMs,
            hasSpeakerLabels: entry.score.hasSpeakerLabels,
            notes: entry.notes,
          })),
          ranking: report.ranking,
        },
        null,
        2,
      ),
    )
  } finally {
    if (broker.startedByThisScript) broker.process?.kill('SIGTERM')
  }
}

async function ensureBroker(): Promise<{ startedByThisScript: boolean; process?: ReturnType<typeof spawn> }> {
  if (await brokerIsHealthy()) return { startedByThisScript: false }

  const child = spawn('npm', ['run', 'token-broker'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  child.stdout?.on('data', () => undefined)

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await brokerIsHealthy()) return { startedByThisScript: true, process: child }
    await sleep(250)
  }

  child.kill('SIGTERM')
  throw new Error(`Token broker did not become healthy. ${stderr.trim()}`)
}

async function brokerIsHealthy(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:8787/healthz')
    return response.ok
  } catch {
    return false
  }
}

function runNpmScript(script: string, args: string[] = []): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'npm',
      ['run', script, '--', ...args],
      { cwd: process.cwd(), env: process.env, timeout: 90_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${script} failed: ${stderr || stdout || error.message}`))
          return
        }
        try {
          resolvePromise(JSON.parse(extractLastJsonObject(stdout)))
        } catch (parseErr) {
          reject(
            new Error(
              `${script} produced unparsable JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            ),
          )
        }
      },
    )
  })
}

function toProviderSmokeResult(raw: unknown, expectedText: string): ProviderSmokeResult {
  const payload = raw as {
    provider?: unknown
    model?: unknown
    fixture?: unknown
    finalText?: unknown
    firstPartialFromFirstAudioMs?: unknown
    finalFromFirstAudioMs?: unknown
    firstCommittedFromFirstAudioMs?: unknown
    speakerLabels?: unknown
    events?: Array<{ speaker?: unknown; speakers?: Record<string, number> }>
  }
  const provider = String(payload.provider ?? '')
  if (provider !== 'deepgram' && provider !== 'openai' && provider !== 'elevenlabs') {
    throw new Error(`Unsupported provider smoke result: ${provider}`)
  }
  return {
    provider,
    model: String(payload.model ?? 'unknown'),
    fixture: String(payload.fixture ?? 'unknown'),
    expectedText,
    finalText: String(payload.finalText ?? ''),
    firstPartialFromFirstAudioMs: optionalNumber(payload.firstPartialFromFirstAudioMs),
    finalFromFirstAudioMs: optionalNumber(payload.finalFromFirstAudioMs ?? payload.firstCommittedFromFirstAudioMs),
    speakerLabels: extractSpeakerLabels(payload),
  }
}

function extractSpeakerLabels(payload: {
  speakerLabels?: unknown
  events?: Array<{ speaker?: unknown; speakers?: Record<string, number> }>
}): string[] {
  const labels = new Set<string>()
  if (Array.isArray(payload.speakerLabels)) {
    for (const label of payload.speakerLabels) if (typeof label === 'string' && label.trim()) labels.add(label)
  }
  for (const event of payload.events ?? []) {
    if (typeof event.speaker === 'string' && event.speaker.trim()) labels.add(event.speaker)
    for (const label of Object.keys(event.speakers ?? {})) labels.add(label)
  }
  return Array.from(labels)
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function extractLastJsonObject(stdout: string): string {
  const start = stdout.lastIndexOf('\n{')
  const json = start >= 0 ? stdout.slice(start + 1) : stdout.slice(stdout.indexOf('{'))
  if (!json.trim().startsWith('{')) throw new Error('no JSON object found')
  return json.trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function loadDotEnvIfPresent(): void {
  if (!existsSync('.env')) return
  const lines = readFileSync('.env', 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}
