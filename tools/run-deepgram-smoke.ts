import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { WebSocket } from 'ws'
import { chunkPcmS16Le, type PcmChunk } from '../src/audio/pcmFixture'
import {
  buildDeepgramCloseStreamMessage,
  mapDeepgramResultsToRawAsrEvent,
  type DeepgramResultsEvent,
} from '../src/asr/DeepgramStreamingClient'

interface SmokeEvent {
  atMs: number
  messageType: string
  text?: string
  status?: string
  speaker?: string
  speakers?: Record<string, number>
  error?: string
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

async function main(): Promise<void> {
  loadDotEnvIfPresent()

  const fixturePath = process.argv[2] ?? 'public/fixtures/speech-smoke.pcm'
  const url = withBrokerAuth(process.env.DEEPGRAM_SMOKE_BROKER_URL?.trim() || 'ws://127.0.0.1:8787/deepgram/listen')
  const startedAt = Date.now()
  const events: SmokeEvent[] = []
  let firstAudioSentAt: number | undefined
  let firstPartialFromFirstAudioMs: number | undefined
  let finalFromFirstAudioMs: number | undefined
  let finalText = ''
  const speakerLabels = new Set<string>()

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
      socket.close(1011, 'Deepgram smoke timeout')
      reject(new Error('Timed out waiting for Deepgram smoke result'))
    }, 40_000)

    socket.on('open', () => {
      void streamChunks(socket, chunks, (sentAt) => {
        if (firstAudioSentAt === undefined) firstAudioSentAt = sentAt
      }).catch(reject)
    })

    socket.on('message', (data) => {
      const atMs = Date.now() - startedAt
      const payload = JSON.parse(data.toString()) as DeepgramResultsEvent & {
        type?: unknown
        message?: unknown
        error?: unknown
      }
      const messageType = String(payload.type ?? 'unknown')

      if (messageType === 'Error' || payload.error || payload.message) {
        const error = String(payload.message ?? payload.error ?? JSON.stringify(payload))
        events.push({ atMs, messageType, error })
        clearTimeout(timeout)
        reject(new Error(`Deepgram realtime error: ${error}`))
        return
      }

      if (messageType !== 'Results') {
        events.push({ atMs, messageType })
        return
      }

      const transcript = String(payload.channel?.alternatives?.[0]?.transcript ?? '').trim()
      if (!transcript) return
      const mapped = mapDeepgramResultsToRawAsrEvent(payload, {
        receivedAtMs: Date.now() - startedAt,
        fallbackStartMs: Date.now() - startedAt,
      })
      if (mapped.speaker && mapped.speaker !== '?') speakerLabels.add(mapped.speaker)
      for (const word of mapped.words ?? []) {
        if (word.speaker && word.speaker !== '?') speakerLabels.add(word.speaker)
      }

      if (mapped.status === 'partial' && firstPartialFromFirstAudioMs === undefined && firstAudioSentAt !== undefined) {
        firstPartialFromFirstAudioMs = Date.now() - firstAudioSentAt
      }
      if (mapped.status === 'final') {
        finalText = mapped.text.trim()
        if (finalFromFirstAudioMs === undefined && firstAudioSentAt !== undefined) {
          finalFromFirstAudioMs = Date.now() - firstAudioSentAt
        }
        clearTimeout(timeout)
        socket.close(1000, 'Deepgram smoke complete')
      }

      events.push({
        atMs,
        messageType,
        text: mapped.text,
        status: mapped.status,
        speaker: mapped.speaker === '?' ? undefined : mapped.speaker,
        speakers: speakerCounts(mapped.words),
      })
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
    provider: 'deepgram',
    model: 'nova-3',
    brokerUrl: url.replace(/auth=[^&]+/g, 'auth=REDACTED'),
    fixture: basename(fixturePath),
    chunkCount: chunks.length,
    firstPartialFromFirstAudioMs,
    finalFromFirstAudioMs,
    finalText,
    speakerLabels: Array.from(speakerLabels),
    events,
  }
  console.log(JSON.stringify(result, null, 2))

  if (!finalText) {
    console.error('Deepgram smoke completed without a final transcript.')
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
    socket.send(chunk.data)
    await sleep(chunk.durationMs)
  }
  socket.send(buildDeepgramCloseStreamMessage())
}

function speakerCounts(words: Array<{ speaker?: string }> | undefined): Record<string, number> | undefined {
  if (!words) return undefined
  const counts: Record<string, number> = {}
  for (const word of words) {
    if (word.speaker) counts[word.speaker] = (counts[word.speaker] ?? 0) + 1
  }
  return Object.keys(counts).length ? counts : undefined
}

function withBrokerAuth(rawUrl: string): string {
  const token = process.env.VITE_BROKER_AUTH_TOKEN?.trim()
  if (!token) return rawUrl
  const url = new URL(rawUrl)
  url.searchParams.set('auth', token)
  return url.toString()
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
