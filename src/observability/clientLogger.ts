/**
 * Browser-side structured logger for the WebView. Mirrors the pino server-side
 * shape so the broker can ingest /client-log entries uniformly. No Node deps —
 * safe to bundle for the WebView.
 */
export type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface ClientLogEntry {
  level: ClientLogLevel
  stage: string
  details?: Record<string, unknown>
  href?: string
  at: string
}

export interface ClientLogger {
  stage(stage: string, details?: Record<string, unknown>): void
  warn(stage: string, details?: Record<string, unknown>): void
  error(stage: string, err: unknown, details?: Record<string, unknown>): void
}

export interface CreateClientLoggerOptions {
  endpoint: string
  href: string
  consoleImpl?: Pick<Console, 'info' | 'warn' | 'error'>
  fetchImpl?: typeof fetch
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { value: String(err) }
}

export function createClientLogger(options: CreateClientLoggerOptions): ClientLogger {
  const consoleImpl = options.consoleImpl ?? globalThis.console
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)

  function emit(level: ClientLogLevel, stage: string, details?: Record<string, unknown>): void {
    const entry: ClientLogEntry = {
      level,
      stage,
      ...(details === undefined ? {} : { details }),
      href: options.href,
      at: new Date().toISOString(),
    }
    const consoleMethod =
      level === 'error' || level === 'fatal'
        ? consoleImpl.error
        : level === 'warn'
          ? consoleImpl.warn
          : consoleImpl.info
    consoleMethod.call(consoleImpl, `[g2-captions] ${stage}`, entry)
    void fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => undefined)
  }

  return {
    stage(stage, details) {
      emit('info', stage, details)
    },
    warn(stage, details) {
      emit('warn', stage, details)
    },
    error(stage, err, details) {
      emit('error', stage, { ...(details ?? {}), err: serializeError(err) })
    },
  }
}
