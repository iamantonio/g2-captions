import {
  createBenchmarkTelemetryRecorder,
  type BenchmarkTelemetryDetails,
  type BenchmarkTelemetryRecorder,
  type BenchmarkTelemetryReport,
  type BenchmarkTelemetryStage,
} from '../captions/latency'

export interface TelemetryReporterOptions {
  provider?: string
  recorderFactory?: (options: { provider: string; fixtureId: string }) => BenchmarkTelemetryRecorder
}

/**
 * Owns the lifecycle of the per-session BenchmarkTelemetryRecorder. The
 * recorder is recreated on every `start()` so each ASR session has its own
 * timeline. `mark()` is a no-op when no session has been started — keeps
 * call sites free of null-checks.
 */
export class TelemetryReporter {
  private recorder: BenchmarkTelemetryRecorder | undefined
  private readonly provider: string
  private readonly recorderFactory: NonNullable<TelemetryReporterOptions['recorderFactory']>

  constructor(options: TelemetryReporterOptions = {}) {
    this.provider = options.provider ?? 'deepgram'
    this.recorderFactory = options.recorderFactory ?? createBenchmarkTelemetryRecorder
  }

  start(fixtureId: string): void {
    this.recorder = this.recorderFactory({ provider: this.provider, fixtureId })
  }

  mark(stage: BenchmarkTelemetryStage, details?: BenchmarkTelemetryDetails): void {
    this.recorder?.mark(stage, details)
  }

  report(): BenchmarkTelemetryReport | undefined {
    if (!this.recorder) return undefined
    const r = this.recorder.report()
    return r.events.length === 0 ? undefined : r
  }

  isStarted(): boolean {
    return this.recorder !== undefined
  }

  reset(): void {
    this.recorder = undefined
  }
}
