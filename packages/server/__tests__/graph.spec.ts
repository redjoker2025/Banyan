import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { GraphServiceImpl, extractLinkTargets, resolveLinkSafe } from '../src/services/graph.ts'
import { VaultServiceImpl } from '../src/services/vault.ts'

let vaultDir: string
let vault: VaultServiceImpl
let graph: GraphServiceImpl

beforeAll(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), 'banyan-graph-'))
  vault = new VaultServiceImpl(vaultDir)
  graph = new GraphServiceImpl(vault)
  mkdirSync(path.join(vaultDir, 'sub'), { recursive: true })
  writeFileSync(path.join(vaultDir, 'welcome.md'), 'root note', 'utf8')
  writeFileSync(path.join(vaultDir, 'sub', 'kotlin.md'), '# Kotlin\n\n参考 [[welcome]]、[[meeting]] 和 [[sub/meeting|周会]] 与 [笔记](./kotlin-notes.md)\n外部: [官网](https://kotlinlang.org) 和 [锚点](#section)\n', 'utf8')
  writeFileSync(path.join(vaultDir, 'sub', 'meeting.md'), '# 周会\n\n见 [[welcome]] 与 [[sub/kotlin#标题]]\n', 'utf8')
  writeFileSync(path.join(vaultDir, 'sub', 'kotlin-notes.md'), 'notes', 'utf8')
})

afterAll(() => {
  try {
    rmSync(vaultDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('graph service: links & backlinks (§4.2, M2)', () => {
  it('resolves bare wiki links to notes anywhere in the vault (basename match)', async () => {
    const links = await graph.links('sub/kotlin.md')
    expect(links).toContain('welcome.md')
    expect(links).toContain('sub/meeting.md')
  })

  it('resolves path-style links relative to the note directory', async () => {
    const links = await graph.links('sub/kotlin.md')
    expect(links).toContain('sub/kotlin-notes.md')
  })

  it('ignores external URLs and bare anchors', async () => {
    const links = await graph.links('sub/kotlin.md')
    expect(links.some((l) => l.includes('kotlinlang'))).toBe(false)
    expect(links).toHaveLength(3) // welcome, meeting, kotlin-notes
  })

  it('supports [[target#heading]] and [[target|alias]]', async () => {
    const links = await graph.links('sub/meeting.md')
    expect(links).toContain('welcome.md')
    expect(links).toContain('sub/kotlin.md')
  })

  it('finds backlinks across the vault', async () => {
    const backlinks = await graph.backlinks('welcome.md')
    expect(backlinks).toContain('sub/kotlin.md')
    expect(backlinks).toContain('sub/meeting.md')
    const backlinksKotlin = await graph.backlinks('sub/kotlin.md')
    expect(backlinksKotlin).toContain('sub/meeting.md')
  })
})

describe('link extraction helpers', () => {
  it('extracts markdown and wiki targets, skipping externals', () => {
    const targets = extractLinkTargets('[a](b.md) [[c]] [[d#h]] [[e|alias]] [x](https://out.com) [y](#frag)')
    expect(targets).toEqual(['b.md', 'c', 'd', 'e'])
  })

  it('resolveLinkSafe keeps the legacy relative behavior exported for tests', () => {
    expect(resolveLinkSafe('sub/a.md', '../top.md')).toBe('top.md')
  })
})
