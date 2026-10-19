import type { Context } from '@cordisjs/core'

/**
 * Onion-style waterfall dispatch (§4.1.5):
 *
 * - Listeners receive `(...args, next)`.
 * - Calling `next()` delegates to the remaining listeners and resolves with
 *   their chained result; a listener may wrap that result before returning it.
 * - Returning directly WITHOUT calling `next()` short-circuits: downstream
 *   listeners are not executed and the returned value becomes the result.
 * - When the chain ends naturally, `next()` resolves with the FIRST argument
 *   (pass-through), so a trailing listener like
 *   `async (content, meta, next) => { await next(); return transform(content) }`
 *   behaves intuitively.
 *
 * Listeners are the regular Cordis hooks registered via `ctx.on(name, ...)`,
 * which keeps reversal (dispose) semantics consistent with other events.
 * The result is always a promise; listener errors reject it.
 */
export function waterfall(ctx: Context, name: string, args: any[]): Promise<any> {
  const lifecycle = ctx.lifecycle as any
  const hooks: any[] = lifecycle.filterHooks(lifecycle._hooks[name] || [])
  const initial = args[0]

  const dispatch = (index: number): Promise<any> => {
    if (index >= hooks.length) return Promise.resolve(initial)
    const hook = hooks[index]
    if (!hook) return Promise.resolve(initial)
    return new Promise((resolve, reject) => {
      let consumed = false
      const next = () => {
        if (consumed) {
          reject(new Error(`next() called multiple times by a "${String(name)}" listener`))
          return Promise.resolve(initial)
        }
        consumed = true
        return dispatch(index + 1)
      }
      Promise.resolve()
        .then(() => hook.callback.apply(undefined, [...args, next]))
        .then(resolve, reject)
    })
  }

  return dispatch(0)
}
