import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { createAssemblyAiToken } from '../src/asr/AssemblyAiTokenBroker'
import { getTokenBrokerBindHost, getTokenBrokerCorsOrigin, isAllowedTokenBrokerOrigin } from '../src/asr/AssemblyAiTokenBrokerServer'
import { buildDeepgramProxyHeaders, buildDeepgramProxyUpstreamUrl } from '../src/asr/DeepgramProxy'
import { createDeepgramToken, readDeepgramApiKeyFromEnv } from '../src/asr/DeepgramTokenBroker'

const port = Number.parseInt(process.env.ASSEMBLYAI_TOKEN_BROKER_PORT ?? '8787', 10)
const host = getTokenBrokerBindHost(process.env)
const deepgramApiKey = readDeepgramApiKeyFromEnv(process.env)
const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY?.trim()
const clientLogs: unknown[] = []

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 10_000) break
  }
  return body ? JSON.parse(body) : {}
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

deepgramProxyServer.on('connection', (browserSocket, request) => {
  const upstreamUrl = buildDeepgramProxyUpstreamUrl(request.url ?? '/deepgram/listen')
  const upstreamSocket = new WebSocket(upstreamUrl, { headers: buildDeepgramProxyHeaders(deepgramApiKey) })
  const pendingBrowserMessages: Array<{ data: RawData; isBinary: boolean }> = []
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
  })

  browserSocket.on('message', (data, isBinary) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.send(data, { binary: isBinary })
      return
    }
    if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      pendingBrowserMessages.push({ data, isBinary })
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
