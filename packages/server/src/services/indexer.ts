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
    try {
      if (q.length >= 3) {
        // trigram phrase → substring semantics, works for CJK and Latin
        const phrase = `"${q.replaceAll('"', '""')}"`
        const rows = this.db
          .prepare(
            `SELECT f.path AS path, n.title AS title,
                    snippet(notes_fts, 2, '[', ']', '…', 16) AS snippet
             FROM notes_fts f
             JOIN notes n ON n.path = f.path
             WHERE notes_fts MATCH ?
             ORDER BY rank LIMIT 50`,
          )
          .all(phrase) as IndexRow[]
        return rows.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet ?? undefined }))
      }
    } catch {
      // fall through to LIKE on malformed queries
    }
    const like = `%${q.replaceAll(/[%_]/g, (ch) => `\\${ch}`)}%`
    const rows = this.db
      .prepare(
        `SELECT path, title, NULL AS snippet FROM notes
         WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
         ORDER BY mtime DESC LIMIT 50`,
      )
      .all(like, like) as IndexRow[]
    return rows.map((r) => ({ path: r.path, title: r.title }))
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
