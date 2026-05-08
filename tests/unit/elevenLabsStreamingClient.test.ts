import { describe, expect, it } from 'vitest'
import {
  buildElevenLabsRealtimeUrl,
  buildElevenLabsInputAudioChunkMessage,
  mapElevenLabsRealtimeMessageToRawAsrEvent,
} from '../../src/asr/ElevenLabsStreamingClient'

describe('ElevenLabsStreamingClient', () => {
  it('builds a Scribe v2 realtime URL with safe client-token auth and G2 PCM defaults', () => {
    const url = buildElevenLabsRealtimeUrl({
      token: 'single-use-token',
      keyterms: ['ProvenMachine', 'Even Realities G2', ''],
    })

    expect(url.origin + url.pathname).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime')
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime')
    expect(url.searchParams.get('token')).toBe('single-use-token')
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000')
    expect(url.searchParams.get('include_timestamps')).toBe('true')
    expect(url.searchParams.get('commit_strategy')).toBe('vad')
    expect(url.searchParams.getAll('keyterms')).toEqual(['ProvenMachine', 'Even Realities G2'])
  })

  it('encodes PCM chunks as ElevenLabs input_audio_chunk JSON messages', () => {
    const message = buildElevenLabsInputAudioChunkMessage({
      data: new Uint8Array([1, 2, 3, 4]).buffer,
      sampleRate: 16_000,
      commit: false,
    })

    expect(JSON.parse(message)).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: 'AQIDBA==',
      commit: false,
      sample_rate: 16000,
    })
  })

  it('maps committed timestamped transcripts to RawAsrEvent with speaker IDs when present', () => {
    const event = mapElevenLabsRealtimeMessageToRawAsrEvent(
      {
        message_type: 'committed_transcript_with_timestamps',
        text: 'Hello Tony',
        language_code: 'en',
        words: [
          { text: 'Hello', start: 0.1, end: 0.4, type: 'word', speaker_id: 'speaker_0', logprob: -0.2 },
          { text: ' ', start: 0.4, end: 0.41, type: 'spacing', speaker_id: 'speaker_0' },
          { text: 'Tony', start: 0.42, end: 0.9, type: 'word', speaker_id: 'speaker_0', logprob: -0.1 },
        ],
      },
      { receivedAtMs: 1_000, fallbackStartMs: 900 },
    )

    expect(event).toMatchObject({
      vendor: 'elevenlabs',
      text: 'Hello Tony',
      status: 'final',
      startMs: 100,
      endMs: 900,
      speaker: 'speaker_0',
      receivedAtMs: 1000,
    })
    expect(event.words).toEqual([
      { text: 'Hello', startMs: 100, endMs: 400, confidence: -0.2, speaker: 'speaker_0' },
      { text: 'Tony', startMs: 420, endMs: 900, confidence: -0.1, speaker: 'speaker_0' },
    ])
  })
})
