/** Conflict demo B — also provides `demo.greeter`; clashes with demo A (§4.5). */
export default {
  apply(ctx: any) {
    ctx.logger.info('[conflict-b] demo plugin B is running, providing demo.greeter')
  },
}
