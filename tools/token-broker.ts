import { RateLimiterMemory } from 'rate-limiter-flexible'
import { createServerLogger } from '../src/observability/serverLogger'
import { createTokenBrokerServer } from '../src/asr/createTokenBrokerServer'
import { getTokenBrokerBindHost } from '../src/asr/tokenBrokerServer'
import { readDeepgramApiKeyFromEnv } from '../src/asr/DeepgramTokenBroker'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const logger = createServerLogger('token-broker')

function parseBrokerPort(raw: string | undefined, sourceName: string): number {
  const fallback = 8787
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 65536) {
    throw new Error(`${sourceName} must be an integer in 1..65535 (got ${JSON.stringify(raw)})`)
  }
  return parsed
}

if (process.env.ASSEMBLYAI_TOKEN_BROKER_PORT && !process.env.TOKEN_BROKER_PORT) {
  logger.warn('ASSEMBLYAI_TOKEN_BROKER_PORT is deprecated. Use TOKEN_BROKER_PORT in .env instead.')
}
const port = parseBrokerPort(
  process.env.TOKEN_BROKER_PORT ?? process.env.ASSEMBLYAI_TOKEN_BROKER_PORT,
  process.env.TOKEN_BROKER_PORT ? 'TOKEN_BROKER_PORT' : 'ASSEMBLYAI_TOKEN_BROKER_PORT',
)
const host = getTokenBrokerBindHost(process.env)
const deepgramApiKey = readDeepgramApiKeyFromEnv(process.env)
const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY?.trim()

// 10 token mints per IP per minute. Generous enough that a developer-driven
// dev session never trips it; tight enough that a misbehaving caller can't
// drain the vendor budget.
const rateLimiter = new RateLimiterMemory({ points: 10, duration: 60 })

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const { server, shutdown } = createTokenBrokerServer({
  logger,
  deepgramApiKey,
  assemblyAiApiKey,
  rateLimiter: { consume: (key) => rateLimiter.consume(key).then(() => undefined) },
  version: readVersion(),
})

server.listen(port, host, () => {
  logger.info({ host, port }, 'broker_listening')
})

let shuttingDown = false
async function gracefulExit(signal: string, exitCode: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'broker_signal_received')
  await shutdown(5_000)
  process.exit(exitCode)
}

process.on('SIGINT', () => void gracefulExit('SIGINT', 0))
process.on('SIGTERM', () => void gracefulExit('SIGTERM', 0))
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught_exception')
  void gracefulExit('uncaughtException', 1)
})
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled_rejection')
  void gracefulExit('unhandledRejection', 1)
})
