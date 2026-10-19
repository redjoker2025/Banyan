# 开发决策记录

按时间顺序记录实现决策与理由。每条决策注明日期与关联的提示词章节。

---

## D1 · waterfall 分发模式由 @banyan/core 补实现（2026-10-19）

**关联**：§4.1.5

构建提示词要求 5 种事件分发模式，其中 waterfall 为洋葱式中间件（监听器收到
`(...args, next)`，调 `next()` 委托下游并可包装其返回值；不调 `next()` 直接返回 =
短路）。实际 vendor（@cordisjs/core 3.18.1）只提供 emit / parallel / serial / bail
四种模式，**没有 waterfall**。

**决策**：不改 vendor 源码，在 `packages/core/src/waterfall.ts` 独立实现，并以
`Context.prototype.waterfall` 挂到所有 Context 实例上。

**语义细节**：
- 监听器复用 cordis 的常规事件注册（`ctx.on(name, listener)`），因此可逆性、
  按 scope 过滤等语义与其他模式完全一致；
- 链尾自然结束（所有监听器都调用了 `next()`）时，`next()` 以**事件首参数**
  作为透传值返回，例如 `pipeline/save` 无变换时内容原样通过；
- `next()` 重复调用直接拒绝（Koa 同款防呆）；
- 与 cordis 内部 `internal/event` 观测事件解耦（该事件的 type 联合类型锁死了
  四种模式，不宜为 waterfall 扩展 vendor 类型）。

**理由**：vendor 内嵌的要求是"保留其 LICENSE 与版权声明、不做业务代码修改"，
把扩展放在自家包里可测试、可升级，且冒烟测试（kernel.waterfall.spec.ts）会
在 vendor 升级时第一时间暴露内部结构漂移（实现依赖 `lifecycle._hooks` 与
`lifecycle.filterHooks`）。

---

## D2 · LIFO 释放顺序以运行时补丁实现（2026-10-19）

**关联**：§4.1.4（"卸载时按 LIFO 顺序自动释放"）

vendor 的 `EffectScope.reset()` 按**注册顺序（FIFO）**执行 disposables，与提示词
要求的 LIFO 不符。

**决策**：在 `packages/core/src/kernel.ts`（随 `@banyan/core` 导入自动生效）对
`EffectScope.prototype.reset` 打运行时补丁：反转 disposables 的执行顺序，其余
语义（`Context.static` 标记的保留项、错误经 `internal/error` 上报、空数组幂等）
逐条保持与原实现一致。

**理由**：LIFO 影响"后注册的清理逻辑依赖先注册的资源"这一常见场景（例如
后注册的 listener 关闭先注册的服务）。补丁版本锁定 vendor 3.18.1，冒烟测试
（kernel.dispose.spec.ts）断言 LIFO 顺序与幂等性，vendor 升级时立即验证。

---

## D3 · serial 的短路语义如实记录（2026-10-19）

**关联**：§4.1.5

提示词将 serial 描述为"按序 await"；vendor 实现为**按序 await 且首个非空
返回值短路**（`isBailed` 判定：非 `undefined/null/false`）。本仓库不修改该行为，
`pipeline` 域不会使用 serial，事件文档与测试（kernel.dispatch.spec.ts）按
vendor 真实语义书写。

---

## D4 · pnpm 12 工程配置位置（2026-10-19）

**关联**：§8

- pnpm ≥ 11 移除了 `package.json#pnpm` 与 `onlyBuiltDependencies` 等旧配置，
  构建脚本白名单统一写入 `pnpm-workspace.yaml` 的 `allowBuilds` 映射
  （当前：esbuild、better-sqlite3）；
- `tsconfig.base.json` 启用 `allowImportingTsExtensions`（配合 noEmit），源码
  内部相对导入统一带 `.ts` 扩展名（与 vendor 源码风格一致，vitest 直接可跑）；
- 包之间互相引用使用 workspace 依赖（`"@cordisjs/core": "workspace:*"`、
  `"@banyan/core": "workspace:*"`），`main`/`exports` 直接指向 `src/index.ts`，
  由 vitest/vite 的 TS 管线处理，编译产物发布不在本期范围（§7）。

---

## D5 · deepseek-harness 参考文档缺失的替代（2026-10-19）

**关联**：§9

提示词引用的 `deepseek-ai/deepseek-harness` 仓库（含 `docs/cordis-primer.zh.md`）
在当前网络环境不可达（git 与 WebFetch 均失败）。内核语义的核对依据改为：
vendor 源码（`vendor/cordis/src/`）+ 官方 README + 冒烟测试实证。若日后网络
可达，按 §9 补充阅读，仅作参考、不复制业务代码。
