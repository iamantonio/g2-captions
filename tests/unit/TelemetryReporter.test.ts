import { describe, expect, it, vi } from 'vitest'
import type { BenchmarkTelemetryRecorder } from '../../src/captions/latency'
import { TelemetryReporter } from '../../src/app/TelemetryReporter'

function makeFakeRecorder(): BenchmarkTelemetryRecorder & {
  mark: ReturnType<typeof vi.fn>
  report: ReturnType<typeof vi.fn>
} {
  return {
    mark: vi.fn(),
    report: vi.fn(() => ({
      provider: 'deepgram',
      fixtureId: 'test',
      startedAtMs: 0,
      events: [],
      metrics: {},
    })),
  }
}

describe('TelemetryReporter', () => {
  it('does not emit a recorder before start() so the panel stays hidden', () => {
    const reporter = new TelemetryReporter()
    expect(reporter.isStarted()).toBe(false)
    expect(reporter.report()).toBeUndefined()
    // mark() before start() must be a no-op, never throw.
    reporter.mark('first_audio_chunk_sent', { seq: 1 })
  })

  it('forwards mark() calls to the recorder created by start()', () => {
    const fake = makeFakeRecorder()
    const reporter = new TelemetryReporter({ recorderFactory: () => fake })
    reporter.start('speech-smoke')
    reporter.mark('first_audio_chunk_sent', { seq: 1 })
    reporter.mark('display_update_sent')

    expect(fake.mark).toHaveBeenNthCalledWith(1, 'first_audio_chunk_sent', { seq: 1 })
    expect(fake.mark).toHaveBeenNthCalledWith(2, 'display_update_sent', undefined)
    expect(reporter.isStarted()).toBe(true)
  })

  it('passes provider and fixtureId through to the recorder factory', () => {
    const factory = vi.fn((_args: { provider: string; fixtureId: string }) => makeFakeRecorder())
    const reporter = new TelemetryReporter({ provider: 'assemblyai', recorderFactory: factory })
    reporter.start('browser-mic')
    expect(factory).toHaveBeenCalledWith({ provider: 'assemblyai', fixtureId: 'browser-mic' })
  })

  it('returns undefined from report() when the recorder has no events', () => {
    const fake = makeFakeRecorder()
    fake.report.mockReturnValue({
      provider: 'deepgram',
      fixtureId: 'test',
      startedAtMs: 0,
      events: [],
      metrics: {},
    })
    const reporter = new TelemetryReporter({ recorderFactory: () => fake })
    reporter.start('test')
    expect(reporter.report()).toBeUndefined()
  })

  it('returns the recorder report when at least one event has been marked', () => {
    const fake = makeFakeRecorder()
    fake.report.mockReturnValue({
      provider: 'deepgram',
      fixtureId: 'test',
      startedAtMs: 100,
      events: [{ stage: 'first_audio_chunk_sent', atMs: 100 }],
      metrics: {},
    })
    const reporter = new TelemetryReporter({ recorderFactory: () => fake })
    reporter.start('test')
    const report = reporter.report()
    expect(report?.events).toHaveLength(1)
    expect(report?.events[0].stage).toBe('first_audio_chunk_sent')
  })

  it('replaces the recorder on subsequent start() so each ASR session has its own timeline', () => {
    const factory = vi.fn((_args: { provider: string; fixtureId: string }) => makeFakeRecorder())
    const reporter = new TelemetryReporter({ recorderFactory: factory })
    reporter.start('first')
    reporter.start('second')
    expect(factory).toHaveBeenCalledTimes(2)
    expect(factory.mock.calls[0][0]).toEqual({ provider: 'deepgram', fixtureId: 'first' })
    expect(factory.mock.calls[1][0]).toEqual({ provider: 'deepgram', fixtureId: 'second' })
  })

  it('reset() clears the recorder so report() returns undefined again', () => {
    const reporter = new TelemetryReporter({ recorderFactory: makeFakeRecorder })
    reporter.start('test')
    expect(reporter.isStarted()).toBe(true)
    reporter.reset()
    expect(reporter.isStarted()).toBe(false)
    expect(reporter.report()).toBeUndefined()
  })
})
