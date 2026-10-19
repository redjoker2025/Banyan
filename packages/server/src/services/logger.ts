import type { LoggerService } from '@banyan/core'

/** Minimal structured logger; swap for something fancier later if needed. */
export class LoggerServiceImpl implements LoggerService {
  private emit(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, unknown>) {
    const line = `[banyan] ${new Date().toISOString()} ${level.toUpperCase()} ${message}`
    if (meta && Object.keys(meta).length > 0) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](line, JSON.stringify(meta))
    } else {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](line)
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta)
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta)
  }
}
