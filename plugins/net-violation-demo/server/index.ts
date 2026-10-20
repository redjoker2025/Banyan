/**
 * Net violation demo — declares `net.domains: [example.com]` but attempts to
 * reach api.github.com at startup. The permission proxy denies the call
 * BEFORE any network I/O and appends an entry to `audit.jsonl` (§4.5).
 */
export default {
  inject: ['net', 'logger'],

  async apply(ctx: any) {
    try {
      await ctx.net.fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness')
      ctx.logger.warn('[net-violation] call unexpectedly allowed — permission proxy is missing!')
    } catch (e) {
      ctx.logger.warn(`[net-violation] blocked as expected: ${e.message}`)
    }
  },
}
