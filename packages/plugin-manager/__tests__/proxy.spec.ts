import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createCapabilities, PermissionDenied } from '../src/proxy.ts'
import { AuditLog } from '../src/audit.ts'
import type { BanyanManifest } from '../src/manifest.ts'

function manifest(partial: Partial<BanyanManifest>): BanyanManifest {
  return {
    id: 'banyan.probe',
    name: 'Probe',
    version: '0.1.0',
    banyanApi: '^0.1',
    description: 'test fixture',
    inject: [],
    provides: [],
    permissions: { fs: { globs: [] }, net: { domains: [] }, exec: false },
    entry: { client: './client.js' },
    ...partial,
  }
}

const hostVault = {
  read: async (rel: string) => `content-of-${rel}`,
  write: async () => {},
  list: async () => [],
  delete: async () => {},
}
const hostGraph = {
  backlinks: async (rel: string) => [`${rel}-source`],
  links: async (rel: string) => [`${rel}-target`],
}

let dir: string
function setup(partial: Partial<BanyanManifest>) {
  dir = mkdtempSync(path.join(tmpdir(), 'banyan-proxy-'))
  const audit = new AuditLog(path.join(dir, 'audit.jsonl'))
  const caps = createCapabilities(manifest(partial), { vault: hostVault, graph: hostGraph }, audit, async () => new Response('ok'))
  return { audit, caps, auditFile: path.join(dir, 'audit.jsonl') }
}

describe('permission proxy (§4.5)', () => {
  it('allows vault calls inside declared globs and denies others with PermissionDenied', async () => {
    const { caps } = setup({ permissions: { fs: { globs: ['notes/**'] }, net: { domains: [] }, exec: false } })
    await expect(caps.vault.read('notes/a.md')).resolves.toBe('content-of-notes/a.md')
    await expect(caps.vault.write('notes/deep/a.md', 'x')).resolves.toBeUndefined()
    await expect(caps.vault.read('secret.md')).rejects.toMatchObject({
      name: 'PermissionDenied',
      pluginId: 'banyan.probe',
      required: 'vault.read secret.md',
    })
    await expect(caps.vault.delete('other/b.md')).rejects.toBeInstanceOf(PermissionDenied)
  })

  it('writes a denied call to audit.jsonl', async () => {
    const { caps, auditFile } = setup({ permissions: { fs: { globs: [] }, net: { domains: [] }, exec: false } })
    await expect(caps.vault.read('x.md')).rejects.toBeInstanceOf(PermissionDenied)
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n')
    const entry = JSON.parse(lines[0]!) as { ts: number; pluginId: string; action: string; required: string }
    expect(entry.pluginId).toBe('banyan.probe')
    expect(entry.action).toBe('vault.read')
    expect(entry.required).toBe('x.md')
    expect(entry.ts).toBeGreaterThan(0)
  })

  it('gates graph path calls with the same globs', async () => {
    const { caps } = setup({ permissions: { fs: { globs: ['**'] }, net: { domains: [] }, exec: false } })
    await expect(caps.graph.backlinks('a.md')).resolves.toEqual(['a.md-source'])
    const { caps: strict } = setup({ permissions: { fs: { globs: [] }, net: { domains: [] }, exec: false } })
    await expect(strict.graph.links('a.md')).rejects.toBeInstanceOf(PermissionDenied)
  })

  it('allows net.fetch to declared domains only, denies before any I/O', async () => {
    let fetched = 0
    const spyFetch = async (): Promise<Response> => {
      fetched++
      return new Response('ok')
    }
    const dirTmp = mkdtempSync(path.join(tmpdir(), 'banyan-proxy-net-'))
    const audit = new AuditLog(path.join(dirTmp, 'audit.jsonl'))
    const caps = createCapabilities(
      manifest({ permissions: { fs: { globs: [] }, net: { domains: ['allowed.example.com'] }, exec: false } }),
      { vault: hostVault, graph: hostGraph },
      audit,
      spyFetch,
    )
    await expect(caps.net.fetch('https://allowed.example.com/api')).resolves.toBeInstanceOf(Response)
    expect(fetched).toBe(1)

    await expect(caps.net.fetch('https://evil.example.com/api')).rejects.toBeInstanceOf(PermissionDenied)
    expect(fetched).toBe(1) // the denied call never reached the network

    const lines = readFileSync(path.join(dirTmp, 'audit.jsonl'), 'utf8').trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1]!) as { action: string; required: string; detail: string }
    expect(last.action).toBe('net.fetch')
    expect(last.required).toBe('evil.example.com')
    expect(last.detail).toContain('net.domains')
    rmSync(dirTmp, { recursive: true, force: true })
  })
})
