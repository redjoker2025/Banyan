import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

export type JournalType = 'created' | 'updated' | 'deleted'

export interface JournalEntry {
  ts: number
  type: JournalType
  path: string
  hash?: string
}

/**
 * Append-only event log at `<vault>/.banyan/journal.jsonl` (§4.3).
 * Every line: `{ts, type, path, hash}`.
 */
export class Journal {
  constructor(private readonly file: string) {}

  append(type: JournalType, rel: string, hash?: string): void {
    const entry: JournalEntry = { ts: Date.now(), type, path: rel, ...(hash ? { hash } : {}) }
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  static hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }
}
