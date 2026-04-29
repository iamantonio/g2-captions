import type { CaptionSegment, VisualStatusKind } from '../types'
import { formatVisualStatus } from './formatter'

export function createVisualErrorSegment(kind: VisualStatusKind, atMs: number): CaptionSegment {
  return {
    id: `error:${kind}:${atMs}`,
    speakerLabel: '!',
    text: formatVisualStatus({ kind }),
    status: 'error',
    startMs: atMs,
    endMs: atMs,
    displayPriority: Number.MAX_SAFE_INTEGER,
  }
}
