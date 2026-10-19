import { Context, EffectScope } from '@cordisjs/core'

/**
 * Kernel patch: dispose effects in LIFO order (§4.1.4 requires LIFO reversal;
 * stock Cordis 3.18.1 disposes in registration order / FIFO).
 *
 * The vendor source is kept pristine; this runtime patch reverses only the
 * iteration order of `EffectScope.reset()` while preserving its semantics:
 * - disposables marked with `Context.static === this` are kept (not disposed),
 * - disposal errors are contained and re-emitted as `internal/error`,
 * - calling it on an already-disposed scope is a no-op.
 */
const originalReset = EffectScope.prototype.reset

EffectScope.prototype.reset = function (this: EffectScope) {
  this.isActive = false
  const snapshot = this.disposables.splice(0)
  const keep: Array<() => void> = []
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const dispose = snapshot[i]
    if (!dispose) continue
    if (this.uid !== null && (dispose as any)[Context.static] === this) {
      keep.unshift(dispose)
      continue
    }
    void (async () => dispose())().catch((reason) => {
      this.context.emit(this.ctx, 'internal/error', reason)
    })
  }
  this.disposables = keep
}

export { originalReset }
