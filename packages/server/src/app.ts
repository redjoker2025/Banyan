import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { createMiddleware } from 'hono/factory'
import { readFileSync } from 'node:fs'
import { BanyanError } from '@banyan/core'
import { PluginManagerError } from '@banyan/plugin-manager'
import type { WSContext } from 'hono/ws'
import type { createNodeWebSocket } from '@hono/node-ws'
import { openVault, saveNote } from './runtime.ts'
import type { ServerRuntime, WsEvent } from './runtime.ts'
import { parseNote, parseFrontmatterTags } from './services/indexer.ts'

type UpgradeWS = ReturnType<typeof createNodeWebSocket>['upgradeWebSocket']

const vaultSchema = z.object({ path: z.string().min(1) })
const createSchema = z.object({ path: z.string().min(1), content: z.string().optional() })
const saveSchema = z.object({ path: z.string().min(1), content: z.string() })
const renameSchema = z.object({ path: z.string().min(1), newPath: z.string().min(1) })
const pluginOpSchema = z.object({ id: z.string().min(1) })

function statusFor(code: BanyanError['code'] | PluginManagerError['failure']['code']): ContentfulStatusCode {
  switch (code) {
    case 'E_PERMISSION_DENIED':
      return 403
    case 'E_NOT_FOUND':
      return 404
    case 'E_CONFLICT':
      return 409
    case 'E_MANIFEST_INVALID':
    case 'E_MISSING_DEPENDENCY':
    case 'E_PATH_OUTSIDE_VAULT':
      return 400
    case 'E_VAULT_NOT_SET':
      return 409
    default:
      return 400
  }
}

export function createApp(rt: ServerRuntime, upgradeWebSocket: UpgradeWS): Hono {
  const app = new Hono()

  // --- token auth for every API route and the WS upgrade (M1 §6.1) ---
  // For /ws the middleware response (401) aborts the upgrade handshake.
  const auth = createMiddleware(async (c, next) => {
    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : c.req.query('token')
    if (!token || token !== rt.token) {
      return c.json({ error: 'E_UNAUTHORIZED', message: 'missing or invalid token' }, 401)
    }
    return next()
  })
  app.use('/api/*', auth)
  app.use('/ws', auth)
  app.use('/plugins/*', auth)

  app.onError((error, c) => {
    if (error instanceof BanyanError) {
      return c.json({ error: error.code, message: error.message }, statusFor(error.code))
    }
    if (error instanceof PluginManagerError) {
      return c.json(
        { error: error.failure.code, message: error.failure.message, parties: error.failure.parties },
        statusFor(error.failure.code),
      )
    }
    rt.ctx.logger.error(`unhandled error: ${error instanceof Error ? error.stack : String(error)}`)
    return c.json({ error: 'E_INTERNAL', message: 'internal server error' }, 500)
  })

  app.get('/api/health', (c) => c.json({ ok: true, vault: rt.vault?.root ?? null }))

  // --- vault management ---
  app.get('/api/vault', (c) => c.json({ path: rt.vault?.root ?? null }))

  app.post('/api/vault', async (c) => {
    const body = vaultSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { path: string }' }, 400)
    }
    const { mkdirSync, statSync } = await import('node:fs')
    let stat
    try {
      stat = statSync(body.data.path)
    } catch {
      return c.json({ error: 'E_BAD_REQUEST', message: `folder does not exist: ${body.data.path}` }, 400)
    }
    if (!stat.isDirectory()) {
      return c.json({ error: 'E_BAD_REQUEST', message: `not a folder: ${body.data.path}` }, 400)
    }
    mkdirSync(body.data.path, { recursive: true })
    await openVault(rt, body.data.path)
    return c.json({ path: rt.vault!.root })
  })

  // --- tree / search / index ---
  app.get('/api/tree', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const items = await rt.vault.list()
    return c.json({ items })
  })

  app.get('/api/search', async (c) => {
    if (!rt.index) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const q = c.req.query('q') ?? ''
    return c.json({ hits: await rt.index.search(q) })
  })

  app.post('/api/index/rebuild', async (c) => {
    if (!rt.index) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    await rt.index.rebuild()
    return c.json({ ok: true })
  })

  // --- notes (path addressed via query/body to avoid %-encoding pitfalls) ---
  app.get('/api/note', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const rel = c.req.query('path') ?? ''
    const content = await rt.vault.read(rel)
    const mtime = await rt.vault.mtime(rel)
    return c.json({ path: rel, content, mtime, title: parseNote(content, rel).title })
  })

  app.post('/api/note', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const body = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { path: string, content?: string }' }, 400)
    }
    const rel = body.data.path
    if (await rt.vault.exists(rel)) {
      return c.json({ error: 'E_CONFLICT', message: `note already exists: ${rel}` }, 409)
    }
    const content = await rt.ctx.waterfall('pipeline/save', body.data.content ?? '', { path: rel })
    await rt.vault.write(rel, content)
    const parsed = parseNote(content, rel)
    const mtime = await rt.vault.mtime(rel)
    rt.index!.upsert(rel, parsed.title, parsed.body, mtime)
    rt.journal!.append('created', rel)
    rt.broadcast({ type: 'note.created', payload: { path: rel, content } })
    return c.json({ path: rel }, 201)
  })

  app.put('/api/note', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const body = saveSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { path: string, content: string }' }, 400)
    }
    if (!(await rt.vault.exists(body.data.path))) {
      return c.json({ error: 'E_NOT_FOUND', message: `note not found: ${body.data.path}` }, 404)
    }
    const content = await saveNote(rt, body.data.path, body.data.content)
    return c.json({ path: body.data.path, content })
  })

  app.delete('/api/note', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const rel = c.req.query('path') ?? ''
    await rt.vault.delete(rel)
    rt.index!.remove(rel)
    rt.journal!.append('deleted', rel)
    rt.broadcast({ type: 'note.deleted', payload: { path: rel } })
    return c.json({ ok: true })
  })

  app.post('/api/note/rename', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const body = renameSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { path, newPath }' }, 400)
    }
    const { path: rel, newPath } = body.data
    const content = await rt.vault.read(rel)
    if (await rt.vault.exists(newPath)) {
      return c.json({ error: 'E_CONFLICT', message: `note already exists: ${newPath}` }, 409)
    }
    await rt.vault.write(newPath, content)
    await rt.vault.delete(rel)
    const parsed = parseNote(content, newPath)
    const mtime = await rt.vault.mtime(newPath)
    rt.index!.remove(rel)
    rt.index!.upsert(newPath, parsed.title, parsed.body, mtime)
    rt.journal!.append('deleted', rel)
    rt.journal!.append('created', newPath)
    rt.broadcast({ type: 'note.deleted', payload: { path: rel } })
    rt.broadcast({ type: 'note.created', payload: { path: newPath, content } })
    return c.json({ path: newPath })
  })

  // --- plugin system (M2) ---
  app.get('/api/plugins', (c) => {
    if (!rt.plugins) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    return c.json({ plugins: rt.plugins.list() })
  })

  app.post('/api/plugins/enable', async (c) => {
    if (!rt.plugins) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const body = pluginOpSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { id: string }' }, 400)
    }
    await rt.plugins.enable(body.data.id)
    return c.json({ ok: true, enabled: rt.plugins.enabledList() })
  })

  app.post('/api/plugins/disable', async (c) => {
    if (!rt.plugins) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const body = pluginOpSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ error: 'E_BAD_REQUEST', message: 'expect { id: string }' }, 400)
    }
    await rt.plugins.disable(body.data.id)
    return c.json({ ok: true, enabled: rt.plugins.enabledList() })
  })

  // client plugin entries, importable from the web host (token via query)
  app.get('/plugins/:id/client', (c) => {
    if (!rt.plugins) return c.text('no vault opened', 503)
    const id = c.req.param('id')
    const file = rt.plugins.resolveEntry(id, 'client')
    if (!file) return c.text(`client entry of "${id}" not found`, 404)
    try {
      const body = readFileSync(file, 'utf8')
      return c.body(body, 200, { 'content-type': 'text/javascript; charset=utf-8' })
    } catch {
      return c.text(`failed to read client entry of "${id}"`, 500)
    }
  })

  // --- graph + tags (host-level, backing the official client plugins) ---
  app.get('/api/graph/backlinks', async (c) => {
    if (!rt.graph) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    return c.json({ paths: await rt.graph.backlinks(c.req.query('path') ?? '') })
  })

  app.get('/api/graph/links', async (c) => {
    if (!rt.graph) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    return c.json({ paths: await rt.graph.links(c.req.query('path') ?? '') })
  })

  app.get('/api/tags', async (c) => {
    if (!rt.vault) return c.json({ error: 'E_VAULT_NOT_SET', message: 'no vault opened' }, 409)
    const files = (await rt.vault.list()).filter((e) => e.type === 'file')
    const notes: Array<{ path: string; tags: string[] }> = []
    for (const file of files) {
      try {
        const content = await rt.vault.read(file.path)
        notes.push({ path: file.path, tags: parseFrontmatterTags(content) })
      } catch {
        // skip unreadable notes
      }
    }
    return c.json({ notes })
  })

  // --- WebSocket: realtime refresh (§4.3); auth handled by the middleware above ---
  const clients = new Set<WSContext>()
  // dynamic route registration for server plugins. Hono's RegExpRouter
  // compiles its match cache on the first request and ignores routes added
  // afterwards — plugin routes are registered at enable-time, i.e. often
  // after startup traffic, so they are dispatched from a lookup table
  // behind a wildcard route registered here at boot.
  const pluginRoutes = new Map<string, (req: Request) => Response | Promise<Response>>()
  rt.routeRegistrar = (method, routePath, handler) => {
    pluginRoutes.set(`${method.toUpperCase()} ${routePath}`, handler)
  }
  app.all('/api/plugins/:id/*', (c) => {
    const pathname = new URL(c.req.url).pathname
    const handler = pluginRoutes.get(`${c.req.method.toUpperCase()} ${pathname}`)
    if (!handler) {
      return c.json({ error: 'E_NOT_FOUND', message: `no plugin route: ${c.req.method} ${pathname}` }, 404)
    }
    return handler(c.req.raw)
  })
  app.get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        clients.add(ws)
        ws.send(JSON.stringify({ type: 'hello', payload: { vault: rt.vault?.root ?? null } }))
        // replay the latest plugin data so newly connected clients see
        // the same state as the ones that were online when it was published
        for (const payload of Object.values(rt.pluginDataSnapshot)) {
          ws.send(JSON.stringify({ type: 'plugin.state', payload }))
        }
      },
      onClose(_event, ws) {
        clients.delete(ws)
      },
    })),
  )
  rt.broadcast = (event: WsEvent): void => {
    // remember data payloads (plugin.state with a `plugin` key) for replay
    if (event.type === 'plugin.state' && typeof event.payload.plugin === 'string') {
      const key = event.payload.plugin
      rt.pluginDataSnapshot[key] = { ...rt.pluginDataSnapshot[key], ...event.payload }
    }
    const data = JSON.stringify(event)
    for (const ws of clients) {
      try {
        ws.send(data)
      } catch {
        clients.delete(ws)
      }
    }
  }

  return app
}
