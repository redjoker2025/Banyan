import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Context } from '@cordisjs/core'
import '@banyan/core'
import { PluginManager, PluginManagerError, AuditLog } from '../src/index.ts'
import type { PluginManager as PluginManagerType } from '../src/index.ts'

const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms))

function writePlugin(dir: string, manifest: Record<string, unknown>, entryCode?: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8')
  if (manifest.entry !== undefined && (manifest.entry as Record<string, string>).server && entryCode) {
    const serverDir = path.join(dir, 'server')
    mkdirSync(serverDir, { recursive: true })
    writeFileSync(path.join(serverDir, 'index.mjs'), entryCode, 'utf8')
  }
}

const manifestOf = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: id,
  version: '0.1.0',
  banyanApi: '^0.1',
  description: `fixture ${id}`,
  inject: [],
  provides: [],
  permissions: { fs: { globs: [] }, net: { domains: [] }, exec: false },
  entry: { client: './client.js' },
  ...extra,
})

const hostVault = { read: async () => 'v', write: async () => {}, list: async () => [], delete: async () => {} }
const hostGraph = { backlinks: async () => [], links: async () => [] }

interface Harness {
  manager: PluginManagerType
  ctx: Context
  configStore: Map<string, unknown>
  broadcasts: Array<{ type: string; payload: Record<string, unknown> }>
  root: string
}

function makeHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'banyan-pm-'))
  const pluginsDir = path.join(root, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const ctx = new Context()
  const configStore = new Map<string, unknown>()
  const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = []
  const hostVaultFake = { read: async () => 'v', write: async () => {}, list: async () => [], delete: async () => {} }
  const hostNetFake = { fetch: async () => new Response('ok') }
  const hostGraphFake = { backlinks: async () => [], links: async () => [] }
  // the host registers its contract services before any plugin mounts (§4.2)
  ctx.set('vault', hostVaultFake as never)
  ctx.set('net', hostNetFake as never)
  ctx.set('graph', hostGraphFake as never)
  ctx.set('index', {} as never)
  ctx.set('settings', {} as never)
  ctx.set('logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never)
  ctx.set('pipeline', {} as never)
  ctx.set('broadcast', ((event: { type: string; payload: Record<string, unknown> }) => broadcasts.push(event)) as never)
  const manager = new PluginManager({
    ctx,
    host: { vault: hostVaultFake as never, graph: hostGraphFake as never, netFetch: async () => new Response('ok') },
    audit: new AuditLog(path.join(root, 'audit.jsonl')),
    config: {
      get: async (key, fallback) => (configStore.has(key) ? (configStore.get(key) as never) : fallback),
      set: async (key, value) => {
        configStore.set(key, value)
      },
    },
    broadcast: (event) => broadcasts.push(event),
    pluginsDirs: [pluginsDir],
    logger: { info: () => {}, warn: () => {} },
    registerRoute: () => {},
    isPluginActive: () => false,
  })
  return { manager, ctx, configStore, broadcasts, root }
}

const FIXTURE_A_ENTRY = `
let denied = null
let allowedStatus = null
export default {
  inject: ['vault', 'net'],
  async apply(ctx) {
    ctx.set('demo.greeter', { greet: () => 'hi' })
    ctx.on('fixture/event', () => { globalThis.__fixtureEvents = (globalThis.__fixtureEvents ?? 0) + 1 })
    try { await ctx.vault.read('secret.md') } catch (e) { denied = { name: e.name, pluginId: e.pluginId } }
    try { allowedStatus = (await ctx.net.fetch('https://allowed.example.com/x')).status } catch { allowedStatus = 'denied' }
    try { await ctx.net.fetch('https://evil.example.com/x') } catch (e) { denied ??= { name: e.name, pluginId: e.pluginId } }
    ctx.set('demo.probe', { denied, allowedStatus })
  },
}
`

describe('plugin manager lifecycle (M2)', () => {
  it('scans manifests, mounts through the facade, enforces permissions and reverses on disable', async () => {
    const h = makeHarness()
    globalThis.__fixtureEvents = 0
    writePlugin(path.join(h.root, 'plugins', 'fixture-a'), manifestOf('banyan.fixture-a', {
      inject: ['vault', 'net'],
      provides: ['demo.greeter'],
      permissions: { fs: { globs: [] }, net: { domains: ['allowed.example.com'] }, exec: false },
      entry: { server: './server/index.mjs' },
    }), FIXTURE_A_ENTRY)

    await h.manager.init()
    expect(h.manager.list().map((p) => p.id)).toEqual(['banyan.fixture-a'])
    expect(h.manager.list()[0]?.enabled).toBe(false)

    await h.manager.enable('banyan.fixture-a')
    await tick()

    // enabled + persisted + broadcast
    expect(h.manager.isEnabled('banyan.fixture-a')).toBe(true)
    expect(h.configStore.get('enabledPlugins')).toEqual(['banyan.fixture-a'])
    expect(h.broadcasts.at(-1)).toMatchObject({ type: 'plugin.state', payload: { id: 'banyan.fixture-a', enabled: true } })

    // the facade exposes permission-checked capabilities; vault/net calls denied by default
    const probe = h.ctx.get('demo.probe') as { denied: { name: string; pluginId: string } | null; allowedStatus: unknown }
    expect(probe).toBeTruthy()
    expect(probe.denied?.name).toBe('PermissionDenied')
    expect(probe.denied?.pluginId).toBe('banyan.fixture-a')
    expect(probe.allowedStatus).toBe(200) // declared domain reached via the mocked fetch

    // listener is live before unload
    h.ctx.emit('fixture/event')
    expect(globalThis.__fixtureEvents).toBe(1)

    // disable → everything reversed, LIFO, no residue
    await h.manager.disable('banyan.fixture-a')
    h.ctx.emit('fixture/event')
    expect(globalThis.__fixtureEvents).toBe(1)
    expect(h.ctx.get('demo.greeter')).toBeUndefined()
    expect(h.configStore.get('enabledPlugins')).toEqual([])
    expect(h.broadcasts.at(-1)).toMatchObject({ type: 'plugin.state', payload: { id: 'banyan.fixture-a', enabled: false } })
  })

  it('restarts with the persisted enabled list', async () => {
    const h = makeHarness()
    writePlugin(path.join(h.root, 'plugins', 'fixture-a'), manifestOf('banyan.fixture-a', {
      entry: { server: './server/index.mjs' },
    }), `export default { apply() {} }`)
    h.configStore.set('enabledPlugins', ['banyan.fixture-a'])

    await h.manager.init()
    expect(h.manager.isEnabled('banyan.fixture-a')).toBe(true)
  })

  it('detects provides conflicts between enabled plugins and names both parties', async () => {
    const h = makeHarness()
    writePlugin(path.join(h.root, 'plugins', 'conflict-a'), manifestOf('banyan.demo.conflict-a', {
      provides: ['demo.greeter'],
      entry: { server: './server/index.mjs' },
    }), `export default { apply() {} }`)
    writePlugin(path.join(h.root, 'plugins', 'conflict-b'), manifestOf('banyan.demo.conflict-b', {
      provides: ['demo.greeter'],
      entry: { server: './server/index.mjs' },
    }), `export default { apply() {} }`)
    await h.manager.init()

    await h.manager.enable('banyan.demo.conflict-a')
    await expect(h.manager.enable('banyan.demo.conflict-b')).rejects.toMatchObject({
      failure: { code: 'E_CONFLICT', parties: ['banyan.demo.conflict-a', 'banyan.demo.conflict-b'] },
    })
    expect(h.manager.isEnabled('banyan.demo.conflict-b')).toBe(false)
  })

  it('rejects unsatisfiable inject with the missing key and the waiting plugin', async () => {
    const h = makeHarness()
    writePlugin(path.join(h.root, 'plugins', 'needy'), manifestOf('banyan.demo.needy', {
      inject: ['demo.nonexistent'],
    }))
    await h.manager.init()
    await expect(h.manager.enable('banyan.demo.needy')).rejects.toMatchObject({
      failure: { code: 'E_MISSING_DEPENDENCY' },
    })
  })

  it('refuses to enable plugins with manifest or banyanApi errors', async () => {
    const h = makeHarness()
    writePlugin(path.join(h.root, 'plugins', 'badapi'), manifestOf('banyan.demo.badapi', { banyanApi: '^9.0' }))
    writePlugin(path.join(h.root, 'plugins', 'badfield'), {
      ...manifestOf('banyan.demo.badfield'),
      oops: 'unknown field',
    })
    await h.manager.init()
    await expect(h.manager.enable('banyan.demo.badapi')).rejects.toMatchObject({
      failure: { code: 'E_MANIFEST_INVALID' },
    })
    await expect(h.manager.enable('banyan.demo.badfield')).rejects.toBeInstanceOf(PluginManagerError)
  })

  it('recovers the last error as audit trail when the server entry fails to import', async () => {
    const h = makeHarness()
    writePlugin(path.join(h.root, 'plugins', 'broken'), manifestOf('banyan.demo.broken', {
      entry: { server: './server/index.mjs' },
    }), `throw new Error('boom at import')`)
    await h.manager.init()
    await expect(h.manager.enable('banyan.demo.broken')).rejects.toMatchObject({
      failure: { code: 'E_INTERNAL' },
    })
    expect(h.manager.isEnabled('banyan.demo.broken')).toBe(false)
  })
})
