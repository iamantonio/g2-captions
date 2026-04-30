import { describe, expect, it } from 'vitest'
import {
  ASSEMBLYAI_STREAMING_ORIGIN,
  buildAssemblyAiStreamingUrl,
  mapAssemblyAiTurnToRawAsrEvent,
  validateAssemblyAiToken,
} from '../../src/asr/AssemblyAiStreamingClient'

describe('AssemblyAI streaming client configuration', () => {
  it('builds a temporary-token WebSocket URL with captioning defaults', () => {
    const url = buildAssemblyAiStreamingUrl({
      token: 'temp-token-123',
      keyterms: ['ProvenMachine', 'Even Realities G2'],
      maxSpeakers: 2,
    })

    expect(url.origin).toBe(ASSEMBLYAI_STREAMING_ORIGIN)
    expect(url.searchParams.get('token')).toBe('temp-token-123')
    expect(url.searchParams.get('speech_model')).toBe('u3-rt-pro')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
    expect(url.searchParams.get('encoding')).toBe('pcm_s16le')
    expect(url.searchParams.get('speaker_labels')).toBe('true')
    expect(url.searchParams.get('max_speakers')).toBe('2')
    expect(url.searchParams.get('keyterms_prompt')).toBe(JSON.stringify(['ProvenMachine', 'Even Realities G2']))
  })

  it('rejects missing temporary tokens so API keys are never embedded in the WebView', () => {
    expect(() => validateAssemblyAiToken('')).toThrow(/temporary token/i)
    expect(() => validateAssemblyAiToken('sk_live_secret')).toThrow(/temporary token/i)
  })

  it('rejects strings shaped like a raw 32-character hex AssemblyAI API key', () => {
    expect(() => validateAssemblyAiToken('a'.repeat(32))).toThrow(/temporary token/i)
    expect(() => validateAssemblyAiToken('0123456789abcdef0123456789abcdef')).toThrow(/temporary token/i)
  })
})

describe('AssemblyAI turn event mapping', () => {
  it('maps Turn events into the common ASR contract with visual speaker labels', () => {
    const event = mapAssemblyAiTurnToRawAsrEvent(
      {
        type: 'Turn',
        transcript: 'ProvenMachine is ready',
        end_of_turn: false,
        speaker_label: 'A',
        turn_order: 12,
        words: [{ text: 'ProvenMachine', start: 20, end: 260, confidence: 0.93, speaker: 'A' }],
      },
      { receivedAtMs: 420, fallbackStartMs: 100 },
    )

    expect(event).toMatchObject({
      vendor: 'assemblyai',
      text: 'ProvenMachine is ready',
      status: 'partial',
      speaker: 'A',
      receivedAtMs: 420,
      startMs: 20,
      endMs: 260,
    })
    expect(event.words?.[0]).toMatchObject({ text: 'ProvenMachine', startMs: 20, endMs: 260, speaker: 'A' })
  })

  it('maps end_of_turn Turn events to final captions and unknown speakers to ?', () => {
    const event = mapAssemblyAiTurnToRawAsrEvent(
      { type: 'Turn', transcript: 'done', end_of_turn: true },
      { receivedAtMs: 800, fallbackStartMs: 500 },
    )

    expect(event).toMatchObject({
      vendor: 'assemblyai',
      text: 'done',
      status: 'final',
      speaker: '?',
      startMs: 500,
      endMs: 800,
    })
  })
})
