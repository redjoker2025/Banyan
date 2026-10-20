import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@cordisjs/core'
import type { VaultService, GraphService } from '@banyan/core'
import { parseManifest, PluginManagerError, HOST_API_VERSION, checkApiCompat } from './manifest.ts'
import type { BanyanManifest } from './manifest.ts'
import { AuditLog } from './audit.ts'
import { createCapabilities } from './proxy.ts'
import { checkConflicts } from './conflict.ts'

export interface InstalledPlugin {
  manifest: BanyanManifest
  /** absolute directory containing plugin.json */
  dir: string
  source: 'official' | 'installed'
  /** parse/compat error, plugin cannot be enabled */
  error?: string
}

export interface PluginStatus {
  id: string
  name: string
  version: string
  description: string
  source: 'official' | 'installed'
  enabled: boolean
  hasServer: boolean
  hasClient: boolean
  provides: string[]
  inject: string[]
  error?: string
}

export interface ManagerOptions {
  ctx: Context
  host: {
    vault: VaultService
    graph: GraphService
    netFetch: typeof fetch
  }
  audit: AuditLog
  /** enabled-plugin id list persistence */
  config: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  broadcast(event: { type: string; payload: Record<string, unknown> }): void
  /** directories scanned for plugins, in order; earlier wins on id clash */
  pluginsDirs: string[]
  logger: { info(msg: string, meta?: object): void; warn(msg: string, meta?: object): void }
}

interface Mounted {
  /** the wrapped plugin object registered in the cordis registry */
  wrapped: Record<string, unknown>
  manifest: BanyanManifest
}

/**
 * Wires manifests, conflict detection, permission proxies and the Cordis
 * lifecycle together. Server-side plugins are mounted with a facade context
 * whose `ctx.vault` / `ctx.graph` / `ctx.net` are the permission-checked
 * capability instances (§4.5); all other registrations go through the normal
 * kernel effect machinery, so unloading a plugin reverses everything LIFO.
 */
export class PluginManager {
  private readonly installed = new Map<string, InstalledPlugin>()
  private readonly mounted = new Map<string, Mounted>()
  private readonly enabledIds = new Set<string>()

  constructor(private readonly opts: ManagerOptions) {}

  async init(): Promise<void> {
    await this.scan()
    const enabled = await this.opts.config.get<string[]>('enabledPlugins', [])
    for (const id of enabled) {
      try {
        await this.enable(id, { persist: false })
      } catch (reason) {
        this.opts.logger.warn(`plugin "${id}" failed to enable at startup`, {
          error: reason instanceof Error ? reason.message : String(reason),
        })
      }
    }
  }

  /** Scan all plugin directories and parse manifests (invalid ones are kept with an error). */
  async scan(): Promise<void> {
    this.installed.clear()
    for (const dir of this.opts.pluginsDirs) {
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const pluginDir = path.join(dir, entry.name)
        const manifestFile = path.join(pluginDir, 'plugin.json')
        if (!existsSync(manifestFile)) continue
        let raw: unknown
        try {
          raw = JSON.parse(readManifestFile(manifestFile))
        } catch (reason) {
          this.installed.set(entry.name, {
            manifest: { id: entry.name } as BanyanManifest,
            dir: pluginDir,
            source: this.sourceOf(dir),
            error: `plugin.json is not valid JSON: ${reason instanceof Error ? reason.message : String(reason)}`,
          })
          continue
        }
        try {
          const manifest = parseManifest(raw, entry.name)
          if (this.installed.has(manifest.id)) continue // first directory wins
          this.installed.set(manifest.id, {
            manifest,
            dir: pluginDir,
            source: this.sourceOf(dir),
            error: checkApiCompat(manifest),
          })
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          this.installed.set(entry.name, {
            manifest: { id: entry.name } as BanyanManifest,
            dir: pluginDir,
            source: this.sourceOf(dir),
            error: message,
          })
        }
      }
    }
  }

  private sourceOf(dir: string): 'official' | 'installed' {
    return dir.replaceAll('\\', '/').includes('/.banyan/installed') ? 'installed' : 'official'
  }

  list(): PluginStatus[] {
    return Array.from(this.installed.values())
      .map((inst) => ({
        id: inst.manifest.id,
        name: (inst.manifest as Partial<BanyanManifest>).name ?? inst.manifest.id,
        version: (inst.manifest as Partial<BanyanManifest>).version ?? '0.0.0',
        description: (inst.manifest as Partial<BanyanManifest>).description ?? '',
        source: inst.source,
        enabled: this.enabledIds.has(inst.manifest.id),
        hasServer: Boolean((inst.manifest as Partial<BanyanManifest>).entry?.server),
        hasClient: Boolean((inst.manifest as Partial<BanyanManifest>).entry?.client),
        provides: (inst.manifest as Partial<BanyanManifest>).provides ?? [],
        inject: (inst.manifest as Partial<BanyanManifest>).inject ?? [],
        error: inst.error,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  getInstalled(id: string): InstalledPlugin | undefined {
    return this.installed.get(id)
  }

  isEnabled(id: string): boolean {
    return this.enabledIds.has(id)
  }

  private enabledManifests(): BanyanManifest[] {
    return Array.from(this.enabledIds)
      .map((id) => this.installed.get(id)?.manifest)
      .filter((m): m is BanyanManifest => Boolean(m))
  }

  /** Resolve the absolute path of an entry file, refusing path escapes. */
  resolveEntry(id: string, which: 'server' | 'client'): string | undefined {
    const inst = this.installed.get(id)
    if (!inst || inst.error) return undefined
    const rel = inst.manifest.entry[which]
    if (!rel) return undefined
    const abs = path.resolve(inst.dir, rel)
    if (!abs.startsWith(inst.dir + path.sep)) return undefined
    return existsSync(abs) ? abs : undefined
  }

  async enable(id: string, options: { persist?: boolean } = {}): Promise<void> {
    const { persist = true } = options
    if (this.enabledIds.has(id)) return
    const inst = this.installed.get(id)
    if (!inst) {
      throw new PluginManagerError({ code: 'E_NOT_FOUND', message: `plugin "${id}" is not installed` })
    }
    if (inst.error) {
      throw new PluginManagerError({ code: 'E_MANIFEST_INVALID', message: `plugin "${id}" cannot be enabled: ${inst.error}` })
    }
    checkConflicts(inst.manifest, this.enabledManifests())
    if (inst.manifest.entry.server) {
      await this.mount(inst)
    }
    this.enabledIds.add(id)
    if (persist) {
      await this.opts.config.set('enabledPlugins', Array.from(this.enabledIds))
    }
    this.opts.broadcast({ type: 'plugin.state', payload: { id, enabled: true } })
    this.opts.logger.info(`plugin enabled: ${id}`)
  }

  async disable(id: string, options: { persist?: boolean } = {}): Promise<void> {
    const { persist = true } = options
    if (!this.enabledIds.has(id)) return
    const mounted = this.mounted.get(id)
    if (mounted) {
      this.opts.ctx.registry.delete(mounted.wrapped as never)
      this.mounted.delete(id)
    }
    this.enabledIds.delete(id)
    if (persist) {
      await this.opts.config.set('enabledPlugins', Array.from(this.enabledIds))
    }
    this.opts.broadcast({ type: 'plugin.state', payload: { id, enabled: false } })
    this.opts.logger.info(`plugin disabled: ${id}`)
  }

  /**
   * Mount a server plugin: the manifest-declared plugin object is wrapped so
   * that its `apply` receives a facade context exposing the permission-
   * checked capabilities under the contract keys (ctx.vault / ctx.graph /
   * ctx.net). Everything else (events, effects, timers) is ordinary kernel
   * registration owned by the plugin's fork scope.
   */
  private async mount(inst: InstalledPlugin): Promise<void> {
    const entryPath = this.resolveEntry(inst.manifest.id, 'server')
    if (!entryPath) {
      throw new PluginManagerError({ code: 'E_NOT_FOUND', message: `server entry of "${inst.manifest.id}" not found` })
    }
    let mod: Record<string, unknown>
    try {
      mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>
    } catch (reason) {
      throw new PluginManagerError({
        code: 'E_INTERNAL',
        message: `failed to import server entry of "${inst.manifest.id}": ${reason instanceof Error ? reason.message : String(reason)}`,
      })
    }
    const inner = (mod.default ?? mod) as {
      apply?: (ctx: unknown, config?: unknown) => unknown
      inject?: string[]
      name?: string
    }
    if (typeof inner?.apply !== 'function') {
      throw new PluginManagerError({ code: 'E_MANIFEST_INVALID', message: `server entry of "${inst.manifest.id}" has no default export with an apply()` })
    }

    const caps = createCapabilities(
      inst.manifest,
      { vault: this.opts.host.vault, graph: this.opts.host.graph },
      this.opts.audit,
      this.opts.host.netFetch,
    )

    const wrapped: {
      name: string
      inject: string[]
      apply: (ctx: unknown, config: unknown) => unknown
    } = {
      name: inst.manifest.id,
      inject: inner.inject ?? inst.manifest.inject,
      apply: (ctx: unknown, config: unknown) => {
        const facade = createFacade(ctx, caps as unknown as Record<string, unknown>)
        return inner.apply!(facade, config)
      },
    }

    this.opts.ctx.plugin(wrapped)
    this.mounted.set(inst.manifest.id, { wrapped, manifest: inst.manifest })
  }

  /** ids currently enabled (for tests and status endpoints) */
  enabledList(): string[] {
    return Array.from(this.enabledIds)
  }
}

function readManifestFile(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * Build the plugin-facing context: prototype-linked to the real fork context
 * (so on/effect/set keep their plugin-scoped reversal semantics) with the
 * capability keys shadowed by permission-checked instances.
 */
function createFacade(ctx: unknown, caps: Record<string, unknown>): unknown {
  const facade = Object.create(ctx as object)
  for (const [key, value] of Object.entries(caps)) {
    Object.defineProperty(facade, key, { get: () => value, configurable: true })
  }
  return facade
}

export { PluginManagerError, HOST_API_VERSION }
