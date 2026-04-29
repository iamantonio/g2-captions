import type { CaptionSegment } from '../types'

export function renderPhonePreview(segments: CaptionSegment[]): string {
  return segments
    .sort((a, b) => a.displayPriority - b.displayPriority || a.startMs - b.startMs)
    .map((segment) => `${segment.speakerLabel}: ${segment.text}`)
    .join('\n')
}
