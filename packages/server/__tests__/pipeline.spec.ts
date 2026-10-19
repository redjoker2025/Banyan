import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Context } from '@cordisjs/core'
import '@banyan/core'
import { createRuntime, openVault, saveNote } from '../src/runtime.ts'
import type { ServerRuntime } from '../src/runtime.ts'

let vaultDir: string
let rt: ServerRuntime
const events: unknown[] = []

beforeAll(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), 'banyan-pipeline-'))
  const ctx = new Context()
  rt = createRuntime(ctx, 'test-token', (event) => events.push(event))
  await openVault(rt, vaultDir)
})

afterAll(() => {
  // release the sqlite handle before removing the temp dir (Windows)
  try {
    rt.index?.close()
  } catch {
    // ignore
  }
  try {
    rmSync(vaultDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup on Windows
  }
})

describe('pipeline/save waterfall on the save path (M1 §6.4, §4.1.5)', () => {
  it('passes content through unchanged when no listener is registered', async () => {
    const out = await saveNote(rt, 'plain.md', 'raw content')
    expect(out).toBe('raw content')
    expect(readFileSync(path.join(vaultDir, 'plain.md'), 'utf8')).toBe('raw content')
    expect(events.at(-1)).toMatchObject({ type: 'note.updated', payload: { path: 'plain.md' } })
  })

  it('applies a single transforming listener before hitting the disk', async () => {
    const dispose = rt.ctx.on('pipeline/save', (content, meta, next) => {
      expect(meta.path).toBe('transformed.md')
      return next().then((down) => `${down}\n\n<!-- appended by plugin -->`)
    })
    const out = await saveNote(rt, 'transformed.md', 'body')
    expect(out).toBe('body\n\n<!-- appended by plugin -->')
    expect(readFileSync(path.join(vaultDir, 'transformed.md'), 'utf8')).toBe('body\n\n<!-- appended by plugin -->')
    dispose()
  })

  it('chains two listeners in onion order', async () => {
    const order: string[] = []
    const d1 = rt.ctx.on('pipeline/save', async (content, meta, next) => {
      order.push('l1-before')
      const down = await next()
      order.push('l1-after')
      return `[1:${down}]`
    })
    const d2 = rt.ctx.on('pipeline/save', async (content, meta, next) => {
      order.push('l2')
      return content.trim()
    })
    const out = await saveNote(rt, 'chained.md', '  spaced  ')
    expect(out).toBe('[1:spaced]')
    expect(order).toEqual(['l1-before', 'l2', 'l1-after'])
    expect(readFileSync(path.join(vaultDir, 'chained.md'), 'utf8')).toBe('[1:spaced]')
    d1()
    d2()
  })

  it('short-circuits: a listener returning without next() prevents downstream and disk write of it', async () => {
    const calls: string[] = []
    const d1 = rt.ctx.on('pipeline/save', (content, meta, next) => {
      calls.push('l1')
      return 'blocked'
    })
    const d2 = rt.ctx.on('pipeline/save', (content, meta, next) => {
      calls.push('l2')
      return next()
    })
    const out = await saveNote(rt, 'short.md', 'original')
    expect(out).toBe('blocked')
    expect(calls).toEqual(['l1'])
    expect(readFileSync(path.join(vaultDir, 'short.md'), 'utf8')).toBe('blocked')
    d1()
    d2()
  })

  it('appends an update record to the append-only journal (§4.3)', async () => {
    await saveNote(rt, 'journalled.md', 'journal me')
    const journalFile = path.join(vaultDir, '.banyan', 'journal.jsonl')
    expect(existsSync(journalFile)).toBe(true)
    const lines = readFileSync(journalFile, 'utf8').trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1]!) as { ts: number; type: string; path: string; hash?: string }
    expect(last.type).toBe('updated')
    expect(last.path).toBe('journalled.md')
    expect(last.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
