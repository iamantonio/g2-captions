// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { CaptionView } from '../../src/app/captionView'
import type { CaptionSegment } from '../../src/types'

function makeSegment(overrides: Partial<CaptionSegment> = {}): CaptionSegment {
  return {
    id: 'A:0',
    speakerLabel: 'A',
    text: 'hello',
    status: 'partial',
    startMs: 0,
    endMs: 100,
    displayPriority: 0,
    ...overrides,
  }
}

function build() {
  document.body.replaceChildren()
  const list = document.createElement('ol')
  const emptyState = document.createElement('div')
  document.body.append(emptyState, list)
  const view = new CaptionView({ list, emptyState, documentImpl: document })
  return { list, emptyState, view }
}

describe('CaptionView', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('shows the empty state when there are no segments', () => {
    const { emptyState, view } = build()
    view.update([])
    expect(emptyState.hidden).toBe(false)
    expect(view.getRowCount()).toBe(0)
  })

  it('hides the empty state once a row mounts', () => {
    const { emptyState, view } = build()
    view.update([makeSegment()])
    expect(emptyState.hidden).toBe(true)
    expect(view.getRowCount()).toBe(1)
  })

  it('preserves the row DOM node when a partial mutates in place (DOM stability for CSS transitions)', () => {
    const { list, view } = build()
    view.update([makeSegment({ text: 'hello' })])
    const before = list.querySelector('li')
    view.update([makeSegment({ text: 'hello world' })])
    const after = list.querySelector('li')
    expect(before).toBe(after)
    expect(after?.querySelector('.caption-row__text')?.textContent).toBe('hello world')
  })

  it('flips partial → final by updating the row class without recreating the node', () => {
    const { list, view } = build()
    view.update([makeSegment({ status: 'partial' })])
    const row = list.querySelector('li')!
    expect(row.classList.contains('caption-row--partial')).toBe(true)
    view.update([makeSegment({ status: 'final' })])
    expect(row.classList.contains('caption-row--final')).toBe(true)
    expect(row.classList.contains('caption-row--partial')).toBe(false)
    expect(list.querySelector('li')).toBe(row)
  })

  it('appends a new row for a new segment id', () => {
    const { list, view } = build()
    view.update([makeSegment({ id: 'A:0', speakerLabel: 'A', startMs: 0 })])
    view.update([
      makeSegment({ id: 'A:0', speakerLabel: 'A', startMs: 0 }),
      makeSegment({ id: 'B:1000', speakerLabel: 'B', startMs: 1000, text: 'hi' }),
    ])
    const rows = list.querySelectorAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0].dataset.segmentId).toBe('A:0')
    expect(rows[1].dataset.segmentId).toBe('B:1000')
  })

  it('removes rows whose segments disappeared (state.clear() between sessions)', () => {
    const { list, view } = build()
    view.update([makeSegment({ id: 'A:0' })])
    expect(list.querySelectorAll('li')).toHaveLength(1)
    view.update([])
    expect(list.querySelectorAll('li')).toHaveLength(0)
    expect(view.getRowCount()).toBe(0)
  })

  it('migrates a row to a new speaker label without recreating the node (CaptionState unknown→known)', () => {
    const { list, view } = build()
    view.update([makeSegment({ id: '?:0', speakerLabel: '?', text: 'partial' })])
    const row = list.querySelector('li')
    view.update([makeSegment({ id: '?:0', speakerLabel: 'A', text: 'partial confirmed', status: 'final' })])
    const after = list.querySelector('li')
    expect(after).toBe(row)
    expect(after?.querySelector('.caption-row__speaker')?.textContent).toBe('A')
    expect(after?.querySelector('.caption-row__text')?.textContent).toBe('partial confirmed')
  })

  it('renders Deepgram numeric speaker labels as S1/S2/... (1-indexed for human readers)', () => {
    const { list, view } = build()
    view.update([
      makeSegment({ id: '0:0', speakerLabel: '0', startMs: 0 }),
      makeSegment({ id: '1:1000', speakerLabel: '1', startMs: 1000 }),
    ])
    const chips = list.querySelectorAll('.caption-row__speaker')
    expect(chips[0].textContent).toBe('S1')
    expect(chips[1].textContent).toBe('S2')
  })

  it('assigns deterministic chip color classes per speaker so the same speaker keeps the same color across a session', () => {
    const { list, view } = build()
    view.update([
      makeSegment({ id: '0:0', speakerLabel: '0', startMs: 0 }),
      makeSegment({ id: '1:1000', speakerLabel: '1', startMs: 1000 }),
      makeSegment({ id: '0:2000', speakerLabel: '0', startMs: 2000, text: 'b' }),
    ])
    const chips = list.querySelectorAll('.caption-row__speaker')
    expect(chips[0].classList.contains('speaker-n0')).toBe(true)
    expect(chips[1].classList.contains('speaker-n1')).toBe(true)
    expect(chips[2].classList.contains('speaker-n0')).toBe(true)
  })

  it('renders an unknown-speaker chip as · with the unknown class', () => {
    const { list, view } = build()
    view.update([makeSegment({ id: '?:0', speakerLabel: '?' })])
    const chip = list.querySelector('.caption-row__speaker')
    expect(chip?.textContent).toBe('·')
    expect(chip?.classList.contains('speaker-unknown')).toBe(true)
  })
})
