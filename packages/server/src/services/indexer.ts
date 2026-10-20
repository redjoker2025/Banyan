import { mkdirSync } from 'node:fs'
import * as nodePath from 'node:path'
import Database from 'better-sqlite3'
import matter from 'gray-matter'
import type { IndexService, SearchHit } from '@banyan/core'
import { VaultServiceImpl } from './vault.ts'

export interface ParsedNote {
  title: string
  body: string
}

/** Extract title (frontmatter → first heading → filename) and body for indexing. */
export function parseNote(content: string, rel: string): ParsedNote {
  let parsed: { data: Record<string, unknown>; content: string }
  try {
    parsed = matter(content)
  } catch {
    parsed = { data: {}, content }
  }
  const base = rel.split('/').pop()!.replace(/\.md$/i, '')
  const fmTitle = typeof parsed.data?.title === 'string' ? parsed.data.title.trim() : ''
  const heading = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return { title: fmTitle || heading || base, body: parsed.content }
}

/** Extract the frontmatter `tags` field (inline list or YAML block list). */
export function parseFrontmatterTags(content: string): string[] {
  let data: Record<string, unknown>
  try {
    data = matter(content).data
  } catch {
    return []
  }
  const raw = data?.tags
  if (typeof raw === 'string') {
    return raw.split(',').map((t) => t.trim()).filter(Boolean)
  }
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean)
  }
  return []
}

interface IndexRow {
  path: string
  title: string
  snippet: string | null
}

/**
 * SQLite + FTS5 index at `<vault>/.banyan/index.db` (§4.3).
 * The index is always a derivative of the vault folder: `rebuild()` can
 * reconstruct it from scratch at any time.
 *
 * Tokenizer: `trigram` — enables substring matching, which works for CJK
 * text where the default `unicode61` tokenizer would treat whole CJK runs
 * as single tokens. Queries shorter than 3 characters fall back to LIKE
 * (trigram needs at least 3 characters).
 */
export class IndexServiceImpl implements IndexService {
  private db: Database.Database

  constructor(
    dbPath: string,
    private readonly vault: VaultServiceImpl,
  ) {
    mkdirSync(nodePath.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initSchema()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        mtime INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED, title, body, tokenize='trigram'
      );
    `)
  }

  upsert(rel: string, title: string, body: string, mtime: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO notes (path, title, body, mtime) VALUES (?, ?, ?, ?)
           ON CONFLICT (path) DO UPDATE SET title = excluded.title, body = excluded.body, mtime = excluded.mtime`,
        )
        .run(rel, title, body, Math.round(mtime))
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(rel)
      this.db.prepare('INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)').run(rel, title, body)
    })
    tx()
  }

  remove(rel: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(rel)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(rel)
    })
    tx()
  }

  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim()
    if (!q) return []
    let paths: string[] = []
    try {
      if (q.length >= 3) {
        // trigram phrase → substring semantics, works for CJK and Latin
        const phrase = `"${q.replaceAll('"', '""')}"`
        paths = (
          this.db.prepare('SELECT path FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT 50').all(phrase) as Array<{ path: string }>
        ).map((r) => r.path)
      }
    } catch {
      // malformed query → fall through to LIKE
      paths = []
    }
    if (paths.length === 0) {
      const like = `%${q.replaceAll(/[%_]/g, (ch) => `\\${ch}`)}%`
      paths = (
        this.db
          .prepare(
            `SELECT path FROM notes
             WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
             ORDER BY mtime DESC LIMIT 50`,
          )
          .all(like, like) as Array<{ path: string }>
      ).map((r) => r.path)
    }
    // FTS5 snippet() scans the whole matched document and becomes extremely
    // slow on large notes (measured: 72s on a 420k-char CJK body), so snippets
    // are built in JS from the stored body instead (measured: ~33ms).
    const stmt = this.db.prepare('SELECT title, body FROM notes WHERE path = ?')
    const lowerQ = q.toLowerCase()
    return paths.map((p) => {
      const row = stmt.get(p) as { title: string; body: string } | undefined
      if (!row) return { path: p, title: p }
      const idx = row.body.toLowerCase().indexOf(lowerQ)
      let snippet: string | undefined
      if (idx >= 0) {
        const start = Math.max(0, idx - 24)
        const end = Math.min(row.body.length, idx + q.length + 40)
        const head = start > 0 ? '…' : ''
        const tail = end < row.body.length ? '…' : ''
        snippet = `${head}${row.body.slice(start, idx)}[${row.body.slice(idx, idx + q.length)}]${row.body.slice(idx + q.length, end)}${tail}`
      }
      return { path: p, title: row.title, snippet }
    })
  }

  /** true when the index holds no notes (fresh or wiped index.db) */
  isEmpty(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }
    return row.c === 0
  }

  /** full rebuild from the vault folder; the index is always a derivative */
  async rebuild(): Promise<void> {
    const files = (await this.vault.list()).filter((e) => e.type === 'file')
    const clear = this.db.transaction(() => {
      this.db.exec('DELETE FROM notes; DELETE FROM notes_fts;')
    })
    clear()
    for (const file of files) {
      const content = await this.vault.read(file.path)
      const { title, body } = parseNote(content, file.path)
      const mtime = await this.vault.mtime(file.path)
      this.upsert(file.path, title, body, mtime)
    }
  }

  close(): void {
    this.db.close()
  }
}
