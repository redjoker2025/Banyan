#!/usr/bin/env node
/**
 * Build the npm package `banyan-notes`:
 *   1. esbuild-bundle the server (TS sources + vendored Cordis + all pure-JS
 *      deps) into a single ESM file; only native modules stay external
 *   2. copy the built web client as client-dist/
 *   3. copy the official plugins/
 *   4. assemble package.json + bin launcher
 * Result: build/banyan-notes/package — ready for `npm publish`.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(repo, 'build', 'banyan-notes', 'package')

rmSync(path.join(repo, 'build', 'banyan-notes'), { recursive: true, force: true })
mkdirSync(path.join(outRoot, 'dist'), { recursive: true })

// 1. bundle the server (TS sources + vendored Cordis + pure-JS deps)
await build({
  entryPoints: [path.join(repo, 'packages/server/src/index.ts')],
  outfile: path.join(outRoot, 'dist', 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  external: ['better-sqlite3', 'ws'],
  sourcemap: false,
  logLevel: 'info',
})

// 2. web client (must be built first: pnpm --filter @banyan/web build)
const webDist = path.join(repo, 'packages/web/dist')
if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('web client is not built — run: pnpm --filter @banyan/web build')
  process.exit(1)
}
cpSync(webDist, path.join(outRoot, 'client-dist'), { recursive: true })

// 3. official plugins (manifests + entries, as installed on disk)
cpSync(path.join(repo, 'plugins'), path.join(outRoot, 'plugins'), { recursive: true })

// 4. bin + package.json + README
const binDir = path.join(outRoot, 'bin')
mkdirSync(binDir, { recursive: true })
writeFileSync(path.join(binDir, 'banyan.mjs'), "#!/usr/bin/env node\nimport '../dist/index.mjs'\n", 'utf8')

const pkg = {
  name: 'banyan-notes',
  version: '0.1.0',
  description:
    'Banyan (榕) — a local-first, plugin-based note-taking app for the web. Markdown folder is the only source of truth.',
  keywords: ['notes', 'markdown', 'local-first', 'plugins', 'cordis', 'editor', 'knowledge-base'],
  license: 'MIT',
  type: 'module',
  bin: { banyan: 'bin/banyan.mjs' },
  files: ['dist/', 'client-dist/', 'plugins/', 'bin/'],
  engines: { node: '>=22' },
  repository: { type: 'git', url: 'git+ssh://git@github.com/redjoker2025/Banyan.git' },
  homepage: 'https://github.com/redjoker2025/Banyan#readme',
  bugs: { url: 'https://github.com/redjoker2025/Banyan/issues' },
  dependencies: {
    'better-sqlite3': '^11.8.1',
    ws: '^8.18.0',
  },
}
writeFileSync(path.join(outRoot, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8')
writeFileSync(path.join(outRoot, 'README.md'), readFileSync(path.join(repo, 'README.md'), 'utf8'), 'utf8')

// summary
function sizeOf(dir) {
  let total = 0
  for (const entry of walk(dir)) total += statSync(entry).size
  return `${Math.round(total / 1024)} KB`
}
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
console.log('npm package assembled at:', outRoot)
console.log('total size:', sizeOf(outRoot))
