import { describe, expect, it } from 'vitest'
import {
  DEEPGRAM_STREAMING_ORIGIN,
  buildDeepgramStreamingUrl,
  mapDeepgramResultsToRawAsrEvent,
  validateDeepgramAccessToken,
} from '../../src/asr/DeepgramStreamingClient'

describe('Deepgram streaming client configuration', () => {
  it('builds a browser-safe WebSocket URL with captioning defaults', () => {
    const url = buildDeepgramStreamingUrl({ keyterms: ['ProvenMachine', 'Even Realities G2'] })

    expect(url.origin).toBe(DEEPGRAM_STREAMING_ORIGIN)
    expect(url.pathname).toBe('/v1/listen')
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('encoding')).toBe('linear16')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
    expect(url.searchParams.get('channels')).toBe('1')
    expect(url.searchParams.get('interim_results')).toBe('true')
    expect(url.searchParams.get('smart_format')).toBe('true')
    expect(url.searchParams.get('punctuate')).toBe('true')
    expect(url.searchParams.get('diarize')).toBe('true')
    expect(url.searchParams.getAll('keyterm')).toEqual(['ProvenMachine', 'Even Realities G2'])
    expect(url.toString()).not.toContain('dg-temp-token')
  })

  it('rejects missing temporary tokens so API keys are never embedded in the WebView', () => {
    expect(() => validateDeepgramAccessToken('')).toThrow(/temporary token/i)
    expect(() => validateDeepgramAccessToken('***')).toThrow(/temporary token/i)
  })

  it('rejects strings shaped like a raw 40-character hex Deepgram API key', () => {
    expect(() => validateDeepgramAccessToken('a'.repeat(40))).toThrow(/temporary token/i)
    expect(() => validateDeepgramAccessToken('0123456789abcdef0123456789abcdef01234567')).toThrow(/temporary token/i)
  })
})

describe('Deepgram result event mapping', () => {
  it('maps Results messages into the common ASR contract with speaker labels', () => {
    const event = mapDeepgramResultsToRawAsrEvent(
      {
        type: 'Results',
        is_final: false,
        speech_final: false,
        start: 1.2,
        duration: 0.8,
        channel: {
          alternatives: [
            {
              transcript: 'ProvenMachine is ready',
              confidence: 0.93,
              words: [
                { word: 'ProvenMachine', start: 1.2, end: 1.5, confidence: 0.9, speaker: 0 },
                { punctuated_word: 'ready.', start: 1.7, end: 2.0, confidence: 0.95, speaker: 0 },
              ],
            },
          ],
        },
      },
      { receivedAtMs: 420, fallbackStartMs: 100 },
    )

    expect(event).toMatchObject({
      vendor: 'deepgram',
      text: 'ProvenMachine is ready',
      status: 'partial',
      speaker: '0',
      receivedAtMs: 420,
      startMs: 1200,
      endMs: 2000,
      confidence: 0.93,
    })
    expect(event.words?.[0]).toMatchObject({ text: 'ProvenMachine', startMs: 1200, endMs: 1500, speaker: '0' })
    expect(event.words?.[1]).toMatchObject({ text: 'ready.', startMs: 1700, endMs: 2000, speaker: '0' })
  })

  it('maps final Deepgram messages and unknown speakers to ?', () => {
    const event = mapDeepgramResultsToRawAsrEvent(
      {
        type: 'Results',
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: 'done' }] },
      },
      { receivedAtMs: 800, fallbackStartMs: 500 },
    )

    expect(event).toMatchObject({
      vendor: 'deepgram',
      text: 'done',
      status: 'final',
      speaker: '?',
      startMs: 500,
      endMs: 800,
    })
  })
})
