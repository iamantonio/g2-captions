import { describe, expect, it } from 'vitest'
import { CaptionState } from '../../src/captions/CaptionState'
import type { RawAsrEvent } from '../../src/types'

describe('CaptionState', () => {
  it('updates the same segment when partial text is revised and finalizes without duplicate lines', () => {
    const state = new CaptionState()
    const partial: RawAsrEvent = {
      vendor: 'fixture',
      text: 'we should move review',
      status: 'partial',
      startMs: 0,
      endMs: 900,
      speaker: 'A',
      receivedAtMs: 300,
    }
    const revised: RawAsrEvent = { ...partial, text: 'we should move the review', receivedAtMs: 420 }
    const final: RawAsrEvent = { ...revised, status: 'final', endMs: 1100, receivedAtMs: 600 }

    state.applyAsrEvent(partial)
    state.applyAsrEvent(revised)
    state.applyAsrEvent(final)

    expect(state.segments()).toHaveLength(1)
    expect(state.segments()[0]).toMatchObject({
      speakerLabel: 'A',
      text: 'we should move the review',
      status: 'final',
    })
  })

  it('uses a visible unknown-speaker marker when diarization is missing', () => {
    const state = new CaptionState()
    state.applyAsrEvent({
      vendor: 'fixture',
      text: 'can you repeat that',
      status: 'partial',
      startMs: 0,
      endMs: 800,
      receivedAtMs: 200,
    })

    expect(state.segments()[0].speakerLabel).toBe('?')
  })

  it('clears stale captions before a new smoke-test session starts', () => {
    const state = new CaptionState()
    state.applyAsrEvent({
      vendor: 'fixture',
      text: 'old stale line',
      status: 'final',
      startMs: 0,
      endMs: 800,
      receivedAtMs: 900,
    })

    state.clear()

    expect(state.segments()).toEqual([])
  })

  it('merges an unknown-speaker partial with a final diarized segment at the same start time', () => {
    const state = new CaptionState()
    state.applyAsrEvent({
      vendor: 'assemblyai',
      text: 'ProvenMachine—',
      status: 'partial',
      startMs: 0,
      endMs: 800,
      speaker: '?',
      receivedAtMs: 1500,
    })
    state.applyAsrEvent({
      vendor: 'assemblyai',
      text: 'ProvenMachine captions are ready.',
      status: 'final',
      startMs: 0,
      endMs: 1816,
      speaker: 'A',
      receivedAtMs: 3374,
    })

    expect(state.segments()).toHaveLength(1)
    expect(state.segments()[0]).toMatchObject({
      speakerLabel: 'A',
      text: 'ProvenMachine captions are ready.',
      status: 'final',
    })
  })
})
