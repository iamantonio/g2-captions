import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HARDWARE_BENCHMARK_PHRASES,
  buildHardwareBenchmarkScore,
  isHardwareBenchmarkMode,
} from '../../src/benchmark/hardwareBenchmark'

describe('hardware benchmark mode', () => {
  it('is enabled only by ?mode=hardwareBenchmark', () => {
    expect(isHardwareBenchmarkMode(new URL('http://192.168.1.205:5173/?mode=hardwareBenchmark'))).toBe(true)
    expect(isHardwareBenchmarkMode(new URL('http://192.168.1.205:5173/?mode=hardwarebenchmark'))).toBe(false)
    expect(isHardwareBenchmarkMode(new URL('http://192.168.1.205:5173/'))).toBe(false)
  })

  it('provides a short fixed phrase list for controlled G2 hardware reads', () => {
    expect(DEFAULT_HARDWARE_BENCHMARK_PHRASES).toEqual([
      'OpenAI G2 summary telemetry test.',
      'Proven Machine captions are live on the glasses.',
      'I want accurate captions in noisy rooms.',
      'The client asked about website conversion and SEO.',
    ])
  })

  it('scores observed finals against expected phrases with exact matches and WER-lite', () => {
    const score = buildHardwareBenchmarkScore({
      expectedPhrases: DEFAULT_HARDWARE_BENCHMARK_PHRASES.slice(0, 2),
      observedFinalTranscripts: [
        'OpenAI g two summary telemetry test.',
        'Proven machine captions are live on the glasses.',
      ],
    })

    expect(score.expectedPhraseCount).toBe(2)
    expect(score.observedFinalCount).toBe(2)
    expect(score.exactMatchCount).toBe(1)
    expect(score.exactMatchRate).toBe(0.5)
    expect(score.phrases[0]).toMatchObject({
      expected: 'OpenAI G2 summary telemetry test.',
      observed: 'OpenAI g two summary telemetry test.',
      exactMatch: false,
    })
    expect(score.phrases[0].wordErrorRateLite).toBeCloseTo(0.4, 5)
    expect(score.phrases[1]).toMatchObject({ exactMatch: true, wordErrorRateLite: 0 })
  })

  it('marks missing observed phrases as full errors', () => {
    const score = buildHardwareBenchmarkScore({
      expectedPhrases: ['First phrase.', 'Second phrase.'],
      observedFinalTranscripts: ['First phrase.'],
    })

    expect(score.observedFinalCount).toBe(1)
    expect(score.exactMatchRate).toBe(0.5)
    expect(score.meanWordErrorRateLite).toBe(0.5)
    expect(score.phrases[1]).toEqual({
      index: 2,
      expected: 'Second phrase.',
      observed: '',
      exactMatch: false,
      wordErrorRateLite: 1,
    })
  })
})
