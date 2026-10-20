import { describe, expect, it } from 'vitest'
import { globToRegExp, matchAnyGlob } from '../src/glob.ts'

describe('fs.globs permission matcher (§4.5)', () => {
  it('matches * within one segment only', () => {
    const re = globToRegExp('notes/*.md')
    expect(re.test('notes/a.md')).toBe(true)
    expect(re.test('notes/deep/a.md')).toBe(false)
  })

  it('matches ** across segments including none', () => {
    const re = globToRegExp('notes/**/*.md')
    expect(re.test('notes/a.md')).toBe(true)
    expect(re.test('notes/deep/deeper/a.md')).toBe(true)
    expect(re.test('other/a.md')).toBe(false)
  })

  it('supports ** as the whole pattern', () => {
    expect(matchAnyGlob('any/deep/path.md', ['**'])).toBe(true)
    expect(matchAnyGlob('a.md', ['**'])).toBe(true)
  })

  it('does not match when globs are empty (deny by default)', () => {
    expect(matchAnyGlob('a.md', [])).toBe(false)
  })

  it('escapes regex metacharacters in the pattern', () => {
    const re = globToRegExp('a(b).md')
    expect(re.test('a(b).md')).toBe(true)
    expect(re.test('aab.md')).toBe(false)
  })

  it('supports ? for a single character', () => {
    expect(globToRegExp('note?.md').test('note1.md')).toBe(true)
    expect(globToRegExp('note?.md').test('note12.md')).toBe(false)
  })

  it('normalizes backslashes from Windows-style patterns', () => {
    expect(matchAnyGlob('notes/deep/a.md', ['notes\\**\\*.md'])).toBe(true)
  })
})
