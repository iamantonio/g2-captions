import { describe, expect, it } from 'vitest'
import {
  buildHardwareReadinessChecklist,
  buildHardwareSmokeUrls,
  formatHardwareReadinessReport,
  isPrivateLanIp,
} from '../../src/hardware/readiness'

describe('hardware readiness helpers', () => {
  it('builds LAN-safe smoke URLs from a private IP', () => {
    const urls = buildHardwareSmokeUrls('192.168.1.42')

    expect(urls.viteUrl).toBe('http://192.168.1.42:5173')
    expect(urls.tokenBrokerUrl).toBe('http://192.168.1.42:8787/deepgram/token')
    expect(urls.qrCommand).toBe('evenhub qr --url "http://192.168.1.42:5173?autoSmoke=1"')
  })

  it('flags public or loopback addresses as not hardware reachable', () => {
    expect(isPrivateLanIp('127.0.0.1')).toBe(false)
    expect(isPrivateLanIp('8.8.8.8')).toBe(false)
    expect(isPrivateLanIp('10.0.0.9')).toBe(true)
    expect(isPrivateLanIp('172.20.10.5')).toBe(true)
    expect(isPrivateLanIp('192.168.86.20')).toBe(true)
  })

  it('keeps smoke checklist visual and explicit', () => {
    const checklist = buildHardwareReadinessChecklist('10.0.0.9')

    expect(checklist.requiredVisualStates).toContain('G2 MIC FAILED — bridge unavailable')
    expect(checklist.requiredVisualStates).toContain('G2 MIC LIVE — captions streaming')
    expect(checklist.commands.some((command) => command.includes('HOST=0.0.0.0 npm run token-broker'))).toBe(true)
    expect(checklist.manualObservations).toContain('whether audioEvent.audioPcm arrives continuously')
  })

  it('formats a report without leaking token values', () => {
    const report = formatHardwareReadinessReport(buildHardwareReadinessChecklist('10.0.0.9'))

    expect(report).toContain('Hardware readiness smoke')
    expect(report).toContain('token_present')
    expect(report).not.toMatch(/raw token values.*[A-Za-z0-9_-]{20,}/)
  })
})
