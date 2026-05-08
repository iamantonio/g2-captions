export const DEFAULT_HARDWARE_BENCHMARK_PHRASES = [
  'OpenAI G2 summary telemetry test.',
  'Proven Machine captions are live on the glasses.',
  'I want accurate captions in noisy rooms.',
  'The client asked about website conversion and SEO.',
] as const

export interface HardwareBenchmarkScoreInput {
  expectedPhrases: readonly string[]
  observedFinalTranscripts: readonly string[]
}

export interface HardwareBenchmarkPhraseScore {
  index: number
  expected: string
  observed: string
  exactMatch: boolean
  wordErrorRateLite: number
}

export interface HardwareBenchmarkScore {
  expectedPhraseCount: number
  observedFinalCount: number
  exactMatchCount: number
  exactMatchRate: number
  meanWordErrorRateLite: number
  phrases: HardwareBenchmarkPhraseScore[]
}

export function isHardwareBenchmarkMode(locationUrl: URL): boolean {
  return locationUrl.searchParams.get('mode') === 'hardwareBenchmark'
}

export function buildHardwareBenchmarkScore(input: HardwareBenchmarkScoreInput): HardwareBenchmarkScore {
  const phrases = input.expectedPhrases.map((expected, index) => {
    const observed = input.observedFinalTranscripts[index] ?? ''
    const exactMatch = normalizeForCompare(expected) === normalizeForCompare(observed)
    return {
      index: index + 1,
      expected,
      observed,
      exactMatch,
      wordErrorRateLite: calculateWordErrorRateLite(expected, observed),
    }
  })
  const exactMatchCount = phrases.filter((phrase) => phrase.exactMatch).length
  return {
    expectedPhraseCount: input.expectedPhrases.length,
    observedFinalCount: input.observedFinalTranscripts.length,
    exactMatchCount,
    exactMatchRate: input.expectedPhrases.length === 0 ? 0 : exactMatchCount / input.expectedPhrases.length,
    meanWordErrorRateLite: mean(phrases.map((phrase) => phrase.wordErrorRateLite)),
    phrases,
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
