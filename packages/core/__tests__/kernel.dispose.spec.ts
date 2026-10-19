import { describe, expect, it } from 'vitest'
import { Context } from '@cordisjs/core'
import '@banyan/core'

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))

declare module '@cordisjs/core' {
  interface Events<in C extends import('@cordisjs/core').Context = import('@cordisjs/core').Context> {
    'test/heartbeat'(): void
  }
}

describe('kernel: reversible registration (§4.1.4)', () => {
  it('releases services, listeners and timers on unload and disposes in LIFO order', async () => {
    const app = new Context()
    const events: string[] = []
    let timerFired = false

    const plugin = {
      name: 'reversible',
      apply(ctx: Context) {
        // 1st: a service (reverted via ctx.set)
        ctx.set('temp', { ok: true })
        // 2nd: an event listener
        ctx.on('test/heartbeat', () => events.push('beat'))
        // 3rd: a timer
        ctx.effect(() => {
          const t = setTimeout(() => {
            timerFired = true
          }, 30)
          return () => {
            clearTimeout(t)
            events.push('dispose:timer')
          }
        })
        // 4th: an ordinary effect
        ctx.effect(() => () => events.push('dispose:last'))
      },
    }

    app.plugin(plugin)
    await tick()

    // everything is live before unloading
    expect(app.get('temp')).toEqual({ ok: true })
    app.emit('test/heartbeat')
    expect(events).toContain('beat')

    app.registry.delete(plugin)
    await tick(60)

    // LIFO disposal order (last-registered effect disposed first)
    const disposes = events.filter((e) => e.startsWith('dispose:'))
    expect(disposes).toEqual(['dispose:last', 'dispose:timer'])

    // timer was cleared before firing
    expect(timerFired).toBe(false)

    // listener removed: no further beats
    app.emit('test/heartbeat')
    expect(events.filter((e) => e === 'beat')).toHaveLength(1)

    // service reverted
    expect(app.get('temp')).toBeUndefined()
  })

  it('does not throw when a plugin is unloaded twice', async () => {
    const app = new Context()
    const plugin = {
      apply(ctx: Context) {
        ctx.effect(() => () => undefined)
      },
    }
    app.plugin(plugin)
    await tick()
    app.registry.delete(plugin)
    await tick()
    expect(() => app.registry.delete(plugin)).not.toThrow()
  })
})
