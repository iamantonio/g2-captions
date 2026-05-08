import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { WebSocket } from 'ws'
import { chunkPcmS16Le, type PcmChunk } from '../src/audio/pcmFixture'
import { OpenAiSmokeCompletionTracker } from './openaiSmokeCompletion'
import {
  buildOpenAiCommitMessage,
  buildOpenAiInputAudioAppendMessage,
  buildOpenAiSessionUpdateMessage,
  mapOpenAiRealtimeMessageToRawAsrEvent,
  type OpenAiRealtimeEvent,
} from '../src/asr/OpenAiRealtimeClient'

interface SmokeEvent {
  atMs: number
  messageType: string
  text?: string
  status?: string
  error?: string
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

async function main(): Promise<void> {
  loadDotEnvIfPresent()

  const fixturePath = process.argv[2] ?? 'public/fixtures/speech-smoke.pcm'
  const url = process.env.OPENAI_SMOKE_BROKER_URL?.trim() || 'ws://127.0.0.1:8787/openai/transcribe'
  const startedAt = Date.now()
  const events: SmokeEvent[] = []
  let firstAudioSentAt: number | undefined
  let firstPartialFromFirstAudioMs: number | undefined
  let finalFromFirstAudioMs: number | undefined
  const completionTracker = new OpenAiSmokeCompletionTracker()

  const fixture = await readFile(fixturePath)
  const chunks = chunkPcmS16Le(
    {
      data: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      sampleRate: 16_000,
      encoding: 'pcm_s16le',
    },
    { chunkMs: 100 },
  )

  const socket = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close(1011, 'OpenAI smoke timeout')
      reject(new Error('Timed out waiting for OpenAI realtime smoke result'))
    }, 40_000)

    socket.on('open', () => {
      socket.send(buildOpenAiSessionUpdateMessage({ language: 'en' }))
      void streamChunks(socket, chunks, (sentAt) => {
        if (firstAudioSentAt === undefined) firstAudioSentAt = sentAt
      })
        .then(() => {
          completionTracker.markFixtureStreamingComplete()
          setTimeout(
            () => {
              completionTracker.markPostStreamWaitComplete()
              if (completionTracker.shouldCloseSocket()) {
                clearTimeout(timeout)
                socket.close(1000, 'OpenAI smoke complete')
              }
            },
            Number(process.env.OPENAI_SMOKE_POST_STREAM_WAIT_MS ?? 4_000),
          )
          if (completionTracker.shouldCloseSocket()) {
            clearTimeout(timeout)
            socket.close(1000, 'OpenAI smoke complete')
          }
        })
        .catch(reject)
    })

    socket.on('message', (data) => {
      const payload = JSON.parse(data.toString()) as OpenAiRealtimeEvent & { error?: { message?: string } }
      const messageType = String(payload.type ?? 'unknown')
      const atMs = Date.now() - startedAt

      if (messageType === 'error') {
        const error = String(payload.error?.message ?? JSON.stringify(payload.error ?? payload))
        events.push({ atMs, messageType, error })
        clearTimeout(timeout)
        reject(new Error(`OpenAI realtime error: ${error}`))
        return
      }

      const mapped = mapOpenAiRealtimeMessageToRawAsrEvent(payload, {
        receivedAtMs: Date.now() - startedAt,
        fallbackStartMs: Date.now() - startedAt,
      })

      if (mapped) {
        if (
          mapped.status === 'partial' &&
          firstPartialFromFirstAudioMs === undefined &&
          firstAudioSentAt !== undefined
        ) {
          firstPartialFromFirstAudioMs = Date.now() - firstAudioSentAt
        }
        if (mapped.status === 'final') {
          completionTracker.markFinalTranscript(mapped.text)
          if (finalFromFirstAudioMs === undefined && firstAudioSentAt !== undefined) {
            finalFromFirstAudioMs = Date.now() - firstAudioSentAt
          }
          if (completionTracker.shouldCloseSocket()) {
            clearTimeout(timeout)
            socket.close(1000, 'OpenAI smoke complete')
          }
        }
        events.push({ atMs, messageType, text: mapped.text, status: mapped.status })
        return
      }

      events.push({ atMs, messageType })
    })

    socket.on('close', () => {
      clearTimeout(timeout)
      resolve()
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  const result = {
    provider: 'openai',
    model: 'gpt-realtime-whisper',
    brokerUrl: url.replace(/auth=[^&]+/g, 'auth=REDACTED'),
    fixture: basename(fixturePath),
    chunkCount: chunks.length,
    firstPartialFromFirstAudioMs,
    finalFromFirstAudioMs,
    finalText: completionTracker.finalText,
    finalTranscriptCount: completionTracker.finalTranscriptCount,
    events,
  }
  console.log(JSON.stringify(result, null, 2))

  if (!completionTracker.finalText) {
    console.error('OpenAI smoke completed without a final transcript.')
    process.exit(3)
  }
}

async function streamChunks(
  socket: WebSocket,
  chunksToStream: PcmChunk[],
  onFirstAudioSent: (sentAt: number) => void,
): Promise<void> {
  for (const chunk of chunksToStream) {
    if (chunk.seq === 1) onFirstAudioSent(Date.now())
    socket.send(buildOpenAiInputAudioAppendMessage(chunk.data))
    await sleep(chunk.durationMs)
  }
  socket.send(buildOpenAiCommitMessage())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
