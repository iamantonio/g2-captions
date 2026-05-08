export type ComparedProvider = 'deepgram' | 'openai' | 'elevenlabs'

export interface ProviderSmokeResult {
  provider: ComparedProvider
  model: string
  fixture: string
  expectedText: string
  finalText: string
  firstPartialFromFirstAudioMs?: number
  finalFromFirstAudioMs?: number
  speakerLabels?: string[]
}

export interface ProviderComparisonInput {
  suiteId: string
  generatedAt: string
  results: ProviderSmokeResult[]
}

export interface ProviderComparisonScore {
  exactMatch: boolean
  wordErrorRateLite: number
  hasSpeakerLabels: boolean
}

export interface ProviderComparisonEntry extends ProviderSmokeResult {
  score: ProviderComparisonScore
  notes: string[]
}

export interface ProviderRankingEntry {
  provider: ComparedProvider
  model: string
  value: number
}

export interface ProviderFixtureSummary {
  fixture: string
  providers: ComparedProvider[]
}

export interface ProviderAggregateSummary {
  resultCount: number
  exactMatchRate: number
  meanWordErrorRateLite: number
  meanFirstPartialFromFirstAudioMs?: number
  meanFinalFromFirstAudioMs?: number
}

export interface ProviderComparisonAggregate {
  fixtureCount: number
  resultCount: number
  byProvider: Partial<Record<ComparedProvider, ProviderAggregateSummary>>
}

export interface ProviderComparisonReport {
  suiteId: string
  generatedAt: string
  audioSource: 'fixture-only'
  safety: {
    noBrowserMic: true
    noG2SdkAudio: true
    noBleWrites: true
    noBackgroundCapture: true
  }
  providers: ProviderComparisonEntry[]
  fixtures: ProviderFixtureSummary[]
  aggregate: ProviderComparisonAggregate
  ranking: {
    fastestFirstPartial: ProviderRankingEntry[]
    fastestFinal: ProviderRankingEntry[]
    lowestWer: ProviderRankingEntry[]
  }
}

export function buildProviderComparisonReport(input: ProviderComparisonInput): ProviderComparisonReport {
  const providers = input.results.map(scoreProviderResult)
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
    providers,
    fixtures: summarizeFixtures(providers),
    aggregate: aggregateProviders(providers),
    ranking: {
      fastestFirstPartial: rankByMetric(providers, 'firstPartialFromFirstAudioMs', 'asc'),
      fastestFinal: rankByMetric(providers, 'finalFromFirstAudioMs', 'asc'),
      lowestWer: rankByScore(providers, 'wordErrorRateLite', 'asc'),
    },
  }
}

function summarizeFixtures(entries: ProviderComparisonEntry[]): ProviderFixtureSummary[] {
  const byFixture = new Map<string, Set<ComparedProvider>>()
  for (const entry of entries) {
    const providers = byFixture.get(entry.fixture) ?? new Set<ComparedProvider>()
    providers.add(entry.provider)
    byFixture.set(entry.fixture, providers)
  }
  return Array.from(byFixture.entries())
    .map(([fixture, providers]) => ({ fixture, providers: Array.from(providers).sort() }))
    .sort((left, right) => left.fixture.localeCompare(right.fixture))
}

function aggregateProviders(entries: ProviderComparisonEntry[]): ProviderComparisonAggregate {
  const byProvider: Partial<Record<ComparedProvider, ProviderAggregateSummary>> = {}
  const providerNames = Array.from(new Set(entries.map((entry) => entry.provider))).sort()
  for (const provider of providerNames) {
    const providerEntries = entries.filter((entry) => entry.provider === provider)
    byProvider[provider] = {
      resultCount: providerEntries.length,
      exactMatchRate: mean(providerEntries.map((entry) => (entry.score.exactMatch ? 1 : 0))),
      meanWordErrorRateLite: mean(providerEntries.map((entry) => entry.score.wordErrorRateLite)),
      meanFirstPartialFromFirstAudioMs: meanOptional(
        providerEntries.map((entry) => entry.firstPartialFromFirstAudioMs),
      ),
      meanFinalFromFirstAudioMs: meanOptional(providerEntries.map((entry) => entry.finalFromFirstAudioMs)),
    }
  }
  return {
    fixtureCount: new Set(entries.map((entry) => entry.fixture)).size,
    resultCount: entries.length,
    byProvider,
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function meanOptional(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numeric.length === 0 ? undefined : mean(numeric)
}

function scoreProviderResult(result: ProviderSmokeResult): ProviderComparisonEntry {
  const exactMatch = normalizeForCompare(result.finalText) === normalizeForCompare(result.expectedText)
  const wordErrorRateLite = calculateWordErrorRateLite(result.expectedText, result.finalText)
  const hasSpeakerLabels = (result.speakerLabels ?? []).some((speaker) => speaker.trim() && speaker !== '?')
  const notes: string[] = []
  if (!exactMatch) notes.push('exact transcript mismatch')
  if (!hasSpeakerLabels) notes.push('no speaker labels observed')
  if (result.firstPartialFromFirstAudioMs === undefined) notes.push('missing first partial latency')
  if (result.finalFromFirstAudioMs === undefined) notes.push('missing final transcript latency')

  return {
    ...result,
    speakerLabels: [...(result.speakerLabels ?? [])],
    score: { exactMatch, wordErrorRateLite, hasSpeakerLabels },
    notes,
  }
}

function rankByMetric(
  entries: ProviderComparisonEntry[],
  field: 'firstPartialFromFirstAudioMs' | 'finalFromFirstAudioMs',
  direction: 'asc',
): ProviderRankingEntry[] {
  return entries
    .filter((entry) => typeof entry[field] === 'number')
    .map((entry) => ({ provider: entry.provider, model: entry.model, value: entry[field] as number }))
    .sort((left, right) => (direction === 'asc' ? left.value - right.value : right.value - left.value))
}

function rankByScore(
  entries: ProviderComparisonEntry[],
  field: keyof ProviderComparisonScore,
  direction: 'asc',
): ProviderRankingEntry[] {
  return entries
    .map((entry) => ({ provider: entry.provider, model: entry.model, value: Number(entry.score[field]) }))
    .sort((left, right) => (direction === 'asc' ? left.value - right.value : right.value - left.value))
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
