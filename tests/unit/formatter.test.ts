import { describe, expect, it } from 'vitest'
import { formatCaptionFrame, formatVisualStatus } from '../../src/captions/formatter'
import type { CaptionSegment } from '../../src/types'

describe('formatCaptionFrame', () => {
  it('wraps speaker-labeled captions into a 576x288 lens-safe frame with persistent status row', () => {
    const segments: CaptionSegment[] = [
      {
        id: 's1',
        speakerLabel: 'A',
        text: 'we should move the review to Friday morning',
        status: 'final',
        startMs: 0,
        endMs: 1200,
        displayPriority: 1,
      },
      {
        id: 's2',
        speakerLabel: 'B',
        text: 'Friday works if the deck is ready by Thursday night',
        status: 'partial',
        startMs: 1300,
        endMs: 2500,
        displayPriority: 2,
      },
    ]

    const frame = formatCaptionFrame(segments, {
      title: 'G2 CAPTIONS',
      status: 'NET OK  MIC G2  ASR AAI',
      maxLines: 6,
      lineWidth: 28,
      showLiveLatencyMs: 143,
    })

    expect(frame.lines).toEqual([
      'G2 CAPTIONS       LIVE 143ms',
      'A: we should move the review',
      '   to Friday morning',
      'B: Friday works if the deck',
      '   is ready by Thursday night',
      'NET OK  MIC G2  ASR AAI',
    ])
    expect(frame.text).toContain('A:')
    expect(frame.text).toContain('B:')
    expect(frame.text).toContain('NET OK')
  })

  it('shows visual error text instead of audio-only failure cues', () => {
    expect(formatVisualStatus({ kind: 'mic-blocked' })).toBe('MIC BLOCKED — check permission')
    expect(formatVisualStatus({ kind: 'g2-disconnected' })).toBe('G2 DISCONNECTED — captions on phone')
    expect(formatVisualStatus({ kind: 'network-slow' })).toBe('NETWORK SLOW — offline captions')
  })
})
