import { describe, expect, it } from 'vitest'
import { parseManifest, checkApiCompat, HOST_API_VERSION } from '../src/manifest.ts'
import { ManifestInvalidError } from '@banyan/core'

const valid = {
  id: 'banyan.word-count',
  name: '字数统计',
  version: '0.1.0',
  banyanApi: '^0.1',
  description: '在状态栏显示当前笔记字数',
  inject: ['pipeline', 'logger'],
  provides: [],
  permissions: {
    fs: { globs: [] },
    net: { domains: [] },
    exec: false,
  },
  entry: { server: './dist/server/index.js' },
}

describe('plugin manifest v0 strict validation (§5, M2)', () => {
  it('accepts the canonical manifest from the prompt', () => {
    expect(parseManifest(valid).id).toBe('banyan.word-count')
  })

  it('accepts a client-only entry', () => {
    expect(() => parseManifest({ ...valid, entry: { client: './client/index.js' }, id: 'banyan.tags' })).not.toThrow()
  })

  it('rejects unknown top-level fields (typo protection)', () => {
    expect(() => parseManifest({ ...valid, permissons: { fs: { globs: [] } } })).toThrow(ManifestInvalidError)
    expect(() => parseManifest({ ...valid, entry: { server: './x.js', extra: 1 } })).toThrow(ManifestInvalidError)
  })

  it('rejects unknown fields nested in permissions', () => {
    expect(() =>
      parseManifest({
        ...valid,
        permissions: { fs: { globs: [] }, net: { domains: [] }, exec: false, extra: 1 },
      }),
    ).toThrow(ManifestInvalidError)
  })

  it('rejects when neither server nor client entry exists', () => {
    expect(() => parseManifest({ ...valid, entry: {} })).toThrow(/entry/)
  })

  it('rejects a malformed id and a non-semver version', () => {
    expect(() => parseManifest({ ...valid, id: 'word-count' })).toThrow(ManifestInvalidError)
    expect(() => parseManifest({ ...valid, id: 'UPPER.name' })).toThrow(ManifestInvalidError)
    expect(() => parseManifest({ ...valid, version: '0.1' })).toThrow(ManifestInvalidError)
  })

  it('reports every issue path in the error message', () => {
    try {
      parseManifest({ id: 'bad', name: '' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestInvalidError)
      expect((e as ManifestInvalidError).message).toMatch(/\(root\)|name/)
    }
  })
})

describe('banyanApi compatibility check (§5)', () => {
  it('accepts a compatible range', () => {
    expect(checkApiCompat({ id: 'x.y', banyanApi: '^0.1' })).toBeUndefined()
    expect(checkApiCompat({ id: 'x.y', banyanApi: '>=0.1.0 <1.0.0' })).toBeUndefined()
  })

  it('rejects an incompatible range with a naming message', () => {
    const msg = checkApiCompat({ id: 'banyan.future', banyanApi: '^9.0' })
    expect(msg).toContain('banyan.future')
    expect(msg).toContain(HOST_API_VERSION)
  })
})
