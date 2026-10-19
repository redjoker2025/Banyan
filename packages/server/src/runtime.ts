import { Context } from '@cordisjs/core'
import * as path from 'node:path'
import { ConfigServiceImpl } from './services/config.ts'
import { IndexServiceImpl } from './services/indexer.ts'
import { Journal } from './services/journal.ts'
import { LoggerServiceImpl } from './services/logger.ts'
import { VaultServiceImpl } from './services/vault.ts'
import { parseNote } from './services/indexer.ts'

/** WS broadcast payloads (§4.3) */
export type WsEvent =
  | { type: 'note.created'; payload: { path: string; content: string } }
  | { type: 'note.updated'; payload: { path: string; content: string } }
  | { type: 'note.deleted'; payload: { path: string } }
  | { type: 'plugin.state'; payload: Record<string, unknown> }

export interface ServerRuntime {
  ctx: Context
  token: string
  vault: VaultServiceImpl | null
  index: IndexServiceImpl | null
  settings: ConfigServiceImpl | null
  journal: Journal | null
  /** `<vault>/.banyan` directory, null until a vault is opened */
  metadataDir: string | null
  broadcast(event: WsEvent): void
}

export function createRuntime(ctx: Context, token: string, broadcast: (event: WsEvent) => void): ServerRuntime {
  ctx.set('logger', new LoggerServiceImpl())
  return { ctx, token, vault: null, index: null, settings: null, journal: null, metadataDir: null, broadcast }
}

/**
 * Open (or switch to) a vault folder: creates `<vault>/.banyan/`, wires the
 * services into the kernel context and rebuilds the index when missing.
 *
 * `reusePersistedToken` is true when opening from the CLI at startup: the
 * token persisted in `<vault>/.banyan/config.json` is reused so that browser
 * sessions survive server restarts. Mid-session vault switches keep the
 * current token (clients already hold it) and persist it into the new vault.
 */
export async function openVault(rt: ServerRuntime, vaultRoot: string, reusePersistedToken = false): Promise<void> {
  const metaDir = path.join(vaultRoot, '.banyan')

  // close previous index before dropping the reference
  rt.index?.close()

  // drop old services (ctx.set refuses overwriting a non-null value)
  for (const key of ['vault', 'index', 'settings'] as const) {
    if (rt[key] !== null) {
      rt.ctx.set(key, undefined)
    }
  }

  const vault = new VaultServiceImpl(vaultRoot)
  const config = new ConfigServiceImpl(path.join(metaDir, 'config.json'))
  const index = new IndexServiceImpl(path.join(metaDir, 'index.db'), vault)
  const journal = new Journal(path.join(metaDir, 'journal.jsonl'))

  rt.ctx.set('vault', vault)
  rt.ctx.set('index', index)
  rt.ctx.set('settings', config)

  Object.assign(rt, { vault, index, settings: config, journal, metadataDir: metaDir })

  // the index is always a derivative: rebuild automatically when missing or
  // wiped (e.g. index.db deleted while the server was down, §4.3)
  if (index.isEmpty()) {
    rt.ctx.logger.info('index is empty — running full rebuild')
    await index.rebuild()
  }

  // token persistence: reuse the stored token at startup, otherwise persist
  // the current one so future starts with this vault keep working (M1 §6.1)
  const persisted = config.peek<string>('token')
  if (reusePersistedToken && persisted) {
    rt.token = persisted
  } else if (persisted !== rt.token) {
    await config.set('token', rt.token)
  }
  await config.set('vaultPath', vaultRoot)

  rt.ctx.logger.info(`vault opened: ${vaultRoot}`)
}

/**
 * The single save path used by both the REST route and tests: content flows
 * through the `pipeline/save` waterfall before hitting the disk (§4.2).
 */
export async function saveNote(rt: ServerRuntime, rel: string, content: string): Promise<string> {
  const transformed = await rt.ctx.waterfall('pipeline/save', content, { path: rel })
  await rt.vault!.write(rel, transformed)
  const { title, body } = parseNote(transformed, rel)
  const mtime = await rt.vault!.mtime(rel)
  rt.index!.upsert(rel, title, body, mtime)
  rt.journal!.append('updated', rel, Journal.hash(transformed))
  rt.broadcast({ type: 'note.updated', payload: { path: rel, content: transformed } })
  return transformed
}
