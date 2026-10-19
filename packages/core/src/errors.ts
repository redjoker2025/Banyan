/**
 * Unified error hierarchy for Banyan.
 * Every error carries a stable machine-readable `code` (§8 工程约定).
 */

export type BanyanErrorCode =
  | 'E_PERMISSION_DENIED'
  | 'E_CONFLICT'
  | 'E_MANIFEST_INVALID'
  | 'E_PATH_OUTSIDE_VAULT'
  | 'E_API_VERSION_UNSUPPORTED'
  | 'E_MISSING_DEPENDENCY'
  | 'E_NOT_FOUND'
  | 'E_VAULT_NOT_SET'

export class BanyanError extends Error {
  constructor(
    public readonly code: BanyanErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BanyanError'
  }
}

export class PermissionDeniedError extends BanyanError {
  constructor(
    /** id of the plugin that attempted the call */
    public readonly pluginId: string,
    /** human-readable description of the required permission */
    public readonly required: string,
    message?: string,
  ) {
    super(
      'E_PERMISSION_DENIED',
      message
        ?? `plugin "${pluginId}" is not permitted to ${required} (declare it in manifest permissions)`,
    )
    this.name = 'PermissionDeniedError'
  }
}

export class ConflictError extends BanyanError {
  constructor(message: string) {
    super('E_CONFLICT', message)
    this.name = 'ConflictError'
  }
}

export class ManifestInvalidError extends BanyanError {
  constructor(pluginId: string, issues: string) {
    super('E_MANIFEST_INVALID', `manifest of "${pluginId}" is invalid: ${issues}`)
    this.name = 'ManifestInvalidError'
  }
}

export class PathOutsideVaultError extends BanyanError {
  constructor(path: string) {
    super('E_PATH_OUTSIDE_VAULT', `path escapes the vault: ${path}`)
    this.name = 'PathOutsideVaultError'
  }
}
