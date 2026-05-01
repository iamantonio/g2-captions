import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { ServerLogger } from '../observability/serverLogger'
import { createAssemblyAiToken } from './AssemblyAiTokenBroker'
import { getTokenBrokerCorsOrigin, isAllowedTokenBrokerOrigin } from './tokenBrokerServer'
import { buildDeepgramProxyHeaders } from './DeepgramProxy'
import { buildDeepgramStreamingUrl, type DeepgramStreamingUrlOptions } from './DeepgramStreamingClient'
import { createDeepgramToken } from './DeepgramTokenBroker'

const REQUEST_BODY_BYTE_CAP = 10_000
// ~1 MB ≈ 30 seconds of 16 kHz / 16-bit / mono audio. Beyond this we close the
// browser-side socket rather than buffer indefinitely.
const PROXY_PENDING_BUFFER_BYTE_CAP = 1_000_000

export interface RateLimiter {
  consume(key: string): Promise<void>
}

export interface TokenBrokerDeps {
  logger: ServerLogger
  deepgramApiKey: string
  assemblyAiApiKey?: string
  /**
   * Server-controlled Deepgram streaming parameters. The broker — not the
   * client — is the sole authority on which model/feature combination gets
   * billed. The client-side WebSocket query string is ignored.
   */
  deepgramStreamingOptions?: DeepgramStreamingUrlOptions
  rateLimiter?: RateLimiter
  /**
   * Maximum number of in-memory client-log entries to retain (newer evicts
   * older). Default 200.
   */
  clientLogRetention?: number
  /**
   * Project version, surfaced via /healthz for hardware-smoke probes.
   */
  version?: string
}

export interface TokenBrokerHandle {
  server: Server
  /**
   * Closes all WS proxy connections and the HTTP server. Resolves once
   * everything is drained or the optional timeout elapses.
   */
  shutdown(timeoutMs?: number): Promise<void>
}

interface ClientLogPayload {
  level?: unknown
  stage: unknown
  details?: unknown
  href?: unknown
  at?: unknown
}

const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal'])
const CLIENT_LOG_DETAILS_BYTE_CAP = 4_000

function validateClientLog(
  payload: unknown,
): { ok: true; entry: Record<string, unknown> } | { ok: false; reason: string } {
  if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'payload_not_object' }
  const candidate = payload as ClientLogPayload
  if (typeof candidate.stage !== 'string' || !candidate.stage.trim()) {
    return { ok: false, reason: 'stage_required' }
  }
  const level = typeof candidate.level === 'string' && ALLOWED_LEVELS.has(candidate.level) ? candidate.level : 'info'
  let details: unknown = candidate.details
  if (details !== undefined) {
    const json = JSON.stringify(details)
    if (json.length > CLIENT_LOG_DETAILS_BYTE_CAP) {
      details = { _truncated: true, byteLength: json.length, preview: json.slice(0, 200) }
    }
  }
  return {
    ok: true,
    entry: {
      level,
      stage: candidate.stage,
      ...(details === undefined ? {} : { details }),
      ...(typeof candidate.href === 'string' ? { href: candidate.href } : {}),
      at: typeof candidate.at === 'string' ? candidate.at : new Date().toISOString(),
    },
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalLength = 0
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    chunks.push(buf)
    totalLength += buf.length
    if (totalLength > REQUEST_BODY_BYTE_CAP) break
  }
  if (totalLength === 0) return {}
  const body = Buffer.concat(chunks, Math.min(totalLength, REQUEST_BODY_BYTE_CAP)).toString('utf8')
  return JSON.parse(body)
}

function clientKey(request: IncomingMessage): string {
  const fwd = request.headers['x-forwarded-for']
  const fromHeader = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined
  return fromHeader || request.socket.remoteAddress || 'unknown'
}

function rawDataByteLength(data: RawData): number {
  if (data instanceof ArrayBuffer) return data.byteLength
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.length, 0)
  return (data as Buffer).length
}

export function createTokenBrokerServer(deps: TokenBrokerDeps): TokenBrokerHandle {
  const { logger, deepgramApiKey, assemblyAiApiKey, rateLimiter } = deps
  const retention = deps.clientLogRetention ?? 200
  const version = deps.version ?? 'unknown'
  const clientLogs: unknown[] = []
  const activeProxyPairs = new Set<{ browser: WebSocket; upstream: WebSocket }>()

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const origin = request.headers.origin
    response.setHeader('Access-Control-Allow-Origin', getTokenBrokerCorsOrigin(origin))
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Cache-Control', 'no-store')

    // /healthz is intentionally exempt from origin gating so external probes
    // (curl, hardware-readiness script) can check liveness without faking a
    // browser Origin header.
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, version }))
      return
    }

    if (!isAllowedTokenBrokerOrigin(origin)) {
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'origin_not_allowed' }))
      return
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'POST' && request.url === '/client-log') {
      try {
        const payload = await readJsonBody(request)
        const validated = validateClientLog(payload)
        if (!validated.ok) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: validated.reason }))
          return
        }
        clientLogs.push(validated.entry)
        if (clientLogs.length > retention) clientLogs.shift()
        logger.info({ source: 'client', ...validated.entry }, 'client_log')
        response.writeHead(204)
        response.end()
      } catch (err) {
        logger.warn({ err }, 'client_log_parse_failed')
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'invalid_client_log' }))
      }
      return
    }

    if (request.method === 'GET' && request.url === '/client-logs') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ logs: clientLogs }))
      return
    }

    if (request.method === 'POST' && request.url === '/deepgram/token') {
      if (rateLimiter) {
        try {
          await rateLimiter.consume(clientKey(request))
        } catch {
          response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
          response.end(JSON.stringify({ error: 'rate_limited' }))
          return
        }
      }
      try {
        const token = await createDeepgramToken({ apiKey: deepgramApiKey, ttlSeconds: 60 })
        logger.info({ ttlSeconds: token.expiresInSeconds }, 'deepgram_token_minted')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(token))
      } catch (err) {
        logger.error({ err }, 'deepgram_token_failed')
        response.writeHead(502, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'token_generation_failed' }))
      }
      return
    }

    // Kept temporarily for rollback/manual comparison while the app is switched to Deepgram.
    if (request.method === 'POST' && request.url === '/assemblyai/token' && assemblyAiApiKey) {
      if (rateLimiter) {
        try {
          await rateLimiter.consume(clientKey(request))
        } catch {
          response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
          response.end(JSON.stringify({ error: 'rate_limited' }))
          return
        }
      }
      try {
        const token = await createAssemblyAiToken({
          apiKey: assemblyAiApiKey,
          expiresInSeconds: 60,
          maxSessionDurationSeconds: 600,
        })
        logger.info({ expiresInSeconds: token.expiresInSeconds }, 'assemblyai_token_minted')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(token))
      } catch (err) {
        logger.error({ err }, 'assemblyai_token_failed')
        response.writeHead(502, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'token_generation_failed' }))
      }
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_found' }))
  })

  const proxyServer = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin
    const pathname = new URL(request.url ?? '/', 'ws://localhost').pathname

    if (pathname !== '/deepgram/listen') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    if (!isAllowedTokenBrokerOrigin(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    proxyServer.handleUpgrade(request, socket, head, (browserSocket) => {
      proxyServer.emit('connection', browserSocket, request)
    })
  })

  proxyServer.on('connection', (browserSocket: WebSocket) => {
    // Server-controlled streaming parameters — fix #36. The browser's WS query
    // string is ignored; whatever the broker config says, that's what gets
    // billed.
    const upstreamUrl = buildDeepgramStreamingUrl(deps.deepgramStreamingOptions)
    const upstreamSocket = new WebSocket(upstreamUrl, { headers: buildDeepgramProxyHeaders(deepgramApiKey) })
    const pair = { browser: browserSocket, upstream: upstreamSocket }
    activeProxyPairs.add(pair)
    const pendingBrowserMessages: Array<{ data: RawData; isBinary: boolean }> = []
    let pendingBytes = 0
    let closing = false

    const closeBoth = (code = 1000, reason = '') => {
      if (closing) return
      closing = true
      activeProxyPairs.delete(pair)
      if (browserSocket.readyState === WebSocket.OPEN || browserSocket.readyState === WebSocket.CONNECTING) {
        browserSocket.close(code, reason)
      }
      if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) {
        upstreamSocket.close(code, reason)
      }
    }

    upstreamSocket.on('open', () => {
      logger.info({ pendingFrames: pendingBrowserMessages.length, pendingBytes }, 'proxy_upstream_open')
      for (const message of pendingBrowserMessages.splice(0)) {
        upstreamSocket.send(message.data, { binary: message.isBinary })
      }
      pendingBytes = 0
    })

    browserSocket.on('message', (data, isBinary) => {
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(data, { binary: isBinary })
        return
      }
      if (upstreamSocket.readyState === WebSocket.CONNECTING) {
        const dataLen = rawDataByteLength(data)
        if (pendingBytes + dataLen > PROXY_PENDING_BUFFER_BYTE_CAP) {
          logger.warn({ pendingBytes, dataLen }, 'proxy_pending_buffer_overflow')
          closeBoth(1011, 'Deepgram upstream too slow')
          return
        }
        pendingBrowserMessages.push({ data, isBinary })
        pendingBytes += dataLen
        return
      }
      browserSocket.close(1011, 'Deepgram upstream unavailable')
    })

    upstreamSocket.on('message', (data, isBinary) => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data, { binary: isBinary })
    })

    browserSocket.on('close', (code, reason) => {
      activeProxyPairs.delete(pair)
      if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) {
        upstreamSocket.close(code, reason)
      }
    })

    upstreamSocket.on('close', (code, reason) => {
      activeProxyPairs.delete(pair)
      if (browserSocket.readyState === WebSocket.OPEN || browserSocket.readyState === WebSocket.CONNECTING) {
        browserSocket.close(code, reason)
      }
    })

    browserSocket.on('error', (err) => {
      logger.warn({ err }, 'proxy_browser_socket_error')
      closeBoth(1011, 'Browser WebSocket error')
    })
    upstreamSocket.on('error', (err) => {
      logger.warn({ err }, 'proxy_upstream_socket_error')
      closeBoth(1011, 'Deepgram upstream error')
    })
  })

  async function shutdown(timeoutMs = 5_000): Promise<void> {
    logger.info({ activeProxyPairs: activeProxyPairs.size }, 'broker_shutdown_start')
    for (const pair of activeProxyPairs) {
      if (pair.browser.readyState === WebSocket.OPEN) pair.browser.close(1001, 'shutting down')
      if (pair.upstream.readyState === WebSocket.OPEN) pair.upstream.close(1001, 'shutting down')
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ timeoutMs }, 'broker_shutdown_timeout')
        resolve()
      }, timeoutMs)
      server.close(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    logger.info('broker_shutdown_done')
  }

  return { server, shutdown }
}
