import { matchAnyGlob } from './glob.ts'
import { AuditLog } from './audit.ts'
import type { BanyanManifest } from './manifest.ts'
import type { VaultService, GraphService, SearchHit } from '@banyan/core'

/**
 * A thin network capability exposed to server plugins (§4.5 net.domains).
 * Only domains declared in the manifest may be accessed; anything else is
 * denied BEFORE any I/O happens. This is the sanctioned network path for
 * plugins — direct `fetch` usage by plugin code cannot be intercepted
 * in-process (documented limitation, worker sandbox is backlog).
 */
export interface NetService {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

/**
 * HTTP route registration for server plugins (M2). Routes are namespaced
 * under `/api/plugins/<plugin-id>` by the host; handlers receive the raw
 * Web-standard `Request` and return a `Response`. Routes registered by a
 * disabled plugin answer 409 until it is enabled again.
 */
export type PluginRouteHandler = (req: Request) => Response | Promise<Response>

export interface HttpService {
  /**
   * register a route relative to `/api/plugins/<plugin-id>`. The host owns
   * the lifecycle: while the plugin is disabled its routes answer 409, so
   * there is no manual dispose to track.
   */
  registerRoute(method: string, subPath: string, handler: PluginRouteHandler): void
}

export interface PluginCapabilities {
  vault: VaultService
  graph: GraphService
  net: NetService
  http: HttpService
}

function denied(manifest: BanyanManifest, action: string, required: string, detail?: string): never {
  throw new PermissionDenied(manifest.id, `${action} ${required}`, detail)
}

export class PermissionDenied extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly required: string,
    public readonly action?: string,
  ) {
    super(`plugin "${pluginId}" is not permitted to ${required} (declare it in manifest permissions)`)
    this.name = 'PermissionDenied'
  }
}

/**
 * Wrap host capabilities with the manifest's declared permissions (§4.5).
 * Every denied call is written to `audit.jsonl` before the error is thrown.
 * Any capability method taking a vault-relative path is glob-checked;
 * read-only derived services without a path argument (index.search) are
 * considered global read capabilities (see decisions.md).
 */
export function createCapabilities(
  manifest: BanyanManifest,
  host: { vault: VaultService; graph: GraphService },
  audit: AuditLog,
  netFetch: typeof fetch,
  http: HttpService,
): PluginCapabilities {
  const { permissions } = manifest
  const deny = (action: string, required: string, detail?: string): never => {
    audit.append({ pluginId: manifest.id, action, required, detail })
    denied(manifest, action, required, detail)
  }

  const vault: VaultService = {
    async read(rel: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('vault.read', rel)
      return host.vault.read(rel)
    },
    async write(rel: string, content: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('vault.write', rel)
      return host.vault.write(rel, content)
    },
    async list(rel = '') {
      if (rel && !matchAnyGlob(rel, permissions.fs.globs)) deny('vault.list', rel)
      return host.vault.list(rel)
    },
    async delete(rel: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('vault.delete', rel)
      return host.vault.delete(rel)
    },
    async exists(rel: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('vault.exists', rel)
      return host.vault.exists(rel)
    },
  }

  const graph: GraphService = {
    async backlinks(rel: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('graph.backlinks', rel)
      return host.graph.backlinks(rel)
    },
    async links(rel: string) {
      if (!matchAnyGlob(rel, permissions.fs.globs)) deny('graph.links', rel)
      return host.graph.links(rel)
    },
  }

  const allowed = new Set(permissions.net.domains)
  const net: NetService = {
    async fetch(url: string, init?: RequestInit) {
      let host2: string
      try {
        host2 = new URL(url).hostname
      } catch {
        return deny('net.fetch', url, 'invalid URL')
      }
      if (!allowed.has(host2)) {
        return deny('net.fetch', host2, `domain not declared in net.domains of ${manifest.id}`)
      }
      return netFetch(url, init)
    },
  }

  return { vault, graph, net, http }
}

/** Re-export for typing convenience in server wiring */
export type { SearchHit }
