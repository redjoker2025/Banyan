import { describe, expect, it } from 'vitest'
import { Context } from '@cordisjs/core'
import '@banyan/core'

declare module '@cordisjs/core' {
  interface Events<in C extends import('@cordisjs/core').Context = import('@cordisjs/core').Context> {
    'test/order'(n: number): void
    'test/async'(n: number): Promise<number> | number
  }
}

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('kernel: remaining dispatch modes (§4.1.5)', () => {
  it('emit observes listeners in registration order, without awaiting', async () => {
    const app = new Context()
    const order: number[] = []
    const d1 = app.on('test/order', (n) => order.push(n + 1))
    const d2 = app.on('test/order', (n) => order.push(n + 2))

    app.emit('test/order', 10)
    expect(order).toEqual([11, 12])

    d1()
    d2()
  })

  it('parallel fans out concurrently and awaits completion', async () => {
    const app = new Context()
    let done = 0
    app.on('test/async', async () => {
      await tick(10)
      done++
    })
    app.on('test/async', async () => {
      await tick(10)
      done++
    })
    await app.parallel('test/async', 0)
    expect(done).toBe(2)
  })

  it('serial awaits listeners in sequence and short-circuits on the first returned value', async () => {
    const app = new Context()
    const order: string[] = []
    // first listener returns undefined: serial continues
    app.on('test/async', async () => {
      order.push('a-start')
      await tick(10)
      order.push('a-end')
    })
    app.on('test/async', async () => {
      order.push('b-start')
      return 2
    })
    app.on('test/async', async () => {
      order.push('c-start')
      return 3
    })
    const result = await app.serial('test/async', 0)
    expect(result).toBe(2)
    expect(order).toEqual(['a-start', 'a-end', 'b-start']) // c never ran: serial bails on 2
  })
})
