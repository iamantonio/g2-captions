import { describe, expect, it } from 'vitest'
import { renderPhonePreview } from '../../src/display/phoneDisplay'
import { createVisualErrorSegment } from '../../src/captions/visualErrors'

describe('phone visual accessibility fallback', () => {
  it('renders G2 disconnect as visual phone text, not sound-dependent state', () => {
    const segment = createVisualErrorSegment('g2-disconnected', 1000)
    const phone = renderPhonePreview([segment])

    expect(phone).toContain('G2 DISCONNECTED — captions on phone')
    expect(phone).not.toMatch(/beep|sound|audio cue/i)
  })
})
