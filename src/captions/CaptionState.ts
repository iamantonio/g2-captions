import type { CaptionSegment, RawAsrEvent } from '../types'

const UNKNOWN_SPEAKER = '?'

function keyFor(speaker: string, startMs: number): string {
  return `${speaker}:${startMs}`
}

export class CaptionState {
  // Composite-keyed by speaker:startMs so two distinct known speakers at the
  // same start time produce two segments. The unknown-speaker partial is
  // migrated onto a known-speaker key once diarization arrives.
  private readonly bySpeakerStart = new Map<string, CaptionSegment>()

  applyAsrEvent(event: RawAsrEvent): CaptionSegment {
    const incomingSpeaker = event.speaker?.trim() || UNKNOWN_SPEAKER

    let existingKey: string | undefined
    let existing: CaptionSegment | undefined
    const incomingKey = keyFor(incomingSpeaker, event.startMs)
    const unknownKey = keyFor(UNKNOWN_SPEAKER, event.startMs)

    if (this.bySpeakerStart.has(incomingKey)) {
      existingKey = incomingKey
      existing = this.bySpeakerStart.get(incomingKey)
    } else if (incomingSpeaker !== UNKNOWN_SPEAKER && this.bySpeakerStart.has(unknownKey)) {
      // Migrate an earlier unknown-speaker partial onto the known-speaker key.
      existing = this.bySpeakerStart.get(unknownKey)
      this.bySpeakerStart.delete(unknownKey)
      existingKey = incomingKey
    } else if (incomingSpeaker === UNKNOWN_SPEAKER) {
      // A late unknown-speaker partial after a known-speaker segment exists at
      // the same startMs: update the known segment in place. Don't downgrade
      // its label to '?'.
      for (const [key, segment] of this.bySpeakerStart) {
        if (segment.startMs === event.startMs) {
          existing = segment
          existingKey = key
          break
        }
      }
    }

    const speakerLabel =
      existing && existing.speakerLabel !== UNKNOWN_SPEAKER && incomingSpeaker === UNKNOWN_SPEAKER
        ? existing.speakerLabel
        : incomingSpeaker
    const finalKey = existingKey ?? keyFor(speakerLabel, event.startMs)

    const segment: CaptionSegment = {
      id: finalKey,
      speakerLabel,
      text: event.text,
      status: event.status === 'final' ? 'final' : 'partial',
      startMs: event.startMs,
      endMs: event.endMs,
      displayPriority: event.startMs,
    }

    if (existing) {
      Object.assign(existing, segment)
      this.bySpeakerStart.set(finalKey, existing)
      return existing
    }

    this.bySpeakerStart.set(finalKey, segment)
    return segment
  }

  segments(): CaptionSegment[] {
    return [...this.bySpeakerStart.values()].sort((a, b) => a.startMs - b.startMs)
  }

  clear(): void {
    this.bySpeakerStart.clear()
  }
}
