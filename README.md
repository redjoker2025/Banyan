# Banyan（榕）

本地优先、插件化的笔记软件（Web 版）。Markdown 文件夹是唯一事实来源，
索引与日志全部可由文件夹重建；插件内核内嵌 [Cordis](https://github.com/cordiverse/cordis)
（服务容器 + 声明式依赖注入 + 可逆副作用 + 类型化事件）。

> **Status: M2（插件系统 v0）已完成。** 本地 Node 服务 + 浏览器 UI + 完整插件系统：
> 打开 vault、编辑自动保存、FTS5 搜索、双标签同步、插件 manifest 严格校验 /
> 冲突检测 / 权限代理（fs.globs / net.domains）/ 审计日志 / 禁用即卸载；
> 附 4 个官方插件（字数统计、反向链接、标签聚合、今日笔记）与 3 个演示插件
> （冲突 ×2、越权 ×1）。

A local-first, plugin-based note-taking app for the web. Your folder of
Markdown files is the single source of truth — the index and journals are
always rebuildable. Built on an embedded Cordis kernel with a capability-based
plugin system (declared permissions, runtime interception, conflict detection
and residue-free uninstall).

## 30 秒上手

```powershell
# 环境要求：Node.js >= 22、pnpm >= 9
pnpm install
pnpm test          # 内核冒烟 + 服务端/插件管理器测试（72 用例）
pnpm --filter @banyan/web build   # 构建前端静态资源（首次需要）
pnpm web -- --vault D:\path\to\notes   # 启动并自动打开浏览器
# 开发模式（前端热更）：pnpm dev（服务端）+ pnpm dev:web（Vite）
```

服务仅绑定 `127.0.0.1:3210`（`--port` 可改）。首次启动生成随机 token 写入
`<vault>/.banyan/config.json`，之后重启复用同一 token；浏览器需带
`?token=` 参数（启动器已自动拼接）。

打开后点击顶栏「插件」启用官方插件：**字数统计**（保存瀑布链 + 状态栏）、
**反向链接**（`[[wiki]]` 链接图）、**标签聚合**（frontmatter tags 过滤）、
**今日笔记**（命令：打开/创建 `YYYY-MM-DD.md`）；「冲突演示 A/B」与
「越权演示」用于演示冲突报错（409 指名双方）与越权拦截（写入 `audit.jsonl`）。

## 架构一句话

`vendor/cordis`（内核，只读内嵌）→ `@banyan/core`（ctx key 契约 + 类型化事件 +
内核扩展）→ `@banyan/plugin-manager`（manifest 校验 / 权限代理 / 冲突检测）→
`@banyan/server`（Hono REST + WS）→ `@banyan/web`（Vue 3 + CodeMirror 6 + 插件宿主）。

## 差异化卖点（架构基石）

1. **插件权限声明与运行时拦截**——manifest 声明 `fs.globs` / `net.domains` /
   `exec`，越权调用抛错并写入审计日志
2. **安装/启用时冲突检测**——`provides` key 唯一性（409 指名双方）、`inject` 可满足性
3. **卸载无残留**——一切注册经内核 effect 机制，LIFO 顺序自动释放；客户端 UI
   扩展点随禁用全部撤销

## 文档

- [docs/dev/plugin-spec.md](docs/dev/plugin-spec.md) — 插件规范（manifest / 权限 / 扩展点）
- [docs/dev/vendor.md](docs/dev/vendor.md) — 内嵌 Cordis 的来源、版本与修改政策
- [docs/dev/decisions.md](docs/dev/decisions.md) — 开发决策记录
- [docs/dev/test-report-m1.md](docs/dev/test-report-m1.md) — M1 图文测试报告
- （截图占位：M2 界面截图待补）

## License

[MIT](LICENSE)
