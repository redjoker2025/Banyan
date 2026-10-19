import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { IndexServiceImpl } from '../src/services/indexer.ts'
import { VaultServiceImpl } from '../src/services/vault.ts'

let vaultDir: string
let vault: VaultServiceImpl
let index: IndexServiceImpl

beforeAll(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), 'banyan-index-'))
  vault = new VaultServiceImpl(vaultDir)
  index = new IndexServiceImpl(path.join(vaultDir, '.banyan', 'index.db'), vault)

  writeFileSync(path.join(vaultDir, 'kotlin.md'), '# Kotlin 笔记\n\nKotlin 是一门现代编程语言', 'utf8')
  writeFileSync(
    path.join(vaultDir, 'front.md'),
    '---\ntitle: 来自 Frontmatter\n---\n\nfrontmatter 正文内容',
    'utf8',
  )
  writeFileSync(path.join(vaultDir, 'hello.md'), 'say hello world loudly', 'utf8')
  await index.rebuild()
})

afterAll(() => {
  index.close()
  rmSync(vaultDir, { recursive: true, force: true })
})

describe('index service: FTS5 over title + body (M1 §6.4)', () => {
  it('rebuilds the index from the vault and searches titles and bodies', async () => {
    const hits = await index.search('Kotlin')
    expect(hits.map((h) => h.path)).toContain('kotlin.md')
    expect(hits[0]?.title).toBe('Kotlin 笔记')
  })

  it('uses frontmatter title when present', async () => {
    const hits = await index.search('来自 Frontmatter')
    expect(hits.map((h) => h.path)).toContain('front.md')
    expect(hits[0]?.title).toBe('来自 Frontmatter')
  })

  it('finds CJK substrings via the trigram tokenizer and returns snippets', async () => {
    const hits = await index.search('编程语言')
    expect(hits.map((h) => h.path)).toContain('kotlin.md')
    expect(hits[0]?.snippet).toBeTruthy()
  })

  it('falls back to LIKE for queries shorter than 3 characters', async () => {
    const hits = await index.search('笔记')
    expect(hits.map((h) => h.path)).toContain('kotlin.md')
  })

  it('removes deleted notes from search results', async () => {
    index.remove('hello.md')
    expect(await index.search('hello world')).toHaveLength(0)
  })

  it('rebuild() re-syncs the index with current disk state (delete index.db → rebuild)', async () => {
    // simulate drift: content changed on disk after the last upsert
    writeFileSync(path.join(vaultDir, 'kotlin.md'), '# Kotlin\n\n全新内容 unique-rebuild-marker', 'utf8')
    expect(await index.search('unique-rebuild-marker')).toHaveLength(0)
    await index.rebuild()
    const hits = await index.search('unique-rebuild-marker')
    expect(hits.map((h) => h.path)).toContain('kotlin.md')
  })
})
