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
  const footer = formatFooter(options.status)
  const bodyLineCount = Math.max(0, options.maxLines - 2)
  const bodyLines = selectRecentCaptionLines(segments, options.lineWidth, bodyLineCount)
  const lines = [header, ...bodyLines, footer].slice(0, options.maxLines)
  return { lines, text: lines.join('\n') }
}

function formatHeader(title: string, latencyMs?: number): string {
  if (latencyMs === undefined) return title
  return `${title.padEnd(18, ' ')}LIVE ${latencyMs}ms`
}

function formatFooter(status: string): string {
  const trimmed = status.trim()
  // Patterns accept ASCII hyphen, en-dash, em-dash to decouple matching from
  // any upstream dash-normalization step.
  const statusMap: Array<[RegExp, string]> = [
    [/^G2 MIC LIVE/i, 'LIVE G2 MIC'],
    [/^BROWSER MIC LIVE/i, 'LIVE PHONE MIC'],
    [/^ASR CONNECTED/i, 'ASR READY'],
    [/^CONNECTING\s+[\u2013\u2014-]\s*token/i, 'TOKEN...'],
    [/^CONNECTING\s+[\u2013\u2014-]\s*ASR/i, 'ASR CONNECTING'],
    [/^G2 MIC STARTING/i, 'G2 MIC STARTING'],
    [/^G2 MIC FAILED/i, 'G2 MIC FAILED'],
    [/^G2 MIC STOPPED/i, 'G2 MIC STOPPED'],
    [/^AUDIO FIXTURE STREAMING/i, 'FIXTURE STREAMING'],
    [/^AUDIO FIXTURE SENT/i, 'FIXTURE SENT'],
    [/^SMOKE COMPLETE/i, 'SMOKE OK'],
    [/^ASR TERMINATED/i, 'ASR OFF'],
    [/^CAPTIONS PAUSED/i, 'PAUSED'],
    [/^G2 MIC PAUSED/i, 'PAUSED'],
    [/^BROWSER MIC PAUSED/i, 'PAUSED'],
  ]

  for (const [pattern, label] of statusMap) {
    if (pattern.test(trimmed)) return label
  }

  // Fallback path normalizes Unicode dashes to ASCII for the lens display.
  const ascii = trimmed.replace(/[\u2013\u2014]/g, '-')
  return ascii.length <= 34 ? ascii : `${ascii.slice(0, 31)}...`
}

function selectRecentCaptionLines(segments: CaptionSegment[], width: number, maxLines: number): string[] {
  if (maxLines <= 0) return []

  const chronologicalSegments = [...segments].sort(
    (a, b) => a.displayPriority - b.displayPriority || a.startMs - b.startMs,
  )
  const selected: string[] = []

  for (let i = chronologicalSegments.length - 1; i >= 0; i -= 1) {
    const lines = wrapSegment(chronologicalSegments[i], width)
    if (lines.length > maxLines) {
      selected.unshift(...lines.slice(-maxLines))
      break
    }
    if (selected.length + lines.length > maxLines) break
    selected.unshift(...lines)
  }

  return selected
}

function wrapSegment(segment: CaptionSegment, width: number): string[] {
  const speaker = formatSpeakerChip(segment.speakerLabel)
  const partial = segment.status === 'partial' ? '*' : ''
  const prefix = `${speaker}${partial} `
  const continuationPrefix = ' '.repeat(prefix.length)
  const contentWidth = Math.max(1, width - prefix.length)
  const words = segment.text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  let currentPrefix = prefix

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (`${current} ${word}`.length <= contentWidth) {
      current = `${current} ${word}`
      continue
    }
    lines.push(`${currentPrefix}${current}`)
    current = word
    currentPrefix = continuationPrefix
  }

  if (current) lines.push(`${currentPrefix}${current}`)
  if (lines.length === 0) lines.push(prefix.trimEnd())
  return lines
}

function formatSpeakerChip(label: string): string {
  const trimmed = label.trim().toUpperCase()
  if (!trimmed || trimmed === '?') return '[??]'
  // Single letter (AssemblyAI-style A, B, C, …): use the letter directly so
  // a letter-labelled speaker never collides with a numeric one (e.g. A vs 0).
  if (/^[A-Z]$/.test(trimmed)) return `[${trimmed}]`
  // Already-formatted S<n>: pass through.
  if (/^S\d+$/.test(trimmed)) return `[${trimmed}]`
  // Vendor-numeric (Deepgram-style 0, 1, 2, …): show as S1, S2, … (1-indexed
  // for the human reader; 0-indexed in the wire format).
  if (/^\d+$/.test(trimmed)) return `[S${Number(trimmed) + 1}]`
  return `[${trimmed.slice(0, 4)}]`
}
