import { describe, expect, it } from 'vitest'
import { applyVocabularyCorrections } from '../../src/vocab/corrector'
import type { VocabularyEntry } from '../../src/types'

describe('applyVocabularyCorrections', () => {
  it('deterministically corrects configured aliases and logs every replacement', () => {
    const vocab: VocabularyEntry[] = [
      {
        canonical: 'ProvenMachine',
        aliases: ['proven machine', 'proven machina'],
        soundsLike: ['proh ven machine'],
        category: 'company',
        priority: 10,
      },
      {
        canonical: 'G2',
        aliases: ['gee two', 'g two'],
        category: 'device',
        priority: 5,
      },
    ]

    const result = applyVocabularyCorrections('the proven machine app on gee two is working', vocab)

    expect(result.text).toBe('the ProvenMachine app on G2 is working')
    expect(result.corrections).toEqual([
      { from: 'proven machine', to: 'ProvenMachine', category: 'company' },
      { from: 'gee two', to: 'G2', category: 'device' },
    ])
  })

  it('does not double-correct when a higher-priority match overlaps a lower-priority alias', () => {
    // Higher-priority entry's match would overlap the lower-priority alias if
    // applied naively in sequence. Only the higher-priority canonical wins.
    const vocab: VocabularyEntry[] = [
      { canonical: 'Speech Pro Suite', aliases: ['speech pro suite'], category: 'product', priority: 10 },
      { canonical: 'Pro Account', aliases: ['pro suite'], category: 'plan', priority: 5 },
    ]

    const result = applyVocabularyCorrections('we shipped the speech pro suite today', vocab)

    expect(result.text).toBe('we shipped the Speech Pro Suite today')
    expect(result.corrections).toEqual([{ from: 'speech pro suite', to: 'Speech Pro Suite', category: 'product' }])
  })
})
