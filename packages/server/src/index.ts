import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Context } from '@cordisjs/core'
import type { Hono } from 'hono'
import { createApp } from './app.ts'
import { createRuntime, openVault } from './runtime.ts'
import { serveWebDist } from './static.ts'
import { openBrowser } from './open.ts'

interface CliArgs {
  port: number
  vault: string | null
  open: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3210, vault: null, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === 'web') continue
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--vault') args.vault = argv[++i] ?? null
    else if (a === '--no-open') args.open = false
    else {
      // eslint-disable-next-line no-console
      console.error(`unknown argument: ${a}\nusage: banyan web [--port 3210] [--vault <folder>] [--no-open]`)
      process.exit(2)
    }
  }
  return args
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)

  const ctx = new Context()
  // first startup: generate a random token (M1). Once a vault is opened, the
  // token is persisted into `<vault>/.banyan/config.json` and reused.
  const token = randomBytes(24).toString('base64url')

  const rt = createRuntime(ctx, token, () => {})

  // createNodeWebSocket reads `init.app` lazily at upgrade time, so a getter
  // referencing the not-yet-created app is safe here.
  let app!: Hono
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
    get app() {
      return app
    },
  })
  app = createApp(rt, upgradeWebSocket)

  // open vault from CLI if provided and valid
  if (args.vault) {
    const vaultPath = path.resolve(args.vault)
    let stat
    try {
      stat = statSync(vaultPath)
    } catch {
      // eslint-disable-next-line no-console
      console.error(`vault folder does not exist: ${vaultPath}`)
      process.exit(2)
    }
    if (!stat.isDirectory()) {
      // eslint-disable-next-line no-console
      console.error(`not a folder: ${vaultPath}`)
      process.exit(2)
    }
    mkdirSync(vaultPath, { recursive: true })
    await openVault(rt, vaultPath, true)
  }

  // serve the built web client (SPA) — dist lives in ../web/dist
  const here = path.dirname(fileURLToPath(import.meta.url))
  const distDir = path.resolve(here, '../../web/dist')
  serveWebDist(app, distDir)

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: args.port })
  injectWebSocket(server)

  const url = `http://127.0.0.1:${args.port}/?token=${rt.token}`
  // eslint-disable-next-line no-console
  console.log('\n  Banyan (榕) web')
  // eslint-disable-next-line no-console
  console.log(`  vault : ${rt.vault?.root ?? '(not opened — choose one in the UI)'}`)
  // eslint-disable-next-line no-console
  console.log(`  local : ${url}\n`)
  if (args.open) openBrowser(url)

  const shutdown = () => {
    server.close()
    rt.index?.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// This module is the CLI entry (imported by bin/banyan.mjs).
await main()
