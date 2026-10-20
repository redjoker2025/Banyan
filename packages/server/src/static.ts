import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { Hono } from 'hono'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

/**
 * Serve the built web client (`packages/web/dist`) with SPA fallback.
 * Implemented manually so the server can be started from any CWD.
 */
export function serveWebDist(app: Hono, distDir: string): void {
  const root = resolve(distDir)

  app.get('*', (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.notFound()
    const pathname = decodeURIComponent(new URL(c.req.url).pathname)
    if (!existsSync(root)) {
      return c.text('web client is not built yet — run: pnpm --filter @banyan/web build', 503)
    }

    let filePath = normalize(join(root, pathname))
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      return c.text('forbidden', 403)
    }
    if (statSafeIsDir(filePath)) {
      filePath = join(filePath, 'index.html')
    }
    const isHtmlEntry = filePath === join(root, 'index.html')
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback: unknown extension-less paths render the app shell
      if (pathname.includes('.')) return c.text('not found', 404)
      filePath = join(root, 'index.html')
      if (!existsSync(filePath)) return c.text('not found', 404)
    }
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    const body = readFileSync(filePath)
    // the HTML entry references hashed assets — always revalidate it so
    // clients pick up new builds immediately; hashed assets are immutable
    const cacheControl = isHtmlEntry ? 'no-cache' : 'public, max-age=31536000, immutable'
    return c.body(body, 200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cacheControl,
    })
  })
}

function statSafeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
