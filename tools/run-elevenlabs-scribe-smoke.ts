import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { WebSocket } from 'ws'
import { chunkPcmS16Le, type PcmChunk } from '../src/audio/pcmFixture'
import {
  buildElevenLabsInputAudioChunkMessage,
  buildElevenLabsRealtimeUrl,
  isElevenLabsErrorMessage,
  mapElevenLabsRealtimeMessageToRawAsrEvent,
  type ElevenLabsRealtimeMessage,
} from '../src/asr/ElevenLabsStreamingClient'

interface SmokeEvent {
  atMs: number
  messageType: string
  text?: string
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
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()

  if (!apiKey) {
    console.error(
      'ELEVENLABS_API_KEY is missing. Add it to .env or export it before running this Scribe v2 smoke test.',
    )
    process.exit(2)
  }

  const startedAt = Date.now()
  const events: SmokeEvent[] = []
  let firstPartialFromFirstAudioMs: number | undefined
  let firstCommittedFromFirstAudioMs: number | undefined
  let firstAudioSentAt: number | undefined
  let finalText = ''

  const fixture = await readFile(fixturePath)
  const chunks = chunkPcmS16Le(
    {
      data: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      sampleRate: 16_000,
      encoding: 'pcm_s16le',
    },
    { chunkMs: 100 },
  )

  const url = buildElevenLabsRealtimeUrl({
    modelId: 'scribe_v2_realtime',
    audioFormat: 'pcm_16000',
    includeTimestamps: true,
    includeLanguageDetection: true,
    commitStrategy: 'vad',
    keyterms: ['ProvenMachine', 'Even Realities G2'],
    languageCode: 'en',
  })

  const socket = new WebSocket(url, { headers: { 'xi-api-key': apiKey } })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close(1011, 'Scribe smoke timeout')
      reject(new Error('Timed out waiting for ElevenLabs Scribe v2 smoke result'))
    }, 30_000)

    socket.on('open', () => {
      void streamChunks(socket, chunks, (sentAt) => {
        if (firstAudioSentAt === undefined) firstAudioSentAt = sentAt
      }).catch(reject)
    })

    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ElevenLabsRealtimeMessage
      const messageType = String(message.message_type ?? 'unknown')
      const atMs = Date.now() - startedAt

      if (isElevenLabsErrorMessage(message)) {
        events.push({ atMs, messageType, error: String(message.error ?? '') })
        clearTimeout(timeout)
        reject(new Error(`ElevenLabs ${messageType}: ${String(message.error ?? '')}`))
        return
      }

      if (
        messageType === 'partial_transcript' ||
        messageType === 'committed_transcript' ||
        messageType === 'committed_transcript_with_timestamps'
      ) {
        const mapped = mapElevenLabsRealtimeMessageToRawAsrEvent(message, {
          receivedAtMs: Date.now() - startedAt,
          fallbackStartMs: Date.now() - startedAt,
        })
        if (
          mapped.status === 'partial' &&
          firstPartialFromFirstAudioMs === undefined &&
          firstAudioSentAt !== undefined
        ) {
          firstPartialFromFirstAudioMs = Date.now() - firstAudioSentAt
        }
        if (mapped.status === 'final') {
          if (messageType === 'committed_transcript_with_timestamps' || !finalText) {
            finalText = mapped.text.trim()
          }
          if (firstCommittedFromFirstAudioMs === undefined && firstAudioSentAt !== undefined) {
            firstCommittedFromFirstAudioMs = Date.now() - firstAudioSentAt
          }
        }
        events.push({
          atMs,
          messageType,
          text: mapped.text,
          speaker: mapped.speaker === '?' ? undefined : mapped.speaker,
          speakers: speakerCounts(mapped.words),
        })
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

  console.log(
    JSON.stringify(
      {
        provider: 'elevenlabs',
        model: 'scribe_v2_realtime',
        fixture: basename(fixturePath),
        chunkCount: chunks.length,
        firstPartialFromFirstAudioMs,
        firstCommittedFromFirstAudioMs,
        finalText,
        events,
      },
      null,
      2,
    ),
  )
}

async function streamChunks(
  socket: WebSocket,
  chunksToStream: PcmChunk[],
  onFirstAudioSent: (sentAt: number) => void,
): Promise<void> {
  for (const chunk of chunksToStream) {
    if (chunk.seq === 1) onFirstAudioSent(Date.now())
    const isLast = chunk.seq === chunksToStream.length
    socket.send(buildElevenLabsInputAudioChunkMessage({ data: chunk.data, sampleRate: 16_000, commit: isLast }))
    await sleep(chunk.durationMs)
  }
  await sleep(2_000)
  socket.close(1000, 'Scribe smoke complete')
}

function speakerCounts(words: Array<{ speaker?: string }> | undefined): Record<string, number> | undefined {
  if (!words) return undefined
  const counts: Record<string, number> = {}
  for (const word of words) {
    if (word.speaker) counts[word.speaker] = (counts[word.speaker] ?? 0) + 1
  }
  return Object.keys(counts).length ? counts : undefined
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
