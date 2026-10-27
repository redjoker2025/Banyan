import { PluginManagerError } from './manifest.ts'
import type { BanyanManifest } from './manifest.ts'

/**
 * ctx keys provided by the Banyan host itself (§4.2 + host capabilities).
 * `net` and `broadcast` are host capability services added on top of the
 * §4.2 table (documented in docs/dev/decisions.md D10/D11).
 */
export const BUILTIN_INJECTABLE_KEYS = [
  'vault',
  'index',
  'graph',
  'net',
  'http',
  'settings',
  'logger',
  'pipeline',
  'broadcast',
] as const

/**
 * Conflict detection at enable/install time (§4.5):
 * 1. `provides` key uniqueness — two plugins providing the same key is fatal,
 *    the error lists BOTH ids.
 * 2. `inject` satisfiability — every injected key must exist as a builtin
 *    key or be provided by an already-enabled plugin (or the plugin itself).
 */
export function checkConflicts(
  candidate: BanyanManifest,
  enabled: BanyanManifest[],
): void {
  const providesOwner = new Map<string, string>()
  for (const plugin of enabled) {
    for (const key of plugin.provides) {
      providesOwner.set(key, plugin.id)
    }
  }

  for (const key of candidate.provides) {
    const owner = providesOwner.get(key)
    if (owner && owner !== candidate.id) {
      throw new PluginManagerError({
        code: 'E_CONFLICT',
        message: `plugins "${owner}" and "${candidate.id}" both provide ctx key "${key}" — they cannot be enabled at the same time`,
        parties: [owner, candidate.id],
      })
    }
  }

  const available = new Set<string>(BUILTIN_INJECTABLE_KEYS)
  for (const key of providesOwner.keys()) available.add(key)
  for (const key of candidate.provides) available.add(key)

  for (const key of candidate.inject) {
    if (!available.has(key)) {
      throw new PluginManagerError({
        code: 'E_MISSING_DEPENDENCY',
        message: `plugin "${candidate.id}" injects ctx key "${key}" which no enabled plugin provides and the host does not define`,
        parties: [candidate.id],
      })
    }
  }
}
