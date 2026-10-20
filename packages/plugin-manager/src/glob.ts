/**
 * Minimal glob matcher for `fs.globs` permission patterns (§4.5).
 * Supported syntax (vault-relative, `/` separators):
 * - `**` matches any number of path segments (including none)
 * - `*` matches anything except `/` within one segment
 * - `?` matches a single character except `/`
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll('\\', '/').replace(/^\/+/, '')
  let re = '^'
  for (let i = 0; i < normalized.length; i++) {
    const ch: string = normalized[i]!
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // consume the whole `**` (and a following slash) — crosses segments
        i++
        if (normalized[i + 1] === '/') i++
        re += '.*'
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replaceAll(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  re += '$'
  return new RegExp(re)
}

/** True when `rel` (vault-relative, `/` separators) matches ANY of the globs. */
export function matchAnyGlob(rel: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(rel))
}
