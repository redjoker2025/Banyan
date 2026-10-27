import { describe, expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import mammoth from 'mammoth'
import { Context } from '@cordisjs/core'
import '@banyan/core'
import { PluginManager, AuditLog } from '@banyan/plugin-manager'

const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Integration: the docx plugin mounts via the manager, registers routes
 * through the http capability, and performs a real .docx → markdown →
 * .docx round trip through the gated vault capability.
 *
 * The plugin's TypeScript server entry is bundled to a space-free tmp path
 * with esbuild (mirroring the npm packaging pipeline): vitest's resolver
 * chokes on %20 file URLs and on deps outside the project, while the
 * bundled .mjs has neither problem.
 */
describe('docx plugin via the http route extension point (M2)', () => {
  it('imports a .docx into the vault and exports a note back to .docx', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'banyan-docx-'))
    const repoPlugins = path.resolve(fileURLToPath(import.meta.url), '../../../../plugins')
    const pluginSource = path.join(tmp, 'plugins')
    cpSync(repoPlugins, pluginSource, { recursive: true })
    const { build } = await import('esbuild')
    const repo = path.resolve(fileURLToPath(import.meta.url), '../../../..')
    await build({
      entryPoints: [path.join(pluginSource, 'docx/server/index.ts')],
      outfile: path.join(pluginSource, 'docx/server/index.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
      absWorkingDir: repo,
      nodePaths: [path.join(repo, 'node_modules')],
    })
    const manifestFile = path.join(pluginSource, 'docx/plugin.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    manifest.entry.server = './server/index.mjs'
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')

    const vaultDir = path.join(tmp, 'vault')
    mkdirSync(vaultDir, { recursive: true })

    const ctx = new Context()
    const { VaultServiceImpl } = await import('../src/services/vault.ts')
    const { GraphServiceImpl } = await import('../src/services/graph.ts')
    const vault = new VaultServiceImpl(vaultDir)
    const graph = new GraphServiceImpl(vault)

    ctx.set('vault', vault as never)
    ctx.set('net', { fetch: async () => new Response('ok') } as never)
    ctx.set('http', { registerRoute: () => {} } as never)
    ctx.set('graph', graph as never)
    ctx.set('index', {} as never)
    ctx.set('settings', {} as never)
    ctx.set('logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never)
    ctx.set('pipeline', {} as never)
    ctx.set('broadcast', (() => {}) as never)

    // capture routes registered through the http capability
    const routes = new Map<string, (req: Request) => Response | Promise<Response>>()

    const manager = new PluginManager({
      ctx,
      host: { vault, graph, netFetch: async () => new Response('ok') },
      audit: new AuditLog(path.join(tmp, 'audit.jsonl')),
      config: {
        get: async (key, fallback) => (key === 'enabledPlugins' ? fallback : undefined),
        set: async () => {},
      },
      broadcast: () => {},
      pluginsDirs: [pluginSource],
      logger: { info: () => {}, warn: () => {} },
      registerRoute: (pluginId, method, subPath, handler) => {
        routes.set(`${method} /api/plugins/${pluginId}${subPath}`, handler)
      },
      isPluginActive: () => true,
    })
    await manager.init()
    await manager.enable('banyan.docx')
    // wait until the plugin's apply() has registered its routes
    for (let i = 0; i < 50 && routes.size < 2; i++) await tick(100)
    expect(routes.size).toBeGreaterThanOrEqual(2)

    // -- build a real .docx in memory --
    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('导入测试')] }),
        new Paragraph({ children: [new TextRun('普通段落，含 '), new TextRun({ text: '粗体', bold: true })] }),
        new Paragraph({ children: [new TextRun('列表项内容')], bullet: { level: 0 } }),
      ] }],
    })
    const docxBuffer = await Packer.toBuffer(doc)
    const form = new FormData()
    form.append('file', new File([new Uint8Array(docxBuffer)], '会议纪要.docx'), '会议纪要.docx')
    form.append('path', '会议纪要.md')

    const importHandler = routes.get('POST /api/plugins/banyan.docx/import')!
    const importRes = await importHandler(new Request('http://x/api/plugins/banyan.docx/import', { method: 'POST', body: form }))
    const importBody = (await importRes.json()) as { path: string; chars: number }
    expect(importRes.status).toBe(200)
    expect(importBody.path).toBe('会议纪要.md')

    // the note landed in the vault, converted by mammoth
    const stored = await vault.read('会议纪要.md')
    expect(stored).toContain('# 会议纪要')
    expect(stored).toContain('粗体')
    expect(stored).toContain('列表项内容')

    // duplicate import → 409
    const dupForm = new FormData()
    dupForm.append('file', new File([new Uint8Array(docxBuffer)], '会议纪要.docx'), '会议纪要.docx')
    dupForm.append('path', '会议纪要.md')
    const dupRes = await importHandler(new Request('http://x/api/plugins/banyan.docx/import', { method: 'POST', body: dupForm }))
    expect(dupRes.status).toBe(409)

    // -- export a note back to .docx and re-parse with mammoth --
    writeFileSync(path.join(vaultDir, 'export-me.md'), '# 导出测试\n\n- 第一项\n- 第二项\n\n[链接](https://example.com)\n', 'utf8')
    const exportHandler = routes.get('GET /api/plugins/banyan.docx/export')!
    const exportRes = await exportHandler(new Request('http://x/api/plugins/banyan.docx/export?path=export-me.md'))
    expect(exportRes.status).toBe(200)
    expect(exportRes.headers.get('content-type')).toContain('wordprocessingml')

    const exported = Buffer.from(await exportRes.arrayBuffer())
    const roundTrip = await mammoth.extractRawText({ buffer: exported })
    expect(roundTrip.value).toContain('导出测试')
    expect(roundTrip.value).toContain('第一项')
    expect(roundTrip.value).toContain('链接')

    // missing path param → 400
    const badRes = await exportHandler(new Request('http://x/api/plugins/banyan.docx/export'))
    expect(badRes.status).toBe(400)

    rmSync(tmp, { recursive: true, force: true })
  })
})
