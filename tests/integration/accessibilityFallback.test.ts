import { describe, expect, it } from 'vitest'
import { renderPhonePreview } from '../../src/display/phoneDisplay'
import { createVisualErrorSegment } from '../../src/captions/visualErrors'
import { formatVisualStatus } from '../../src/captions/formatter'
import { VISUAL_STATUS_KINDS, type VisualStatusKind } from '../../src/types'

const SOUND_ONLY_PATTERN = /\b(beep|sound|audio cue|ring|chime)\b/i

const expectedSubstring: Record<VisualStatusKind, string> = {
  'mic-blocked': 'MIC BLOCKED',
  'g2-disconnected': 'G2 DISCONNECTED',
  'network-slow': 'NETWORK SLOW',
  'g2-mic-lost': 'G2 MIC LOST',
  'asr-lost': 'ASR LOST',
  'vocab-loaded': 'VOCAB LOADED',
}

describe('phone visual accessibility fallback', () => {
  it('renders G2 disconnect as visual phone text, not sound-dependent state', () => {
    const segment = createVisualErrorSegment('g2-disconnected', 1000)
    const phone = renderPhonePreview([segment])

    expect(phone).toContain('G2 DISCONNECTED — captions on phone')
    expect(phone).not.toMatch(SOUND_ONLY_PATTERN)
  })

  it.each(VISUAL_STATUS_KINDS)('shows %s as visual-only text with no sound prompts', (kind) => {
    const text = formatVisualStatus({ kind, count: 3 })
    expect(text).toContain(expectedSubstring[kind])
    expect(text).not.toMatch(SOUND_ONLY_PATTERN)
  })
})
