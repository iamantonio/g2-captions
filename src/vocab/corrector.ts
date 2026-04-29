import type { VocabularyCorrection, VocabularyEntry } from '../types'

export interface VocabularyCorrectionResult {
  text: string
  corrections: VocabularyCorrection[]
}

export function applyVocabularyCorrections(text: string, entries: VocabularyEntry[]): VocabularyCorrectionResult {
  const ordered = [...entries].sort((a, b) => b.priority - a.priority)
  let corrected = text
  const corrections: VocabularyCorrection[] = []

  for (const entry of ordered) {
    for (const alias of entry.aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi')
      corrected = corrected.replace(pattern, (match) => {
        corrections.push({ from: match, to: entry.canonical, category: entry.category })
        return entry.canonical
      })
    }
  }

  return { text: corrected, corrections }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
