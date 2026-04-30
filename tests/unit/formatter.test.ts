import { describe, expect, it } from 'vitest'
import { formatCaptionFrame, formatVisualStatus } from '../../src/captions/formatter'
import type { CaptionSegment } from '../../src/types'

describe('formatCaptionFrame', () => {
  it('renders a cleaner glasses frame with compact speaker chips and status footer', () => {
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
      status: 'G2 MIC LIVE — captions streaming',
      maxLines: 6,
      lineWidth: 34,
      showLiveLatencyMs: 143,
    })

    expect(frame.lines).toEqual([
      'G2 CAPTIONS       LIVE 143ms',
      '[S1] we should move the review to',
      '     Friday morning',
      '[S2]* Friday works if the deck is',
      '      ready by Thursday night',
      'LIVE G2 MIC',
    ])
    expect(frame.text).toContain('[S1]')
    expect(frame.text).toContain('[S2]*')
    expect(frame.text).toContain('LIVE G2 MIC')
  })

  it('uses an unknown-speaker chip while diarization is still unavailable', () => {
    const frame = formatCaptionFrame(
      [
        {
          id: 's1',
          speakerLabel: '?',
          text: 'this is working',
          status: 'partial',
          startMs: 0,
          endMs: 800,
          displayPriority: 1,
        },
      ],
      {
        title: 'G2 CAPTIONS',
        status: 'ASR CONNECTED — waiting audio',
        maxLines: 4,
        lineWidth: 28,
      },
    )

    expect(frame.lines).toEqual(['G2 CAPTIONS', '[??]* this is working', 'ASR READY'])
  })

  it('normalizes zero-based provider speaker numbers into human speaker chips', () => {
    const frame = formatCaptionFrame(
      [
        {
          id: 'deepgram-0',
          speakerLabel: '0',
          text: 'Deepgram numbers its first speaker from zero.',
          status: 'final',
          startMs: 0,
          endMs: 1000,
          displayPriority: 1,
        },
      ],
      {
        title: 'G2 CAPTIONS',
        status: 'ASR CONNECTED — waiting audio',
        maxLines: 4,
        lineWidth: 34,
      },
    )

    expect(frame.text).toContain('[S1] Deepgram numbers its')
  })

  it('shows visual error text instead of audio-only failure cues', () => {
    expect(formatVisualStatus({ kind: 'mic-blocked' })).toBe('MIC BLOCKED — check permission')
    expect(formatVisualStatus({ kind: 'g2-disconnected' })).toBe('G2 DISCONNECTED — captions on phone')
    expect(formatVisualStatus({ kind: 'network-slow' })).toBe('NETWORK SLOW — offline captions')
  })
})
