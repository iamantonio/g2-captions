import { describe, expect, it } from 'vitest'
import {
  OPENAI_REALTIME_TRANSCRIPTION_URL,
  buildOpenAiInputAudioAppendMessage,
  buildOpenAiSessionUpdateMessage,
  mapOpenAiRealtimeMessageToRawAsrEvent,
  resamplePcm16Mono16kTo24k,
} from '../../src/asr/OpenAiRealtimeClient'

describe('OpenAI realtime transcription client', () => {
  it('builds a transcription session.update for gpt-realtime-whisper with 24 kHz PCM input', () => {
    expect(OPENAI_REALTIME_TRANSCRIPTION_URL).toBe('wss://api.openai.com/v1/realtime?intent=transcription')

    expect(JSON.parse(buildOpenAiSessionUpdateMessage({ language: 'en' }))).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-realtime-whisper', language: 'en' },
          },
        },
      },
    })
  })

  it('resamples G2 16 kHz PCM16 chunks to 24 kHz before JSON/base64 append framing', () => {
    const input = new Int16Array([0, 1000, 2000, 3000]).buffer
    const resampled = resamplePcm16Mono16kTo24k(input)

    expect(Array.from(new Int16Array(resampled))).toEqual([0, 600, 1200, 1800, 2400, 3000])
    expect(JSON.parse(buildOpenAiInputAudioAppendMessage(input))).toEqual({
      type: 'input_audio_buffer.append',
      audio: Buffer.from(resampled).toString('base64'),
    })
  })

  it('maps transcript delta and completed events to the common ASR contract', () => {
    expect(
      mapOpenAiRealtimeMessageToRawAsrEvent(
        {
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: 'item_1',
          delta: 'Hello',
        },
        { receivedAtMs: 1_000, fallbackStartMs: 800 },
      ),
    ).toMatchObject({
      vendor: 'openai',
      text: 'Hello',
      status: 'partial',
      startMs: 800,
      endMs: 1000,
      speaker: '?',
      receivedAtMs: 1000,
    })

    expect(
      mapOpenAiRealtimeMessageToRawAsrEvent(
        {
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item_1',
          transcript: 'Hello Tony',
        },
        { receivedAtMs: 1_400, fallbackStartMs: 800 },
      ),
    ).toMatchObject({
      vendor: 'openai',
      text: 'Hello Tony',
      status: 'final',
      startMs: 800,
      endMs: 1400,
      speaker: '?',
      receivedAtMs: 1400,
    })
  })
})
