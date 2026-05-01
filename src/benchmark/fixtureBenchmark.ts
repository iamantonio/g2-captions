import { applyVocabularyCorrections } from '../vocab/corrector'
import type { FixtureAsrScriptEvent, VocabularyEntry } from '../types'

export type FixtureBenchmarkSourceKind = 'generated-local' | 'scripted-only' | 'public-dataset'

export interface FixtureBenchmarkSource {
  kind: FixtureBenchmarkSourceKind
  license: string
  path?: string
  url?: string
}

export interface FixtureBenchmarkDefinition {
  id: string
  description: string
  source: FixtureBenchmarkSource
  expectedTranscript: string
  expectedKeyTerms: string[]
  expectedSpeakerLabels: string[]
  events: FixtureAsrScriptEvent[]
}

export interface FixtureBenchmarkSuiteInput {
  suiteId: string
  generatedAt: string
  vocabulary: VocabularyEntry[]
  fixtures: FixtureBenchmarkDefinition[]
}

export interface FixtureBenchmarkMetrics {
  firstPartialLatencyMs?: number
  finalTranscriptLatencyMs?: number
  exactMatch: boolean
  wordErrorRateLite: number
  customVocabularyHits: number
  customVocabularyExpected: number
  customVocabularyHitRate: number
  speakerLabelsObserved: number
  speakerLabelsExpected: number
  speakerLabelHitRate: number
}

export interface FixtureBenchmarkResult {
  id: string
  description: string
  source: FixtureBenchmarkSource
  expectedTranscript: string
  observedTranscript: string
  expectedKeyTerms: string[]
  observedKeyTerms: string[]
  expectedSpeakerLabels: string[]
  observedSpeakerLabels: string[]
  metrics: FixtureBenchmarkMetrics
  notes: string[]
}

export interface FixtureBenchmarkAggregate {
  fixtureCount: number
  exactMatchRate: number
  meanWordErrorRateLite: number
  customVocabularyHitRate: number
  speakerLabelHitRate: number
}

export interface FixtureBenchmarkReport {
  suiteId: string
  generatedAt: string
  audioSource: 'fixture-only'
  safety: {
    noBrowserMic: true
    noG2SdkAudio: true
    noBleWrites: true
    noBackgroundCapture: true
  }
  fixtures: FixtureBenchmarkResult[]
  aggregate: FixtureBenchmarkAggregate
}

export async function runFixtureBenchmarkSuite(input: FixtureBenchmarkSuiteInput): Promise<FixtureBenchmarkReport> {
  const fixtures = input.fixtures.map((fixture) => runFixtureBenchmark(fixture, input.vocabulary))
  return {
    suiteId: input.suiteId,
    generatedAt: input.generatedAt,
    audioSource: 'fixture-only',
    safety: {
      noBrowserMic: true,
      noG2SdkAudio: true,
      noBleWrites: true,
      noBackgroundCapture: true,
    },
    fixtures,
    aggregate: aggregateFixtureResults(fixtures),
  }
}

function runFixtureBenchmark(
  fixture: FixtureBenchmarkDefinition,
  vocabulary: VocabularyEntry[],
): FixtureBenchmarkResult {
  const finalEvents = fixture.events.filter((event) => event.status === 'final')
  const terminalEvents = finalEvents.length > 0 ? finalEvents : fixture.events.slice(-1)
  const observedTranscript = terminalEvents
    .map((event) => applyVocabularyCorrections(event.text, vocabulary).text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const observedSpeakerLabels = unique(
    fixture.events
      .map((event) => event.speaker?.trim())
      .filter((speaker): speaker is string => Boolean(speaker) && speaker !== '?'),
  )
  const observedKeyTerms = fixture.expectedKeyTerms.filter((term) => includesNormalizedTerm(observedTranscript, term))
  const exactMatch = normalizeForCompare(observedTranscript) === normalizeForCompare(fixture.expectedTranscript)
  const customVocabularyExpected = fixture.expectedKeyTerms.length
  const speakerLabelsExpected = fixture.expectedSpeakerLabels.length
  const metrics: FixtureBenchmarkMetrics = {
    firstPartialLatencyMs: fixture.events.find((event) => event.status === 'partial')?.delayMs,
    finalTranscriptLatencyMs: finalEvents.at(-1)?.delayMs,
    exactMatch,
    wordErrorRateLite: calculateWordErrorRateLite(fixture.expectedTranscript, observedTranscript),
    customVocabularyHits: observedKeyTerms.length,
    customVocabularyExpected,
    customVocabularyHitRate: customVocabularyExpected === 0 ? 1 : observedKeyTerms.length / customVocabularyExpected,
    speakerLabelsObserved: observedSpeakerLabels.length,
    speakerLabelsExpected,
    speakerLabelHitRate:
      speakerLabelsExpected === 0
        ? 1
        : fixture.expectedSpeakerLabels.filter((speaker) => observedSpeakerLabels.includes(speaker)).length /
          speakerLabelsExpected,
  }

  return {
    id: fixture.id,
    description: fixture.description,
    source: { ...fixture.source },
    expectedTranscript: fixture.expectedTranscript,
    observedTranscript,
    expectedKeyTerms: [...fixture.expectedKeyTerms],
    observedKeyTerms,
    expectedSpeakerLabels: [...fixture.expectedSpeakerLabels],
    observedSpeakerLabels,
    metrics,
    notes: buildFixtureNotes(fixture, observedTranscript, observedSpeakerLabels, metrics),
  }
}

function aggregateFixtureResults(fixtures: FixtureBenchmarkResult[]): FixtureBenchmarkAggregate {
  const fixtureCount = fixtures.length
  const vocabularyExpected = sum(fixtures.map((fixture) => fixture.metrics.customVocabularyExpected))
  const vocabularyHits = sum(fixtures.map((fixture) => fixture.metrics.customVocabularyHits))
  const speakerExpected = sum(fixtures.map((fixture) => fixture.metrics.speakerLabelsExpected))
  const speakerHits = sum(
    fixtures.map(
      (fixture) =>
        fixture.expectedSpeakerLabels.filter((speaker) => fixture.observedSpeakerLabels.includes(speaker)).length,
    ),
  )

  return {
    fixtureCount,
    exactMatchRate:
      fixtureCount === 0 ? 0 : fixtures.filter((fixture) => fixture.metrics.exactMatch).length / fixtureCount,
    meanWordErrorRateLite:
      fixtureCount === 0 ? 0 : sum(fixtures.map((fixture) => fixture.metrics.wordErrorRateLite)) / fixtureCount,
    customVocabularyHitRate: vocabularyExpected === 0 ? 1 : vocabularyHits / vocabularyExpected,
    speakerLabelHitRate: speakerExpected === 0 ? 1 : speakerHits / speakerExpected,
  }
}

function buildFixtureNotes(
  fixture: FixtureBenchmarkDefinition,
  observedTranscript: string,
  observedSpeakerLabels: string[],
  metrics: FixtureBenchmarkMetrics,
): string[] {
  const notes: string[] = []
  if (!metrics.exactMatch) notes.push('exact transcript mismatch')
  const missedTerms = fixture.expectedKeyTerms.filter((term) => !includesNormalizedTerm(observedTranscript, term))
  if (missedTerms.length > 0) notes.push(`custom vocabulary misses: ${missedTerms.join(', ')}`)
  const missedSpeakers = fixture.expectedSpeakerLabels.filter((speaker) => !observedSpeakerLabels.includes(speaker))
  if (missedSpeakers.length > 0) notes.push(`speaker label misses: ${missedSpeakers.join(', ')}`)
  return notes
}

function calculateWordErrorRateLite(expected: string, observed: string): number {
  const expectedWords = tokenize(expected)
  const observedWords = tokenize(observed)
  if (expectedWords.length === 0) return observedWords.length === 0 ? 0 : 1
  return levenshteinDistance(expectedWords, observedWords) / expectedWords.length
}

function levenshteinDistance(left: string[], right: string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function includesNormalizedTerm(text: string, term: string): boolean {
  return tokenize(text).join(' ').includes(tokenize(term).join(' '))
}

function normalizeForCompare(value: string): string {
  return tokenize(value).join(' ')
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
