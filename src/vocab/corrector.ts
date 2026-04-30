import type { VocabularyCorrection, VocabularyEntry } from '../types'

export interface VocabularyCorrectionResult {
  text: string
  corrections: VocabularyCorrection[]
}

interface CompiledEntry {
  canonical: string
  category?: string
  priority: number
  aliases: Array<{ alias: string; pattern: RegExp }>
}

// Compiled-vocabulary cache keyed by the input array reference. Same entries
// array reused across many ASR events compiles its regexes once.
const compiledCache = new WeakMap<VocabularyEntry[], CompiledEntry[]>()

function compile(entries: VocabularyEntry[]): CompiledEntry[] {
  const cached = compiledCache.get(entries)
  if (cached) return cached
  const compiled = [...entries]
    .sort((a, b) => b.priority - a.priority)
    .map((entry) => ({
      canonical: entry.canonical,
      category: entry.category,
      priority: entry.priority,
      aliases: entry.aliases.map((alias) => ({
        alias,
        pattern: new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi'),
      })),
    }))
  compiledCache.set(entries, compiled)
  return compiled
}

interface AliasMatch {
  start: number
  end: number
  matched: string
  entry: CompiledEntry
}

export function applyVocabularyCorrections(text: string, entries: VocabularyEntry[]): VocabularyCorrectionResult {
  const compiled = compile(entries)
  const matches: AliasMatch[] = []

  for (const entry of compiled) {
    for (const { pattern } of entry.aliases) {
      for (const m of text.matchAll(pattern)) {
        const start = m.index ?? 0
        const matched = m[0]
        if (matched.length === 0) continue
        matches.push({ start, end: start + matched.length, matched, entry })
      }
    }
  }

  // Resolve overlapping matches: higher priority wins; ties broken by left-most
  // start. A later match is dropped if it overlaps any already-accepted one.
  matches.sort((a, b) => b.entry.priority - a.entry.priority || a.start - b.start)
  const accepted: AliasMatch[] = []
  for (const candidate of matches) {
    if (!accepted.some((acc) => candidate.start < acc.end && candidate.end > acc.start)) {
      accepted.push(candidate)
    }
  }

  // Apply accepted matches left-to-right against the original text. Reporting
  // corrections in position order matches reading order.
  accepted.sort((a, b) => a.start - b.start)
  let corrected = ''
  let lastEnd = 0
  const corrections: VocabularyCorrection[] = []
  for (const m of accepted) {
    corrected += text.slice(lastEnd, m.start) + m.entry.canonical
    corrections.push({ from: m.matched, to: m.entry.canonical, category: m.entry.category })
    lastEnd = m.end
  }
  corrected += text.slice(lastEnd)

  return { text: corrected, corrections }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
