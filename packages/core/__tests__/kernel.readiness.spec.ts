import { describe, expect, it } from 'vitest'
import { Context, Service } from '@cordisjs/core'
import '@banyan/core'

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('kernel: declarative dependency injection (§4.1.3)', () => {
  it('holds a plugin in waiting until all injected services are ready', async () => {
    const app = new Context()
    const order: string[] = []

    app.plugin({
      name: 'consumer',
      inject: ['provider'],
      apply(ctx) {
        order.push('consumer-started')
        expect(ctx.get('provider')).toEqual({ value: 42 })
      },
    })

    await tick()
    // provider is missing: the consumer must not have started
    expect(order).toEqual([])

    app.set('provider', { value: 42 })
    await tick()
    // provider registered: the consumer starts automatically
    expect(order).toEqual(['consumer-started'])
  })

  it('starts immediately when all injected services are already present', async () => {
    const app = new Context()
    app.set('provider', { value: 1 })
    let started = false
    app.plugin({
      inject: ['provider'],
      apply() {
        started = true
      },
    })
    await tick()
    expect(started).toBe(true)
  })

  it('validates the §4.2 contract pattern: typed Service + inject', async () => {
    class Counter extends Service {
      count = 0
      inc() {
        this.count++
      }
    }

    const app = new Context()
    let consumerReady = false

    // registered first so that it must wait for the service
    app.plugin({
      inject: ['counter'],
      apply(ctx) {
        consumerReady = true
        ;(ctx.get('counter') as Counter).inc()
      },
    })
    app.plugin({
      name: 'counter-provider',
      apply(ctx) {
        ;(ctx as any).counter = new Counter(ctx, 'counter')
      },
    })

    await app.start()
    expect(consumerReady).toBe(true)
    expect((app as any).counter.count).toBe(1)
  })
})
