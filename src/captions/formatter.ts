import type { CaptionSegment, VisualStatusKind } from '../types'

export interface CaptionFrameOptions {
  title: string
  status: string
  maxLines: number
  lineWidth: number
  showLiveLatencyMs?: number
}

export interface CaptionFrame {
  lines: string[]
  text: string
}

export function formatVisualStatus(input: { kind: VisualStatusKind; count?: number }): string {
  switch (input.kind) {
    case 'mic-blocked':
      return 'MIC BLOCKED — check permission'
    case 'g2-disconnected':
      return 'G2 DISCONNECTED — captions on phone'
    case 'network-slow':
      return 'NETWORK SLOW — offline captions'
    case 'g2-mic-lost':
      return 'G2 MIC LOST — using phone mic'
    case 'asr-lost':
      return 'ASR LOST — reconnecting'
    case 'vocab-loaded':
      return `VOCAB LOADED — ${input.count ?? 0} terms`
  }
}

export function formatCaptionFrame(segments: CaptionSegment[], options: CaptionFrameOptions): CaptionFrame {
  const header = formatHeader(options.title, options.showLiveLatencyMs)
  const bodyLineCount = Math.max(0, options.maxLines - 2)
  const bodyLines = segments
    .sort((a, b) => a.displayPriority - b.displayPriority || a.startMs - b.startMs)
    .flatMap((segment) => wrapSegment(segment, options.lineWidth))
    .slice(-bodyLineCount)
  const lines = [header, ...bodyLines, options.status].slice(0, options.maxLines)
  return { lines, text: lines.join('\n') }
}

function formatHeader(title: string, latencyMs?: number): string {
  if (latencyMs === undefined) return title
  return `${title.padEnd(18, ' ')}LIVE ${latencyMs}ms`
}

function wrapSegment(segment: CaptionSegment, width: number): string[] {
  const prefix = `${segment.speakerLabel || '?'}: `
  const continuationPrefix = ' '.repeat(prefix.length)
  const firstWidth = Math.max(1, width - prefix.length)
  const continuationWidth = width
  const words = segment.text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  let currentWidth = firstWidth
  let currentPrefix = prefix

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (`${current} ${word}`.length <= currentWidth) {
      current = `${current} ${word}`
      continue
    }
    lines.push(`${currentPrefix}${current}`)
    current = word
    currentPrefix = continuationPrefix
    currentWidth = continuationWidth
  }

  if (current) lines.push(`${currentPrefix}${current}`)
  if (lines.length === 0) lines.push(`${prefix}`.trimEnd())
  return lines
}
