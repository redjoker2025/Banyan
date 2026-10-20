import { describe, expect, it } from 'vitest'
import { checkConflicts } from '../src/conflict.ts'
import { PluginManagerError } from '../src/manifest.ts'
import type { BanyanManifest } from '../src/manifest.ts'

function manifest(partial: Partial<BanyanManifest>): BanyanManifest {
  return {
    id: 'banyan.under-test',
    name: 'UnderTest',
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

describe('conflict detection at enable time (§4.5)', () => {
  it('rejects two plugins providing the same key and names both parties', () => {
    const enabled = [manifest({ id: 'banyan.first', provides: ['demo.greeter'] })]
    try {
      checkConflicts(manifest({ id: 'banyan.second', provides: ['demo.greeter'] }), enabled)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(PluginManagerError)
      const failure = (e as PluginManagerError).failure
      expect(failure.code).toBe('E_CONFLICT')
      expect(failure.parties).toEqual(['banyan.first', 'banyan.second'])
      expect(failure.message).toContain('demo.greeter')
    }
  })

  it('rejects an inject key that nothing provides', () => {
    try {
      checkConflicts(manifest({ id: 'banyan.needy', inject: ['nonexistent-key'] }), [])
      expect.unreachable()
    } catch (e) {
      const failure = (e as PluginManagerError).failure
      expect(failure.code).toBe('E_MISSING_DEPENDENCY')
      expect(failure.message).toContain('banyan.needy')
      expect(failure.message).toContain('nonexistent-key')
    }
  })

  it('accepts when an enabled plugin provides the injected key', () => {
    const enabled = [manifest({ id: 'banyan.provider', provides: ['demo.graph-ext'] })]
    expect(() =>
      checkConflicts(manifest({ id: 'banyan.consumer', inject: ['demo.graph-ext'] }), enabled),
    ).not.toThrow()
  })

  it('accepts builtin host keys and the plugin own provides', () => {
    expect(() =>
      checkConflicts(manifest({ id: 'banyan.ok', inject: ['vault', 'logger', 'pipeline', 'own-key'], provides: ['own-key'] }), []),
    ).not.toThrow()
  })

  it('ignores self-provides duplicates', () => {
    expect(() => checkConflicts(manifest({ id: 'banyan.first', provides: ['demo.greeter'] }), [
      manifest({ id: 'banyan.first', provides: ['demo.greeter'] }),
    ])).not.toThrow()
  })
})
