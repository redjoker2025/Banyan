import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'
import { BanyanError, PathOutsideVaultError } from '@banyan/core'
import type { NoteEntry, VaultService } from '@banyan/core'

/**
 * Central place for OS-path <-> vault-relative-path conversion (§8).
 * Internal storage always uses `/` separators, independent of the OS.
 */
export function toVaultPath(root: string, abs: string): string {
  const rel = nodePath.relative(root, abs)
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    throw new PathOutsideVaultError(abs)
  }
  return rel.split(nodePath.sep).join('/')
}

export function fromVaultPath(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0')) {
    throw new PathOutsideVaultError(String(rel))
  }
  const normalized = rel.split('/').join(nodePath.sep)
  // the runtime metadata directory is managed by the server, not the vault API
  if (normalized.split(nodePath.sep).includes(METADATA_DIR)) {
    throw new PathOutsideVaultError(rel)
  }
  const abs = nodePath.resolve(root, normalized)
  if (abs !== root && !abs.startsWith(root + nodePath.sep)) {
    throw new PathOutsideVaultError(rel)
  }
  return abs
}

export function isNotePath(rel: string): boolean {
  return rel.toLowerCase().endsWith('.md')
}

const METADATA_DIR = '.banyan'

function isHidden(rel: string): boolean {
  return rel.split('/').includes(METADATA_DIR)
}

export class VaultServiceImpl implements VaultService {
  constructor(readonly root: string) {}

  async read(rel: string): Promise<string> {
    this.assertNote(rel)
    const abs = fromVaultPath(this.root, rel)
    try {
      return await fs.readFile(abs, 'utf8')
    } catch {
      throw new BanyanError('E_NOT_FOUND', `note not found: ${rel}`)
    }
  }

  async write(rel: string, content: string): Promise<void> {
    this.assertNote(rel)
    const abs = fromVaultPath(this.root, rel)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  async list(rel = ''): Promise<NoteEntry[]> {
    const base = rel ? fromVaultPath(this.root, rel) : this.root
    const out: NoteEntry[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const childRel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.name === METADATA_DIR) continue
        if (entry.isDirectory()) {
          out.push({ path: childRel, type: 'dir' })
          await walk(nodePath.join(dir, entry.name), childRel)
        } else if (entry.isFile() && isNotePath(entry.name)) {
          out.push({ path: childRel, type: 'file' })
        }
      }
    }
    await walk(base, rel ? rel.split('/').join('/') : '')
    return out
  }

  async delete(rel: string): Promise<void> {
    this.assertNote(rel)
    const abs = fromVaultPath(this.root, rel)
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile()) {
        throw new BanyanError('E_CONFLICT', `refusing to delete a non-file entry: ${rel}`)
      }
      await fs.unlink(abs)
    } catch (error) {
      if (error instanceof BanyanError) throw error
      throw new BanyanError('E_NOT_FOUND', `note not found: ${rel}`)
    }
  }

  /** real mtime of a note, for index bookkeeping */
  async mtime(rel: string): Promise<number> {
    const abs = fromVaultPath(this.root, rel)
    try {
      return (await fs.stat(abs)).mtimeMs
    } catch {
      return Date.now()
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      const stat = await fs.stat(fromVaultPath(this.root, rel))
      return stat.isFile()
    } catch {
      return false
    }
  }

  private assertAccess(rel: string): void {
    // metadata dir is checked first: it is off-limits regardless of extension
    const normalized = rel.split('/').join(nodePath.sep)
    if (normalized.split(nodePath.sep).includes(METADATA_DIR)) {
      throw new PathOutsideVaultError(rel)
    }
    if (!isNotePath(rel)) {
      throw new BanyanError('E_CONFLICT', `only Markdown (.md) notes are supported, got: ${rel}`)
    }
  }

  private assertNote(rel: string): void {
    this.assertAccess(rel)
  }
}
