import { describe, expect, it } from 'vitest'
import { Context } from '@cordisjs/core'
import '@banyan/core'

declare module '@cordisjs/core' {
  interface Events<in C extends import('@cordisjs/core').Context = import('@cordisjs/core').Context> {
    'test/bail'(): string | undefined
  }
}

describe('kernel: bail dispatch (§4.1.5)', () => {
  it('short-circuits at the first listener returning a bail value', () => {
    const app = new Context()
    const calls: string[] = []

    app.on('test/bail', () => {
      calls.push('a')
      return undefined
    })
    app.on('test/bail', () => {
      calls.push('b')
      return 'found'
    })
    app.on('test/bail', () => {
      calls.push('c')
      return 'never'
    })

    expect(app.bail('test/bail')).toBe('found')
    expect(calls).toEqual(['a', 'b'])
  })

  it('returns the first listener result immediately', () => {
    const app = new Context()
    const calls: string[] = []

    app.on('test/bail', () => {
      calls.push('first')
      return 'immediate'
    })
    app.on('test/bail', () => {
      calls.push('second')
      return 'ignored'
    })

    expect(app.bail('test/bail')).toBe('immediate')
    expect(calls).toEqual(['first'])
  })

  it('returns undefined when no listener produces a bail value', () => {
    const app = new Context()
    app.on('test/bail', () => undefined)
    expect(app.bail('test/bail')).toBeUndefined()
  })
})
