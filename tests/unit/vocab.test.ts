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
})
