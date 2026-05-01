import pino, { type Logger } from 'pino'

export type ServerLogger = Logger

/**
 * Server-side structured logger for the broker and Node CLI tools. Emits NDJSON
 * by default (production / CI / piped). When stdout is a TTY (interactive dev),
 * pino-pretty makes the output human-readable.
 *
 * Levels follow Pino's standard ladder: trace, debug, info, warn, error, fatal.
 *
 * Browser code MUST NOT import this module — Pino has Node-only dependencies
 * that don't tree-shake out of a Vite browser bundle. Use clientLogger.ts there.
 */
export function createServerLogger(name: string, level?: string): ServerLogger {
  const isTty = process.stdout.isTTY === true
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? 'info',
    base: { pid: process.pid },
    formatters: {
      level: (label) => ({ level: label }),
    },
    transport: isTty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        }
      : undefined,
  })
}
