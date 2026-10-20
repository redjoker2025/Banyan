import type { GraphService } from '@banyan/core'
import { VaultServiceImpl } from './vault.ts'

/**
 * `ctx.graph` — Markdown link & wiki-link resolution (§4.2).
 * Purely derived from the vault folder; no index needed.
 *
 * Link resolution:
 * - targets with a path separator resolve relative to the note's directory
 * - bare `[[name]]` wiki links resolve Obsidian-style: an existing note whose
 *   basename matches wins, otherwise they fall back to the relative location
 */
export class GraphServiceImpl implements GraphService {
  constructor(private readonly vault: VaultServiceImpl) {}

  private async allNotePaths(): Promise<string[]> {
    return (await this.vault.list()).filter((e) => e.type === 'file').map((e) => e.path)
  }

  /** outgoing links of a note (Markdown links + `[[wiki links]]`) */
  async links(rel: string): Promise<string[]> {
    const content = await this.vault.read(rel)
    const all = await this.allNotePaths()
    const out = new Set<string>()
    for (const target of extractLinkTargets(content)) {
      out.add(this.resolveTarget(rel, target, all))
    }
    return Array.from(out).filter((p) => p !== rel)
  }

  /** notes whose links point at `rel` */
  async backlinks(rel: string): Promise<string[]> {
    const files = (await this.vault.list()).filter((e) => e.type === 'file')
    const sources: string[] = []
    for (const file of files) {
      if (file.path === rel) continue
      try {
        const content = await this.vault.read(file.path)
        const targets = extractLinkTargets(content).map((t) => this.resolveTarget(file.path, t, files.map((f) => f.path)))
        if (targets.includes(rel)) sources.push(file.path)
      } catch {
        // unreadable notes are skipped silently
      }
    }
    return sources
  }

  private resolveTarget(fromRel: string, target: string, allPaths: string[]): string {
    const clean = target.split('#')[0]!.trim()
    if (!clean) return fromRel
    const relative = finalizePath(relativeResolve(fromRel, clean))
    if (allPaths.includes(relative)) return relative
    // the relative location does not exist → fall back to a global basename
    // match (Obsidian-style `[[name]]` and mis-rooted `[[dir/name]]` links)
    const wanted = relative.replace(/\.md$/i, '').split('/').pop()!.toLowerCase()
    const hit = allPaths.find((p) => p.replace(/\.md$/i, '').split('/').pop()!.toLowerCase() === wanted)
    return hit ?? relative
  }
}

/** Extract link targets that may point at vault notes (skip external/anchors). */
export function extractLinkTargets(content: string): string[] {
  const targets: string[] = []
  // Markdown links: [text](target "title")
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)) {
    const target = match[1]!
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue // http(s)/mailto/anchor
    if (/^\/\//.test(target)) continue
    targets.push(target)
  }
  // Wiki links: [[target]], [[target#heading]], [[target|alias]]
  for (const match of content.matchAll(/\[\[([^\]#|]+)/g)) {
    targets.push(match[1]!.trim())
  }
  return targets
}

function relativeResolve(fromRel: string, clean: string): string {
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : ''
  const joined = clean.startsWith('/') ? clean.slice(1) : dir ? `${dir}/${clean}` : clean
  const stack: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function finalizePath(out: string): string {
  return out.toLowerCase().endsWith('.md') ? out : `${out}.md`
}

/** Relative-only resolution kept exported for tests and simple callers. */
export function resolveLinkSafe(fromRel: string, target: string): string {
  return finalizePath(relativeResolve(fromRel, target.split('#')[0]!.trim()))
}
