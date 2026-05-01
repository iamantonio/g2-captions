import type { CaptionSegment } from '../types'

/**
 * Incremental caption-row renderer.
 *
 * The previous implementation tore down and rebuilt the entire DOM on
 * every partial transcript event. With Deepgram emitting partials at
 * ~1 Hz and the CaptionState mutating the same segment in place as words
 * stabilize, that meant the whole page reflowed (including the primary
 * button and status pill) several times per second — the user described
 * this as "all over the place".
 *
 * This module diffs segments against the previously-rendered rows:
 * - Existing segment id → mutate the row in place. CSS transitions fire
 *   on color/opacity/text-content changes (partial → final highlight).
 * - New segment id → append a new row (animates in via the `caption-row
 *   --enter` class).
 * - Removed segment id (e.g., state.clear()) → remove the row.
 *
 * The DOM node identities are preserved across updates, which is what
 * makes the caption surface feel calm. Speaker chips, button refs, the
 * status pill — none of those flicker.
 */

export interface CaptionViewOptions {
  list: HTMLElement
  emptyState: HTMLElement
  documentImpl: Document
}

export class CaptionView {
  /** Map from segment id (`speaker:startMs`) to the row that renders it. */
  private rows = new Map<string, CaptionRowState>()
  private readonly options: CaptionViewOptions

  constructor(options: CaptionViewOptions) {
    this.options = options
  }

  update(segments: CaptionSegment[]): void {
    if (segments.length === 0 && this.rows.size === 0) {
      this.options.emptyState.hidden = false
      return
    }
    this.options.emptyState.hidden = true

    const seenIds = new Set<string>()
    for (const segment of segments) {
      seenIds.add(segment.id)
      const existing = this.rows.get(segment.id)
      if (existing) {
        applyToRow(existing, segment)
      } else {
        const created = createRow(this.options.documentImpl, segment)
        this.rows.set(segment.id, created)
        this.options.list.append(created.element)
      }
    }

    // Remove rows whose segments no longer exist (state.clear() between
    // sessions, or speaker-id migrations from CaptionState).
    for (const [id, row] of this.rows) {
      if (!seenIds.has(id)) {
        row.element.remove()
        this.rows.delete(id)
      }
    }
  }

  /** Rendered for tests / hardware-smoke verification. */
  getRowCount(): number {
    return this.rows.size
  }
}

interface CaptionRowState {
  element: HTMLElement
  textNode: HTMLElement
  speakerChip: HTMLElement
  lastSpeaker: string
  lastText: string
  lastStatus: CaptionSegment['status']
}

function createRow(doc: Document, segment: CaptionSegment): CaptionRowState {
  const li = doc.createElement('li')
  li.className = `caption-row caption-row--${segment.status}`
  li.dataset.segmentId = segment.id

  const chip = doc.createElement('span')
  chip.className = `caption-row__speaker speaker-${classifyChip(segment.speakerLabel)}`
  chip.textContent = compactSpeaker(segment.speakerLabel)

  const text = doc.createElement('p')
  text.className = 'caption-row__text'
  text.textContent = segment.text

  li.append(chip, text)

  return {
    element: li,
    textNode: text,
    speakerChip: chip,
    lastSpeaker: segment.speakerLabel,
    lastText: segment.text,
    lastStatus: segment.status,
  }
}

function applyToRow(row: CaptionRowState, segment: CaptionSegment): void {
  if (row.lastText !== segment.text) {
    row.textNode.textContent = segment.text
    row.lastText = segment.text
  }
  if (row.lastStatus !== segment.status) {
    row.element.classList.remove(`caption-row--${row.lastStatus}`)
    row.element.classList.add(`caption-row--${segment.status}`)
    row.lastStatus = segment.status
  }
  if (row.lastSpeaker !== segment.speakerLabel) {
    row.speakerChip.classList.remove(`speaker-${classifyChip(row.lastSpeaker)}`)
    row.speakerChip.classList.add(`speaker-${classifyChip(segment.speakerLabel)}`)
    row.speakerChip.textContent = compactSpeaker(segment.speakerLabel)
    row.lastSpeaker = segment.speakerLabel
  }
}

/** Picks a stable color class per speaker so the same speaker always gets the same chip color across a session. */
function classifyChip(speakerLabel: string): string {
  const trimmed = speakerLabel.trim()
  if (trimmed === '?' || trimmed === '') return 'unknown'
  // Fold to lowercase letters/digits so 'A' and 'a' share a color, 'S1' and '1' share a color.
  const normalized = trimmed.replace(/^s/i, '').toLowerCase()
  return /^[0-9]+$/.test(normalized) ? `n${normalized}` : `l${normalized.replace(/[^a-z0-9]/g, '')}`
}

/** Speaker chip label — short and readable. Numeric Deepgram labels become S1/S2/...; alphabetic labels stay as-is. */
function compactSpeaker(speakerLabel: string): string {
  const trimmed = speakerLabel.trim()
  if (trimmed === '?' || trimmed === '') return '·'
  if (/^[0-9]+$/.test(trimmed)) return `S${Number.parseInt(trimmed, 10) + 1}`
  if (/^s\d+$/i.test(trimmed)) return trimmed.toUpperCase()
  return trimmed.toUpperCase()
}
