/**
 * @banyan/core — ctx key contracts, typed events and kernel-level extensions
 * for the vendored Cordis framework.
 *
 * Importing this package has the side effect of installing the kernel
 * extensions (see ./kernel.ts and ./waterfall.ts).
 */
import { Context } from '@cordisjs/core'
import { waterfall } from './waterfall.ts'
import './kernel.ts'

// Attach the waterfall dispatch mode (§4.1.5) to every context.
;(Context.prototype as any).waterfall = function (this: Context, name: string, ...args: any[]) {
  return waterfall(this, name, args)
}

export * from './errors.ts'
export * from './keys.ts'
export * from './events.ts'
export { waterfall }
