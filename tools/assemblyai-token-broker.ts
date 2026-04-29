import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createAssemblyAiToken, readAssemblyAiApiKeyFromEnv } from '../src/asr/AssemblyAiTokenBroker'
import { getTokenBrokerBindHost, getTokenBrokerCorsOrigin, isAllowedTokenBrokerOrigin } from '../src/asr/AssemblyAiTokenBrokerServer'

const port = Number.parseInt(process.env.ASSEMBLYAI_TOKEN_BROKER_PORT ?? '8787', 10)
const host = getTokenBrokerBindHost(process.env)
const apiKey = readAssemblyAiApiKeyFromEnv(process.env)

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin
  response.setHeader('Access-Control-Allow-Origin', getTokenBrokerCorsOrigin(origin))
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
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

  if (request.method !== 'POST' || request.url !== '/assemblyai/token') {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_found' }))
    return
  }

  try {
    const token = await createAssemblyAiToken({
      apiKey,
      expiresInSeconds: 60,
      maxSessionDurationSeconds: 600,
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(token))
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'token_generation_failed' }))
  }
})

server.listen(port, host, () => {
  console.log(`AssemblyAI token broker listening on http://${host}:${port}`)
})
