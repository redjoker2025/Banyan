import { describe, expect, it } from 'vitest'
import { Context } from '@cordisjs/core'
import '@banyan/core'

describe('kernel: waterfall dispatch (§4.1.5)', () => {
  it('wraps downstream results in onion order', async () => {
    const app = new Context()
    const calls: string[] = []

    const d1 = app.on('pipeline/save', async (content, meta, next) => {
      calls.push('l1-before')
      const result = await next()
      calls.push('l1-after')
      return `[1:${result}]`
    })
    const d2 = app.on('pipeline/save', async (content, meta, next) => {
      calls.push('l2-before')
      const result = await next()
      calls.push('l2-after')
      return `[2:${result}]`
    })
    const d3 = app.on('pipeline/save', async (content, meta, next) => {
      calls.push('l3')
      return content.toUpperCase()
    })

    const result = await app.waterfall('pipeline/save', 'hello', { path: 'a.md' })
    expect(result).toBe('[1:[2:HELLO]]')
    expect(calls).toEqual(['l1-before', 'l2-before', 'l3', 'l2-after', 'l1-after'])

    d1()
    d2()
    d3()
  })

  it('short-circuits when a middle listener returns without calling next()', async () => {
    const app = new Context()
    const calls: string[] = []

    app.on('pipeline/save', (content, meta, next) => {
      calls.push('l1')
      return next()
    })
    app.on('pipeline/save', (content, meta, next) => {
      calls.push('l2')
      return 'short' // no next(): downstream must not run
    })
    app.on('pipeline/save', (content, meta, next) => {
      calls.push('l3')
      return next()
    })

    const result = await app.waterfall('pipeline/save', 'x', { path: 'a.md' })
    expect(result).toBe('short')
    expect(calls).toEqual(['l1', 'l2'])
  })

  it('passes the first argument through when the chain ends or is empty', async () => {
    const app = new Context()

    // no listeners at all
    expect(await app.waterfall('pipeline/save', 'raw', { path: 'a.md' })).toBe('raw')

    // trailing listener that only delegates
    app.on('pipeline/save', async (content, meta, next) => next())
    expect(await app.waterfall('pipeline/save', 'raw', { path: 'a.md' })).toBe('raw')
  })

  it('rejects when a listener throws', async () => {
    const app = new Context()
    app.on('pipeline/save', () => {
      throw new Error('boom')
    })
    await expect(app.waterfall('pipeline/save', 'x', { path: 'a.md' })).rejects.toThrow('boom')
  })

  it('is reversed when the plugin that registered listeners is unloaded', async () => {
    const app = new Context()
    const plugin = {
      apply(ctx: Context) {
        ctx.on('pipeline/save', (content, meta, next) => `${content}-p`)
      },
    }
    app.plugin(plugin)
    await new Promise((r) => setTimeout(r, 20))
    expect(await app.waterfall('pipeline/save', 'x', { path: 'a.md' })).toBe('x-p')

    app.registry.delete(plugin)
    await new Promise((r) => setTimeout(r, 20))
    expect(await app.waterfall('pipeline/save', 'x', { path: 'a.md' })).toBe('x')
  })
})
