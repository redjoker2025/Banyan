#!/usr/bin/env node
/**
 * Build the npm package `banyan-notes`:
 *   1. build the web client (always fresh — prevents stale bundles)
 *   2. esbuild-bundle the server (TS sources + vendored Cordis + pure-JS
 *      deps) into a single ESM file; only native modules stay external
 *   3. pre-bundle every plugin's server entry (.ts → .mjs) — the npm
 *      package has no tsx, so runtime imports need plain JS
 *   4. copy the built web client as client-dist/ + official plugins/
 *   5. assemble package.json + bin launcher
 * Result: build/banyan-notes/package — ready for `npm publish`.
 *
 * Usage: node scripts/build-npm.mjs [version]
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(repo, 'build', 'banyan-notes', 'package')
const version = process.argv[2] ?? JSON.parse(readFileSync(path.join(repo, 'packages/server/package.json'), 'utf8')).version

console.log(`building banyan-notes@${version}`)

// 0. always rebuild the web client so the shipped assets match the source
console.log('· building web client…')
execSync('pnpm --filter @banyan/web build', { cwd: repo, stdio: 'inherit' })

rmSync(outRoot, { recursive: true, force: true })
mkdirSync(path.join(outRoot, 'dist'), { recursive: true })

// 1. bundle the server (TS sources + vendored Cordis + pure-JS deps)
console.log('· bundling server…')
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

// 2. pre-bundle plugin server entries (.ts → .mjs) and rewrite manifests
console.log('· pre-bundling plugin server entries…')
const pluginsIn = path.join(repo, 'plugins')
for (const entry of readdirSync(pluginsIn, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pluginDir = path.join(pluginsIn, entry.name)
  const manifestFile = path.join(pluginDir, 'plugin.json')
  if (!existsSync(manifestFile)) continue
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  const outPluginDir = path.join(outRoot, 'plugins', entry.name)
  mkdirSync(outPluginDir, { recursive: true })
  const serverEntry = manifest.entry?.server
  if (serverEntry) {
    const src = path.resolve(pluginDir, serverEntry)
    const outRel = serverEntry.replace(/\.tsx?$/, '.mjs')
    await build({
      entryPoints: [src],
      outfile: path.join(outRoot, 'plugins', entry.name, outRel),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      // bundled CJS deps (e.g. mammoth/docx) call require() on node builtins;
      // in an ESM output that must be wired up explicitly or esbuild's
      // __require shim throws "Dynamic require of 'url' is not supported".
      banner: {
        js: [
          "import { createRequire as __createRequire } from 'node:module';",
          'const require = __createRequire(import.meta.url);',
        ].join('\n'),
      },
      logLevel: 'warning',
      absWorkingDir: repo,
      nodePaths: [path.join(repo, 'node_modules')],
    })
    manifest.entry.server = outRel
  }
  writeFileSync(path.join(outPluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
  // copy the rest of the plugin directory (client entries, assets)
  copyExtra(pluginDir, path.join(outRoot, 'plugins', entry.name), ['plugin.json', 'server'])
}

// 3. web client
const webDist = path.join(repo, 'packages/web/dist')
if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('web client build failed — index.html missing')
  process.exit(1)
}
cpSync(webDist, path.join(outRoot, 'client-dist'), { recursive: true })

// 4. bin + package.json + README
const binDir = path.join(outRoot, 'bin')
mkdirSync(binDir, { recursive: true })
writeFileSync(path.join(binDir, 'banyan.mjs'), "#!/usr/bin/env node\nimport '../dist/index.mjs'\n", 'utf8')

const pkg = {
  name: 'banyan-notes',
  version,
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
let total = 0
function sumSize(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sumSize(p)
    else total += statSync(p).size
  }
}
sumSize(outRoot)
console.log(`npm package assembled at: ${outRoot}`)
console.log(`total size: ${Math.round(total / 1024)} KB`)

/** copy everything except excluded top-level entries (already handled) */
function copyExtra(src, dest, excludedTopLevel) {
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (excludedTopLevel.includes(e.name)) continue
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) cpSync(s, d, { recursive: true })
    else writeFileSync(d, readFileSync(s))
  }
}
