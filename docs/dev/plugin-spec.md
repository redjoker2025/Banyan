# Banyan 插件规范 v0（plugin-spec）

> 本文档面向插件作者，描述 Banyan v0 的插件格式、能力模型、权限系统与扩展点。
> 配套示例见仓库 `plugins/` 目录（4 个官方插件 + 3 个演示插件）。

## 1. 插件结构

一个插件是一个包含 `plugin.json`（manifest）的目录：

```
my-plugin/
├── plugin.json          # manifest（见 §2，zod 严格校验）
├── server/index.ts      # 可选：服务端入口（Node 进程内运行）
└── client/index.js      # 可选：客户端入口（浏览器 ESM，无构建要求）
```

安装位置：`<vault>/.banyan/installed/<dir>/`（用户安装）或仓库 `plugins/`（随附插件）。
扫描时同一 id 以先出现的目录为准；manifest 或 API 版本有误的插件标记为不可启用。

## 2. manifest（plugin.json）

```json
{
  "id": "banyan.word-count",
  "name": "字数统计",
  "version": "0.1.0",
  "banyanApi": "^0.1",
  "description": "在状态栏显示当前笔记字数",
  "inject": ["pipeline", "broadcast", "logger"],
  "provides": [],
  "permissions": {
    "fs": { "globs": [] },
    "net": { "domains": [] },
    "exec": false
  },
  "entry": { "server": "./server/index.ts", "client": "./client/index.js" }
}
```

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一，反域名风格小写（如 `banyan.word-count`） |
| `banyanApi` | 语义化版本范围；宿主 `0.1.0` 不满足则拒绝启用 |
| `inject` / `provides` | 依赖与提供的 ctx key；冲突检测依据（§4） |
| `permissions` | 未声明的访问一律拒绝（§5）；**未知字段整个 manifest 校验失败** |
| `entry.server` / `entry.client` | 双面入口，至少声明一个 |

## 3. 服务端插件

入口默认导出 `apply(ctx)`（Cordis 插件对象，可带 `inject`）：

```ts
export default {
  inject: ['pipeline', 'broadcast', 'logger'],
  apply(ctx) {
    ctx.on('pipeline/save', async (content, meta, next) => {
      const result = await next()          // 洋葱式：先委托下游
      ctx.broadcast({ type: 'plugin.state', payload: { plugin: 'banyan.word-count', counts: { [meta.path]: count(result) } } })
      return result
    })
  },
}
```

### 3.1 可注入的 ctx key

| key | 类型 | 说明 |
|---|---|---|
| `ctx.vault` | 能力 | 笔记读写（read/write/list/delete），**经权限代理** |
| `ctx.graph` | 能力 | links(path) / backlinks(path)，**经权限代理** |
| `ctx.net` | 能力 | fetch(url)，**仅允许 `net.domains` 中声明的域名，拦截发生在任何 I/O 之前** |
| `ctx.index` | 服务 | search(q) / rebuild()（全局只读派生数据） |
| `ctx.settings` | 服务 | `<vault>/.banyan/config.json` 读写 |
| `ctx.logger` | 服务 | 结构化日志 |
| `ctx.pipeline` | 服务 | `{ save(listener) }` 注册 `pipeline/save` 瀑布监听的便捷封装 |
| `ctx.broadcast` | 服务 | `{ (event) }` 发布 WS `plugin.state` 数据 |

**重要**：`vault` / `graph` / `net` 三个能力键在全局 ctx 上是抛错占位——插件必须通过
`apply(ctx)` 收到的**门面 ctx**（插件管理器注入）访问它们，门面上的实例即权限代理。
`ctx.get('vault')` 之类的绕过会直接抛错。

### 3.2 pipeline/save 瀑布

保存路径：`PUT /api/note` → `waterfall('pipeline/save', content, { path })` → 落盘 → 索引 → journal → WS 广播。
监听器签名 `(content, meta, next)`：调 `next()` 委托下游并包装其返回值；不调 `next()` 直接返回 = 短路。

### 3.3 数据广播

`ctx.broadcast({ type: 'plugin.state', payload: { plugin: '<id>', ...data } })` 会：
1. WS 广播给所有在线客户端；2. 由服务端留存快照，**新连接的客户端自动重放**。

## 4. 冲突检测（启用时）

1. **provides 唯一性**：两个插件提供同一 key → `E_CONFLICT`（409），错误信息与 `parties` 列出双方 id
2. **inject 可满足性**：key 必须是宿主内置（vault/index/graph/net/settings/logger/pipeline/broadcast）或已被启用插件提供 → 否则 `E_MISSING_DEPENDENCY`

启用列表持久化于 `config.json` 的 `enabledPlugins`，重启自动恢复。

## 5. 权限模型（§4.5）

| 权限 | 作用 | 拦截方式 |
|---|---|---|
| `fs.globs` | vault 相对路径白名单（支持 `**`/`*`/`?`） | vault/graph 的每个含 path 调用逐一校验 |
| `net.domains` | 允许访问的域名 | `ctx.net.fetch` 在 I/O 之前校验 |
| `exec` | 声明是否允许执行子进程 | v0 仅声明不强制（进程内沙箱为 backlog） |

越权调用：抛 `PermissionDenied`（含插件 id 与所需权限），并追加
`<vault>/.banyan/audit.jsonl`：`{ts, pluginId, action, required, detail}`。
演示：启用「越权演示」插件即可观察拦截 + 审计全过程。

## 6. 客户端插件

入口默认导出 `activate(host)`，`host` 提供四个扩展点（每个注册函数返回 dispose）：

```js
export function activate(host) {
  host.registerPanel({ side: 'right', title: '反向链接', render(el, api) { /* DOM 操作；返回清理函数 */ } })
  host.registerStatusbar((api) => '…')            // 返回字符串，随状态实时刷新
  host.registerCommand({ id: 'x.y', title: '…', run(api) {} })
  host.registerEditorExtension((cm) => Extension) // cm = { EditorView, EditorState, keymap, lineNumbers }
}
```

`api` 对象（实时 getter）：`currentPath` / `content` / `charCount` / `pluginState` /
`openNote(path)` / `apiFetch(path, init)`（自动带 token）/ `onNoteChange(cb)`（返回退订函数）。

**禁用即卸载**：插件禁用时其全部 UI 注册按 LIFO 撤销；客户端入口经
`/plugins/<id>/client?token=` 动态 import，无需构建。

## 7. 生命周期与卸载语义

- 服务端插件挂载在 Cordis 上：监听/定时器/服务注册均为可逆 effect，禁用时 **LIFO 自动释放**
- 客户端插件注册表由宿主持有 dispose，禁用时逆序撤销
- 切换 vault 时自动卸载全部插件并重建插件管理器

## 8. 已知限制（v0）

- 服务端插件与宿主同进程运行，无法阻止其直接 import Node 内置模块（`exec` 权限因此仅声明）；
  真正的执行隔离（worker 沙箱）在 backlog
- `ctx.index.search` 为全局只读能力，不做 per-path 授权
