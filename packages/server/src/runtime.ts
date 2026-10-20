import { Context } from '@cordisjs/core'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginManager, AuditLog } from '@banyan/plugin-manager'
import { ConfigServiceImpl } from './services/config.ts'
import { GraphServiceImpl } from './services/graph.ts'
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
  graph: GraphServiceImpl | null
  settings: ConfigServiceImpl | null
  journal: Journal | null
  plugins: PluginManager | null
  /** `<vault>/.banyan` directory, null until a vault is opened */
  metadataDir: string | null
  /** latest `plugin.state` data payloads per plugin, replayed to new WS clients */
  pluginDataSnapshot: Record<string, Record<string, unknown>>
  broadcast(event: WsEvent): void
}

/**
 * Capability keys (vault / graph / net) are only usable through the
 * permission-gated facade that the plugin manager gives each plugin (§4.5).
 * The global registration is a stub so that `inject` satisfiability works
 * while any direct `ctx.get('vault')`-style bypass fails loudly.
 */
function capabilityStub(name: string): unknown {
  return new Proxy({}, {
    get: () => () => {
      throw new Error(`the "${name}" capability is only available to plugins through the permission-gated ctx capability (declare it in inject)`)
    },
  })
}

export function createRuntime(ctx: Context, token: string, broadcast: (event: WsEvent) => void): ServerRuntime {
  ctx.set('logger', new LoggerServiceImpl())
  // host capability keys: real values for vault/graph are (re)registered per
  // vault in openVault as `rt.*` fields; plugins receive gated instances.
  ctx.set('vault', capabilityStub('vault'))
  ctx.set('graph', capabilityStub('graph'))
  ctx.set('net', capabilityStub('net'))
  ctx.set('pipeline', {
    save: (listener: unknown) => ctx.on('pipeline/save', listener as never),
  })
  ctx.set('broadcast', (event: { type: string; payload: Record<string, unknown> }) => broadcast(event as WsEvent))
  return { ctx, token, vault: null, index: null, graph: null, settings: null, journal: null, plugins: null, metadataDir: null, pluginDataSnapshot: {}, broadcast }
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
  // unload plugins of the previous vault before dropping the manager
  if (rt.plugins) {
    for (const id of rt.plugins.enabledList()) {
      await rt.plugins.disable(id)
    }
  }

  const vault = new VaultServiceImpl(vaultRoot)
  const config = new ConfigServiceImpl(path.join(metaDir, 'config.json'))
  const index = new IndexServiceImpl(path.join(metaDir, 'index.db'), vault)
  const journal = new Journal(path.join(metaDir, 'journal.jsonl'))
  const graph = new GraphServiceImpl(vault)

  rt.ctx.set('index', index)
  rt.ctx.set('settings', config)

  Object.assign(rt, { vault, index, graph, settings: config, journal, metadataDir: metaDir })

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

  // plugin system (M2): scan the vault's installed/ directory plus the
  // repository's official plugins/, then mount the persisted enabled set
  const plugins = new PluginManager({
    ctx: rt.ctx,
    host: { vault, graph, netFetch: (url, init) => fetch(url, init) },
    audit: new AuditLog(path.join(metaDir, 'audit.jsonl')),
    config,
    broadcast: (event) => rt.broadcast(event as WsEvent),
    pluginsDirs: [path.join(metaDir, 'installed'), path.resolve(here(), '../../../plugins')],
    logger: rt.ctx.logger,
  })
  await plugins.init()
  rt.plugins = plugins

  rt.ctx.logger.info(`vault opened: ${vaultRoot}`)
}

/** server package directory, resolved lazily for plugin dir layout */
function here(): string {
  return path.dirname(fileURLToPath(import.meta.url))
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
