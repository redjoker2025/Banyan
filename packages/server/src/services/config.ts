import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConfigService } from '@banyan/core'

/**
 * User configuration persisted as `<vault>/.banyan/config.json`.
 * Writes are atomic (tmp file + rename) to survive crashes mid-write.
 */
export class ConfigServiceImpl implements ConfigService {
  private data: Record<string, unknown>

  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      this.data = {}
    }
  }

  get<T = unknown>(key: string): Promise<T | undefined>
  get<T>(key: string, fallback: T): Promise<T>
  async get<T>(key: string, fallback?: T): Promise<T | undefined> {
    const value = this.data[key]
    return value === undefined ? fallback : (value as T)
  }

  async set(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key]
    } else {
      this.data[key] = value
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  /** synchronous snapshot for server-internal reads (token etc.) */
  peek<T>(key: string): T | undefined {
    return this.data[key] as T | undefined
  }
}
