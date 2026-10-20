/** Conflict demo A — provides `demo.greeter`; must never be enabled together with conflict demo B (§4.5). */
export default {
  apply(ctx: any) {
    ctx.logger.info('[conflict-a] demo plugin A is running, providing demo.greeter')
  },
}
