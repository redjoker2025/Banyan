import { z } from 'zod'
import semver from 'semver'
import { ManifestInvalidError } from '@banyan/core'
import type { BanyanErrorCode } from '@banyan/core'

/**
 * Plugin manifest v0 (`plugin.json`, §5) — strict: unknown fields are
 * rejected so that a misspelled permission never silently disappears.
 */
export const manifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/, 'expect reverse-domain style id like "banyan.word-count"'),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+/, 'expect semver like 0.1.0'),
    banyanApi: z.string().min(1),
    description: z.string().min(1),
    inject: z.array(z.string()),
    provides: z.array(z.string()),
    permissions: z
      .object({
        fs: z.object({ globs: z.array(z.string()) }).strict(),
        net: z.object({ domains: z.array(z.string()) }).strict(),
        exec: z.boolean(),
      })
      .strict(),
    entry: z
      .object({
        server: z.string().optional(),
        client: z.string().optional(),
      })
      .strict()
      .refine((entry) => entry.server !== undefined || entry.client !== undefined, {
        message: 'at least one of entry.server / entry.client is required',
      }),
  })
  .strict()

export type BanyanManifest = z.infer<typeof manifestSchema>

/** Parse and validate a manifest; throws ManifestInvalidError on any issue. */
export function parseManifest(raw: unknown, pluginIdHint = '<unknown>'): BanyanManifest {
  const result = manifestSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new ManifestInvalidError(pluginIdHint, issues)
  }
  return result.data
}

/** Host API version published by this build of Banyan. */
export const HOST_API_VERSION = '0.1.0'

/**
 * banyanApi compatibility check (§5): returns an error message when the
 * plugin's declared range does not accept the host API version.
 */
export function checkApiCompat(manifest: Pick<BanyanManifest, 'banyanApi' | 'id'>): string | undefined {
  if (!semver.satisfies(HOST_API_VERSION, manifest.banyanApi, { includePrerelease: true })) {
    return `plugin "${manifest.id}" requires banyanApi ${manifest.banyanApi} but host provides ${HOST_API_VERSION}`
  }
  return undefined
}

/** Error payload shape used across manager failures. */
export interface ManagerFailure {
  code: BanyanErrorCode | 'E_INTERNAL'
  message: string
  /** ids participating in a provides conflict, for UI display */
  parties?: string[]
}

export class PluginManagerError extends Error {
  constructor(
    public readonly failure: ManagerFailure,
  ) {
    super(failure.message)
    this.name = 'PluginManagerError'
  }
}
