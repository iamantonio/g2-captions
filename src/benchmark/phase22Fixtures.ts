import type { FixtureBenchmarkDefinition } from './fixtureBenchmark'
import type { VocabularyEntry } from '../types'

export const PHASE_22_BENCHMARK_SUITE_ID = 'phase-2.2-fixtures'

export const phase22BenchmarkVocabulary: VocabularyEntry[] = [
  { canonical: 'ProvenMachine', aliases: ['proven machine'], category: 'company', priority: 10 },
  { canonical: 'G2', aliases: ['gee two', 'g two'], category: 'device', priority: 9 },
  { canonical: 'AssemblyAI', aliases: ['assembly ai', 'assembly a i'], category: 'provider', priority: 5 },
]

export const phase22BenchmarkFixtures: FixtureBenchmarkDefinition[] = [
  {
    id: 'clean-short-generated',
    description: 'Clean generated speech smoke fixture already used for AssemblyAI transport smoke tests.',
    source: {
      kind: 'generated-local',
      license: 'Generated locally for this project; no external dataset license.',
      path: 'public/fixtures/speech-smoke.pcm',
    },
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
    description: 'Generated phrase that exercises project/device vocabulary correction before live audio gates.',
    source: {
      kind: 'generated-local',
      license: 'Synthetic scripted transcript; audio fixture may be generated locally later.',
    },
    expectedTranscript: 'ProvenMachine captions are ready on G2.',
    expectedKeyTerms: ['ProvenMachine', 'G2'],
    expectedSpeakerLabels: ['A'],
    events: [
      { delayMs: 210, text: 'proven machine captions', status: 'partial', speaker: 'A', startMs: 0, endMs: 900 },
      { delayMs: 640, text: 'proven machine captions are ready on gee two', status: 'final', speaker: 'A', startMs: 0, endMs: 2100 },
    ],
  },
  {
    id: 'noisy-speech-scripted',
    description: 'Scripted noisy-condition proxy until an approved public-domain/no-license-conflict audio sample is selected.',
    source: {
      kind: 'scripted-only',
      license: 'Synthetic transcript fixture; no external audio included.',
    },
    expectedTranscript: 'Please repeat the meeting code slowly.',
    expectedKeyTerms: [],
    expectedSpeakerLabels: ['A'],
    events: [
      { delayMs: 430, text: 'please repeat meeting code', status: 'partial', speaker: 'A', startMs: 0, endMs: 1100 },
      { delayMs: 980, text: 'Please repeat the meeting code slowly.', status: 'final', speaker: 'A', startMs: 0, endMs: 2400 },
    ],
  },
  {
    id: 'two-speaker-scripted',
    description: 'Scripted two-speaker proxy until approved public speaker-labelled audio is available.',
    source: {
      kind: 'scripted-only',
      license: 'Synthetic transcript fixture; no external audio included.',
    },
    expectedTranscript: 'Can you see captions? Yes captions are visible.',
    expectedKeyTerms: [],
    expectedSpeakerLabels: ['A', 'B'],
    events: [
      { delayMs: 300, text: 'Can you see captions?', status: 'final', speaker: 'A', startMs: 0, endMs: 1000 },
      { delayMs: 720, text: 'Yes captions are visible.', status: 'final', speaker: 'B', startMs: 1100, endMs: 2100 },
    ],
  },
]
