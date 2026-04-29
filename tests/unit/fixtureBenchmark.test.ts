import { describe, expect, it } from 'vitest'
import { runFixtureBenchmarkSuite } from '../../src/benchmark/fixtureBenchmark'

const vocabulary = [
  { canonical: 'ProvenMachine', aliases: ['proven machine'], category: 'company', priority: 10 },
  { canonical: 'G2', aliases: ['gee two'], category: 'device', priority: 9 },
]

describe('runFixtureBenchmarkSuite', () => {
  it('builds a multi-utterance report with latency, WER-lite, vocabulary, and speaker-label metrics', async () => {
    const report = await runFixtureBenchmarkSuite({
      suiteId: 'phase-2.2-fixtures',
      generatedAt: '2026-04-29T15:30:00.000Z',
      vocabulary,
      fixtures: [
        {
          id: 'clean-short-generated',
          description: 'Generated clean short speech fixture',
          source: { kind: 'generated-local', license: 'local generated test fixture', path: 'public/fixtures/speech-smoke.pcm' },
          expectedTranscript: 'ProvenMachine captions are ready.',
          expectedKeyTerms: ['ProvenMachine'],
          expectedSpeakerLabels: ['A'],
          events: [
            { delayMs: 180, text: 'ProvenMachine captions', status: 'partial', speaker: 'A', startMs: 0, endMs: 900 },
            { delayMs: 520, text: 'ProvenMachine captions are ready.', status: 'final', speaker: 'A', startMs: 0, endMs: 1900 },
          ],
        },
        {
          id: 'custom-vocab-generated',
          description: 'Generated custom vocabulary phrase fixture',
          source: { kind: 'generated-local', license: 'local generated test fixture' },
          expectedTranscript: 'ProvenMachine captions are ready on G2.',
          expectedKeyTerms: ['ProvenMachine', 'G2'],
          expectedSpeakerLabels: ['A'],
          events: [
            { delayMs: 210, text: 'proven machine captions', status: 'partial', speaker: 'A', startMs: 0, endMs: 900 },
            { delayMs: 640, text: 'proven machine captions are ready on gee two', status: 'final', speaker: 'A', startMs: 0, endMs: 2100 },
          ],
        },
        {
          id: 'two-speaker-scripted',
          description: 'Scripted two-speaker fixture until approved public audio is available',
          source: { kind: 'scripted-only', license: 'synthetic transcript fixture' },
          expectedTranscript: 'Can you see captions? Yes captions are visible.',
          expectedKeyTerms: [],
          expectedSpeakerLabels: ['A', 'B'],
          events: [
            { delayMs: 300, text: 'Can you see captions?', status: 'final', speaker: 'A', startMs: 0, endMs: 1000 },
            { delayMs: 720, text: 'Yes captions are visible.', status: 'final', speaker: 'B', startMs: 1100, endMs: 2100 },
          ],
        },
      ],
    })

    expect(report.suiteId).toBe('phase-2.2-fixtures')
    expect(report.audioSource).toBe('fixture-only')
    expect(report.safety.noBrowserMic).toBe(true)
    expect(report.safety.noG2SdkAudio).toBe(true)
    expect(report.fixtures).toHaveLength(3)
    expect(report.fixtures.map((fixture) => fixture.id)).toEqual([
      'clean-short-generated',
      'custom-vocab-generated',
      'two-speaker-scripted',
    ])

    const customVocab = report.fixtures.find((fixture) => fixture.id === 'custom-vocab-generated')
    expect(customVocab?.metrics.exactMatch).toBe(true)
    expect(customVocab?.metrics.wordErrorRateLite).toBe(0)
    expect(customVocab?.metrics.customVocabularyHitRate).toBe(1)
    expect(customVocab?.metrics.firstPartialLatencyMs).toBe(210)
    expect(customVocab?.metrics.finalTranscriptLatencyMs).toBe(640)

    const twoSpeaker = report.fixtures.find((fixture) => fixture.id === 'two-speaker-scripted')
    expect(twoSpeaker?.metrics.speakerLabelsExpected).toBe(2)
    expect(twoSpeaker?.metrics.speakerLabelsObserved).toBe(2)
    expect(twoSpeaker?.metrics.speakerLabelHitRate).toBe(1)

    expect(report.aggregate.fixtureCount).toBe(3)
    expect(report.aggregate.exactMatchRate).toBe(1)
    expect(report.aggregate.customVocabularyHitRate).toBe(1)
    expect(report.aggregate.speakerLabelHitRate).toBe(1)
  })

  it('surfaces misses without hiding them behind aggregate success', async () => {
    const report = await runFixtureBenchmarkSuite({
      suiteId: 'misses-are-visible',
      generatedAt: '2026-04-29T15:30:00.000Z',
      vocabulary,
      fixtures: [
        {
          id: 'missed-keyterm',
          description: 'Fixture with visible metric misses',
          source: { kind: 'scripted-only', license: 'synthetic transcript fixture' },
          expectedTranscript: 'ProvenMachine runs on G2.',
          expectedKeyTerms: ['ProvenMachine', 'G2'],
          expectedSpeakerLabels: ['A'],
          events: [
            { delayMs: 900, text: 'proven caption runs on gee', status: 'final', speaker: '?', startMs: 0, endMs: 1400 },
          ],
        },
      ],
    })

    expect(report.fixtures[0].metrics.exactMatch).toBe(false)
    expect(report.fixtures[0].metrics.wordErrorRateLite).toBeGreaterThan(0)
    expect(report.fixtures[0].metrics.customVocabularyHitRate).toBe(0)
    expect(report.fixtures[0].metrics.speakerLabelHitRate).toBe(0)
    expect(report.fixtures[0].notes).toContain('exact transcript mismatch')
    expect(report.fixtures[0].notes).toContain('custom vocabulary misses: ProvenMachine, G2')
    expect(report.fixtures[0].notes).toContain('speaker label misses: A')
  })
})
