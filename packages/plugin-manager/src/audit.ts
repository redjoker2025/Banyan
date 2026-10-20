import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AuditEntry {
  ts: number
  pluginId: string
  /** capability that was invoked, e.g. "vault.read" / "net.fetch" */
  action: string
  /** what the call required, e.g. the path or the domain */
  required: string
  detail?: string
}

/**
 * Append-only security audit log at `<vault>/.banyan/audit.jsonl` (§4.3).
 * Records permission denials (and other security-relevant events).
 */
export class AuditLog {
  constructor(private readonly file: string) {}

  append(entry: Omit<AuditEntry, 'ts'>): void {
    const line = JSON.stringify({ ts: Date.now(), ...entry } satisfies AuditEntry)
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${line}\n`, 'utf8')
  }

  read(): AuditEntry[] {
    try {
      return (readFileOrEmpty(this.file) as string)
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AuditEntry)
    } catch {
      return []
    }
  }
}

import { readFileSync } from 'node:fs'
function readFileOrEmpty(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
