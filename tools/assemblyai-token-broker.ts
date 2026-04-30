import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { createAssemblyAiToken } from '../src/asr/AssemblyAiTokenBroker'
import { getTokenBrokerBindHost, getTokenBrokerCorsOrigin, isAllowedTokenBrokerOrigin } from '../src/asr/AssemblyAiTokenBrokerServer'
import { buildDeepgramProxyHeaders, buildDeepgramProxyUpstreamUrl } from '../src/asr/DeepgramProxy'
import { createDeepgramToken, readDeepgramApiKeyFromEnv } from '../src/asr/DeepgramTokenBroker'

const REQUEST_BODY_BYTE_CAP = 10_000
// ~1 MB of pending audio ≈ 30 seconds at 16 kHz / 16-bit / mono. Beyond this
// we close the browser-side socket rather than buffer indefinitely.
const PROXY_PENDING_BUFFER_BYTE_CAP = 1_000_000

function parseBrokerPort(raw: string | undefined): number {
  const fallback = 8787
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 65536) {
    throw new Error(
      `ASSEMBLYAI_TOKEN_BROKER_PORT must be an integer in 1..65535 (got ${JSON.stringify(raw)})`,
    )
  }
  return parsed
}

const port = parseBrokerPort(process.env.ASSEMBLYAI_TOKEN_BROKER_PORT)
const host = getTokenBrokerBindHost(process.env)
const deepgramApiKey = readDeepgramApiKeyFromEnv(process.env)
const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY?.trim()
const clientLogs: unknown[] = []

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

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin
  response.setHeader('Access-Control-Allow-Origin', getTokenBrokerCorsOrigin(origin))
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Vary', 'Origin')
  response.setHeader('Cache-Control', 'no-store')

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
      const entry = await readJsonBody(request)
      clientLogs.push(entry)
      if (clientLogs.length > 200) clientLogs.shift()
      console.log('[client-log]', JSON.stringify(entry))
      response.writeHead(204)
      response.end()
    } catch {
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
    try {
      const token = await createDeepgramToken({ apiKey: deepgramApiKey, ttlSeconds: 60 })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(token))
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'token_generation_failed' }))
    }
    return
  }

  // Kept temporarily for rollback/manual comparison while the app is switched to Deepgram.
  if (request.method === 'POST' && request.url === '/assemblyai/token' && assemblyAiApiKey) {
    try {
      const token = await createAssemblyAiToken({
        apiKey: assemblyAiApiKey,
        expiresInSeconds: 60,
        maxSessionDurationSeconds: 600,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(token))
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'token_generation_failed' }))
    }
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'not_found' }))
})

const deepgramProxyServer = new WebSocketServer({ noServer: true })

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

  deepgramProxyServer.handleUpgrade(request, socket, head, (browserSocket) => {
    deepgramProxyServer.emit('connection', browserSocket, request)
  })
})

function rawDataByteLength(data: RawData): number {
  if (data instanceof ArrayBuffer) return data.byteLength
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.length, 0)
  return (data as Buffer).length
}

deepgramProxyServer.on('connection', (browserSocket, request) => {
  const upstreamUrl = buildDeepgramProxyUpstreamUrl(request.url ?? '/deepgram/listen')
  const upstreamSocket = new WebSocket(upstreamUrl, { headers: buildDeepgramProxyHeaders(deepgramApiKey) })
  const pendingBrowserMessages: Array<{ data: RawData; isBinary: boolean }> = []
  let pendingBytes = 0
  let closing = false

  const closeBoth = (code = 1000, reason = '') => {
    if (closing) return
    closing = true
    if (browserSocket.readyState === WebSocket.OPEN || browserSocket.readyState === WebSocket.CONNECTING) {
      browserSocket.close(code, reason)
    }
    if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) {
      upstreamSocket.close(code, reason)
    }
  }

  upstreamSocket.on('open', () => {
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
    if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) {
      upstreamSocket.close(code, reason)
    }
  })

  upstreamSocket.on('close', (code, reason) => {
    if (browserSocket.readyState === WebSocket.OPEN || browserSocket.readyState === WebSocket.CONNECTING) {
      browserSocket.close(code, reason)
    }
  })

  browserSocket.on('error', () => closeBoth(1011, 'Browser WebSocket error'))
  upstreamSocket.on('error', () => closeBoth(1011, 'Deepgram upstream error'))
})

server.listen(port, host, () => {
  console.log(`Deepgram token/proxy broker listening on http://${host}:${port}`)
})
