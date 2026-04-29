import type { CaptionSegment, RawAsrEvent } from '../types'

export class CaptionState {
  private readonly byStartSpeaker = new Map<string, CaptionSegment>()

  applyAsrEvent(event: RawAsrEvent): CaptionSegment {
    const speakerLabel = event.speaker?.trim() || '?'
    const id = `${event.startMs}`
    const existing = this.byStartSpeaker.get(id)
    const segment: CaptionSegment = {
      id,
      speakerLabel,
      text: event.text,
      status: event.status === 'final' ? 'final' : 'partial',
      startMs: event.startMs,
      endMs: event.endMs,
      displayPriority: event.startMs,
    }

    if (existing) {
      Object.assign(existing, segment)
      return existing
    }

    this.byStartSpeaker.set(id, segment)
    return segment
  }

  segments(): CaptionSegment[] {
    return [...this.byStartSpeaker.values()].sort((a, b) => a.startMs - b.startMs)
  }

  clear(): void {
    this.byStartSpeaker.clear()
  }
}
