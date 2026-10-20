/**
 * word-count server entry — demonstrates the `pipeline/save` waterfall:
 * the listener delegates downstream with `next()` first, then counts the
 * words of the final content and publishes it as `plugin.state`.
 */
interface SaveMeta {
  path: string
}

export default {
  inject: ['pipeline', 'broadcast', 'logger'],

  apply(ctx: any) {
    ctx.on('pipeline/save', async (content: string, meta: SaveMeta, next: () => Promise<string>) => {
      const result = await next() // delegate to downstream listeners first (onion order)
      const count = countWords(result)
      ctx.broadcast({
        type: 'plugin.state',
        payload: { plugin: 'banyan.word-count', counts: { [meta.path]: count } },
      })
      ctx.logger.info(`[word-count] ${meta.path}: ${count} words`)
      return result
    })
  },
}

function countWords(content: string): number {
  const cjk = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}
