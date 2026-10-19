import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { VaultServiceImpl, fromVaultPath, toVaultPath } from '../src/services/vault.ts'

let vaultDir: string
let vault: VaultServiceImpl

beforeAll(() => {
  vaultDir = mkdtempSync(path.join(tmpdir(), 'banyan-vault-'))
  vault = new VaultServiceImpl(vaultDir)
})

afterAll(() => {
  // best-effort cleanup; Windows may hold transient file locks
  try {
    rmSync(vaultDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('vault service (M1 §6.4)', () => {
  it('writes, reads and deletes notes, creating parent folders on write', async () => {
    await vault.write('notes/deep/idea.md', '# Idea\n\nhello banyan')
    expect(await vault.read('notes/deep/idea.md')).toBe('# Idea\n\nhello banyan')
    expect(await vault.exists('notes/deep/idea.md')).toBe(true)

    await vault.delete('notes/deep/idea.md')
    expect(await vault.exists('notes/deep/idea.md')).toBe(false)
  })

  it('lists directories and .md files recursively but never exposes .banyan', async () => {
    await vault.write('a.md', 'a')
    await vault.write('sub/b.md', 'b')
    // non-note files and runtime metadata are created outside the vault API
    writeFileSync(path.join(vaultDir, 'sub', 'ignore.txt'), 'not a note', 'utf8')
    mkdirSync(path.join(vaultDir, '.banyan'), { recursive: true })
    writeFileSync(path.join(vaultDir, '.banyan', 'hidden.md'), 'secret', 'utf8')

    const items = await vault.list()
    const paths = items.map((i) => i.path)
    expect(paths).toContain('a.md')
    expect(paths).toContain('sub')
    expect(paths).toContain('sub/b.md')
    expect(paths).not.toContain('sub/ignore.txt')
    expect(paths.some((p) => p.includes('.banyan'))).toBe(false)
  })

  it('refuses vault-API access into the runtime metadata directory', async () => {
    await expect(vault.write('.banyan/evil.md', 'x')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
    await expect(vault.read('.banyan/config.json')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
  })

  it('rejects paths escaping the vault whitelist (§4.3, §8)', async () => {
    await expect(vault.read('../escape.md')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
    await expect(vault.write('..\\escape.md', 'x')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
    await expect(vault.write('a/../../escape.md', 'x')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
    await expect(vault.read('C:/Windows/evil.md')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
    await expect(vault.delete('/abs/evil.md')).rejects.toMatchObject({ code: 'E_PATH_OUTSIDE_VAULT' })
  })

  it('rejects non-markdown writes and missing reads with typed errors', async () => {
    await expect(vault.write('picture.png', 'binary')).rejects.toMatchObject({ code: 'E_CONFLICT' })
    await expect(vault.read('missing.md')).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
    await expect(vault.delete('missing.md')).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
  })

  it('converts between OS paths and vault-relative paths in one module (§8)', () => {
    expect(toVaultPath(vaultDir, path.join(vaultDir, 'sub', 'b.md'))).toBe('sub/b.md')
    expect(fromVaultPath(vaultDir, 'sub/b.md')).toBe(path.join(vaultDir, 'sub', 'b.md'))
    expect(() => toVaultPath(vaultDir, tmpdir())).toThrow()
  })
})
