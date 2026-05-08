import { describe, expect, it } from 'vitest'
import { buildProviderComparisonReport, type ProviderSmokeResult } from '../../src/benchmark/providerComparison'

const results: ProviderSmokeResult[] = [
  {
    provider: 'deepgram',
    model: 'nova-3',
    fixture: 'speech-smoke.pcm',
    expectedText: 'Proven machine captions are ready.',
    finalText: 'Proven machine captions are ready.',
    firstPartialFromFirstAudioMs: 280,
    finalFromFirstAudioMs: 1250,
    speakerLabels: ['0'],
  },
  {
    provider: 'openai',
    model: 'gpt-realtime-whisper',
    fixture: 'speech-smoke.pcm',
    expectedText: 'Proven machine captions are ready.',
    finalText: 'Proven machine captions are ready.',
    firstPartialFromFirstAudioMs: 920,
    finalFromFirstAudioMs: 2600,
    speakerLabels: [],
  },
  {
    provider: 'elevenlabs',
    model: 'scribe_v2_realtime',
    fixture: 'speech-smoke.pcm',
    expectedText: 'Proven machine captions are ready.',
    finalText: 'Proven machine captures already.',
    firstPartialFromFirstAudioMs: 760,
    finalFromFirstAudioMs: 2100,
    speakerLabels: [],
  },
]

describe('buildProviderComparisonReport', () => {
  it('aggregates fixture count and per-provider exact-match/latency across multiple fixtures', () => {
    const report = buildProviderComparisonReport({
      suiteId: 'multi-fixture-provider-comparison',
      generatedAt: '2026-05-07T22:10:00.000Z',
      results: [
        ...results,
        {
          provider: 'deepgram',
          model: 'nova-3',
          fixture: 'custom-vocab-g2.pcm',
          expectedText: 'ProvenMachine captions are ready on G2.',
          finalText: 'ProvenMachine captions are ready on G2.',
          firstPartialFromFirstAudioMs: 340,
          finalFromFirstAudioMs: 1440,
          speakerLabels: ['0'],
        },
        {
          provider: 'openai',
          model: 'gpt-realtime-whisper',
          fixture: 'custom-vocab-g2.pcm',
          expectedText: 'ProvenMachine captions are ready on G2.',
          finalText: 'Proven machine captions are ready on G2.',
          firstPartialFromFirstAudioMs: 1040,
          finalFromFirstAudioMs: 2780,
          speakerLabels: [],
        },
      ],
    })

    expect(report.aggregate.fixtureCount).toBe(2)
    expect(report.aggregate.resultCount).toBe(5)
    expect(report.aggregate.byProvider.deepgram!.exactMatchRate).toBe(1)
    expect(report.aggregate.byProvider.deepgram!.meanFinalFromFirstAudioMs).toBe(1345)
    expect(report.aggregate.byProvider.openai!.exactMatchRate).toBe(0.5)
    expect(report.fixtures.map((fixture) => fixture.fixture)).toEqual(['custom-vocab-g2.pcm', 'speech-smoke.pcm'])
    expect(report.fixtures.find((fixture) => fixture.fixture === 'custom-vocab-g2.pcm')?.providers).toEqual([
      'deepgram',
      'openai',
    ])
  })

  it('scores provider smoke outputs without crossing live-audio safety gates', () => {
    const report = buildProviderComparisonReport({
      suiteId: 'provider-fixture-comparison',
      generatedAt: '2026-05-07T22:00:00.000Z',
      results,
    })

    expect(report.audioSource).toBe('fixture-only')
    expect(report.safety).toEqual({
      noBrowserMic: true,
      noG2SdkAudio: true,
      noBleWrites: true,
      noBackgroundCapture: true,
    })
    expect(report.providers).toHaveLength(3)
    expect(report.providers.map((provider) => provider.provider)).toEqual(['deepgram', 'openai', 'elevenlabs'])

    const deepgram = report.providers.find((provider) => provider.provider === 'deepgram')
    expect(deepgram?.score.exactMatch).toBe(true)
    expect(deepgram?.score.wordErrorRateLite).toBe(0)
    expect(deepgram?.score.hasSpeakerLabels).toBe(true)

    const elevenlabs = report.providers.find((provider) => provider.provider === 'elevenlabs')
    expect(elevenlabs?.score.exactMatch).toBe(false)
    expect(elevenlabs?.notes).toContain('exact transcript mismatch')

    expect(report.ranking.fastestFirstPartial.map((entry) => entry.provider)).toEqual([
      'deepgram',
      'elevenlabs',
      'openai',
    ])
    expect(report.ranking.lowestWer.map((entry) => entry.provider)).toEqual(['deepgram', 'openai', 'elevenlabs'])
  })
})
