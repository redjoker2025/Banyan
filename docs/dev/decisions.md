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

---

## D6 · 用户配置服务键名 `ctx.config` → `ctx.settings`（2026-10-19，M1）

**关联**：§4.2

§4.2 将用户配置服务命名为 `ctx.config`，但 Cordis 内核**保留** `ctx.config`
作为插件自身配置（root/scope 级 accessor，经 `_mixin` 注入，无法被
`ctx.set` 覆盖，运行时写入会静默失败）。冲突不可调和，故用户配置服务改以
**`ctx.settings`** 键注册，持久化文件仍为 `<vault>/.banyan/config.json`。
M2 插件声明依赖时写 `inject: ["settings"]`。提示词契约的其他 key（vault /
index / graph / logger / ai）无冲突，保持不变。

---

## D7 · FTS5 采用 trigram tokenizer + 短查询 LIKE 回退（2026-10-19，M1）

**关联**：§4.2 `ctx.index`、M1 验收

默认 `unicode61` 分词器把连续 CJK 文本当作单个 token，无法满足中文子串检索。
索引改用 FTS5 `tokenize='trigram'`（better-sqlite3 内置支持）：查询 ≥ 3 字符时
以短语匹配获得子串语义并可用 `snippet()`；< 3 字符（常见中文双字词）回退到
notes 表 LIKE 查询（body 冗余存储于 notes 表以支持回退）。

---

## D8 · 笔记 API 以 query/body 寻址而非路径段（2026-10-19，M1）

**关联**：M1 REST 设计

笔记相对路径含 `/`、中文字符与 `%` 等保留字符，放进 URL 路径段会引入
双重解码歧义。统一改为 `GET/DELETE /api/note?path=…`、`PUT /api/note`
（body 携带 path），通配符路径方案弃用。REST 语义不变，编码行为确定。

---

## D9 · 启动时索引为空即全量重建（2026-10-19，M1）

**关联**：§4.3「索引永远是派生物」、M1 验收「删除 index.db 后重启自动重建」

`openVault()` 在 `notes` 表为空时自动执行 `rebuild()`。检测手段刻意保守
（空即重建）而非校验和比对：M1 阶段够用且覆盖「首次打开 / index.db 被删 /
损坏后清空」三种场景；漂移检测记录到 backlog。

---

## D10 · 新增宿主能力键 `net` 与 `broadcast`（2026-10-20，M2）

**关联**：§4.5 net.domains、§4.3 plugin.state

§4.2 的 key 表没有插件可用的网络能力与数据广播通道，但 §4.5 要求 `net.domains`
权限可被拦截、官方插件 word-count 需要把统计数据推给客户端。故新增两个宿主能力：
- `ctx.net`：`{ fetch(url, init) }`，仅允许 manifest `net.domains` 声明的域名，
  拦截发生在任何网络 I/O 之前；
- `ctx.broadcast`：`{ (event) }` 发布 WS `plugin.state` 数据事件。

## D11 · 能力键全局占位 + 门面下发（2026-10-20，M2）

**关联**：§4.5 权限代理的实现方式

Cordis 的服务注册表是全局的（`ctx.plugin()` 挂载时不再继承调用方的 isolate 视图），
无法用 per-plugin isolate 实现「每个插件看到自己的代理实例」。采用：
1. **全局占位**：`vault` / `graph` / `net` 三个键全局注册为抛错占位（保证
   `inject` 可满足性），任何 `ctx.get('vault')` 式绕过直接抛错；
2. **门面下发**：插件管理器包装插件，`apply` 收到的 ctx 是以真实 fork ctx 为
   原型的门面对象，其 `vault` / `graph` / `net` 属性指向权限代理实例。
   门面继承 Cordis 的 effect/监听语义，内核冒烟与管理器测试双重锁定
   （卸载 LIFO、无残留均不破坏）。

## D12 · plugin.state 数据快照与新客户端重放（2026-10-20，M2）

**关联**：§4.3 WS 实时刷新

带 `plugin` 键的 `plugin.state` 数据事件只广播给在线客户端，后连接的浏览器会
缺失状态（验收中发现：字数统计在新标签页不显示）。服务端现在按插件留存最新
数据快照，并在 WS `onOpen` 时逐条重放。管理器生命周期事件（`{id, enabled}`）
不进快照。

## D13 · wiki 链接解析采用「相对优先 + basename 全局回退」（2026-10-20，M2）

**关联**：§4.2 ctx.graph

`[[welcome]]` 这类不带路径的 wiki 链接若仅按相对目录解析，子目录笔记会得到
不存在的路径（验收中发现 backlinks 面板为空）。最终语义：先按相对路径解析；
若结果不在 vault 中，则以 basename 在全库匹配（Obsidian 风格）；仍无则保留
相对解析结果。Markdown 链接与 `[[dir/name]]` 同样适用该回退。

## D14 · 插件 HTTP 路由用「通配分发器 + 查表」而非动态 addRoute（2026-10-27，0.2.0）

**关联**：§3.4 ctx.http

docx 插件需要自有 HTTP 路由（导入/导出），宿主新增能力键 `http`。
第一版实现直接 `app.on(method, path, handler)` 动态注册，实测 0.2.0 安装产物
（tarball 真实安装）时插件路由 404：**Hono 的 RegExpRouter 在第一个请求到达时
编译路由缓存，之后动态 addRoute 的路由不会进缓存**。服务器一启动就有首页请求
触发编译，而插件路由注册发生在启用时（必然晚于首次请求），因此永远 404；
测试环境全绿是因为所有请求都发生在注册之后——正是「测试通过 ≠ 产物正确」的
典型案例。

最终方案：宿主启动时注册一次通配路由 `app.all('/api/plugins/:id/*')`，请求按
`method + pathname` 在运行时 Map 中查表分发。附带收益：未注册的路由返回结构化
`404 E_NOT_FOUND` 而非 Hono 默认空 404；`/api/plugins/<id>/` 命名空间从机制上
不可被插件逃逸。

## D15 · vault.exists 接口化（2026-10-27，0.2.0）

**关联**：§3.1 ctx.vault

docx 导入需要「重名 409」语义，此前 VaultService 只有 read/write/list/delete。
将 `exists(path): Promise<boolean>` 纳入 `@banyan/core` 的 VaultService 契约与
权限代理（fs.globs 逐调用校验），而不是让插件 read + try/catch 探测——后者
会把正常探测记成错误路径，且对大文件无谓读全文。

## D16 · npm 产物预编译插件 entry 并注入 createRequire banner（2026-10-27，0.2.0）

**关联**：scripts/build-npm.mjs

npm 发布形态下没有 tsx，插件 server entry（.ts）必须预编译为 .mjs；mammoth/docx
等依赖 bundle 进产物。CJS 库内部对 Node 内置模块的 `require()` 在 ESM 输出中
会被 esbuild 包成 `__require` shim，运行时抛
`Dynamic require of "url" is not supported`（tarball 真实安装实测发现）。
修复：预编译时统一注入 banner
`import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`
与主 bundle 保持一致。另：`file:` 目录依赖安装（npm 仅建 junction）无法替代
tarball 真实安装做发布前验证——首次 0.2.0 验证即因 junction 直接执行了构建
暂存目录而漏测。
