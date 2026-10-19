import type { Context } from '@cordisjs/core'

/**
 * Typed event declarations (§4.1.6) — centralized here via module augmentation.
 * Pipeline domains are dispatched with the onion-style `waterfall` mode.
 */

/** Metadata passed through the `pipeline/save` waterfall */
export interface SaveMeta {
  /** vault-relative path being saved, `/` separators */
  path: string
  /** id of the plugin that initiated the save (omitted for direct user edits) */
  initiator?: string
}

/** Delegate to the next listener; resolves with the chained downstream result */
export type PipelineNext = () => Promise<string>

declare module '@cordisjs/core' {
  interface Events<in C extends Context = Context> {
    /**
     * Pre-save transform chain (waterfall).
     * Listeners receive `(content, meta, next)`; return the transformed
     * content, or call `next()` to pass the content through unchanged.
     */
    'pipeline/save'(content: string, meta: SaveMeta, next: PipelineNext): unknown
  }

  interface Context {
    waterfall(name: 'pipeline/save', content: string, meta: SaveMeta): Promise<string>
    waterfall(name: string, ...args: any[]): Promise<unknown>
  }
}
