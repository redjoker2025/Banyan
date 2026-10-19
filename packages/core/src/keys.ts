/**
 * ctx key 契约 v0 (§4.2).
 *
 * These interfaces describe the services exposed on the Cordis context.
 * Plugins must look services up by key (`ctx.vault`, `ctx.index`, ...)
 * and MUST NOT import other plugins' implementations directly.
 */

import type { Context } from '@cordisjs/core'

declare module '@cordisjs/core' {
  interface Context {
    /** note read/write restricted to the vault path whitelist */
    vault: VaultService
    /** FTS5 full-text search over titles + bodies */
    index: IndexService
    /** Markdown link & wiki-link resolution */
    graph: GraphService
    /**
     * user configuration persisted in `.banyan/config.json`.
     * NOTE: the prompt names this key `ctx.config`, but Cordis reserves
     * `ctx.config` for plugin configuration (a built-in accessor that cannot
     * be overridden), so the user-config service is exposed as `ctx.settings`
     * instead — see docs/dev/decisions.md D6.
     */
    settings: ConfigService
    /** structured logging */
    logger: LoggerService
    /**
     * RESERVED for a future provider plugin — type-only in v0 (§4.2).
     * Accessing `ctx.ai` at runtime before a provider registers is an error
     * by design; the type exists so plugin authors can code against it.
     */
    ai: AiService
  }
}

/** Entry returned by `ctx.vault.list()` */
export interface NoteEntry {
  /** vault-relative path with `/` separators, e.g. `notes/idea.md` */
  path: string
  type: 'file' | 'dir'
  /** present for files */
  title?: string
}

/** `ctx.vault` — note read/write restricted to the vault path whitelist */
export interface VaultService {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  list(path?: string): Promise<NoteEntry[]>
  delete(path: string): Promise<void>
}

/** `ctx.index` — FTS5 full-text search over titles + bodies */
export interface SearchHit {
  path: string
  title: string
  /** matched fragment from the body, if any */
  snippet?: string
}

export interface IndexService {
  search(query: string): Promise<SearchHit[]>
  /** full rebuild from the vault folder; the index is always a derivative */
  rebuild(): Promise<void>
}

/** `ctx.graph` — Markdown link & wiki-link `[[...]]` resolution */
export interface GraphService {
  backlinks(path: string): Promise<string[]>
  links(path: string): Promise<string[]>
}

/** `ctx.config` — user configuration persisted in `.banyan/config.json` */
export interface ConfigService {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T>(key: string, fallback: T): Promise<T>
  set(key: string, value: unknown): Promise<void>
}

/** `ctx.logger` — structured logging */
export interface LoggerService {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

/**
 * `ctx.ai` — RESERVED interface, intentionally NOT implemented in v0 (§4.2).
 * A future provider plugin will register the actual implementation.
 */
export interface AiService {
  /** placeholder; a provider plugin must implement this */
  complete(prompt: string, options?: Record<string, unknown>): Promise<string>
}
