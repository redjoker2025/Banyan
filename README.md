# Banyan（榕）

本地优先、插件化的笔记软件（Web 版）。Markdown 文件夹是唯一事实来源，
索引与日志全部可由文件夹重建；插件内核内嵌 [Cordis](https://github.com/cordiverse/cordis)
（服务容器 + 声明式依赖注入 + 可逆副作用 + 类型化事件）。

> **Status: M0（内核冒烟）已完成。** 当前仓库只包含内核契约与内核冒烟测试，
> Web 服务端与客户端将在后续里程碑（M1/M2）中实现。

A local-first, plugin-based note-taking app for the web. Your folder of
Markdown files is the single source of truth — the index and journals are
always rebuildable. Built on an embedded Cordis kernel with a capability-based
plugin system (declared permissions, runtime interception, conflict detection
and residue-free uninstall).

## 30 秒上手

```powershell
# 环境要求：Node.js >= 22、pnpm >= 9
pnpm install
pnpm test   # 运行内核冒烟测试（当前阶段的主要交付物）
```

`pnpm dev`（启动 Web 服务）将在 M1 里程碑后可用。

## 架构一句话

`vendor/cordis`（内核，只读内嵌）→ `@banyan/core`（ctx key 契约 + 类型化事件 +
内核扩展）→ `@banyan/plugin-manager`（manifest 校验 / 权限代理 / 冲突检测）→
`@banyan/server`（Hono REST + WS）→ `@banyan/web`（Vue 3 + CodeMirror 6）。

## 差异化卖点（架构基石）

1. **插件权限声明与运行时拦截**——manifest 声明 `fs.globs` / `net.domains` /
   `exec`，越权调用抛错并写入审计日志
2. **安装/启用时冲突检测**——`provides` key 唯一性、`inject` 可满足性
3. **卸载无残留**——一切注册经内核 effect 机制，LIFO 顺序自动释放

## 文档

- [docs/dev/vendor.md](docs/dev/vendor.md) — 内嵌 Cordis 的来源、版本与修改政策
- [docs/dev/decisions.md](docs/dev/decisions.md) — 开发决策记录
- docs/dev/plugin-spec.md — 插件规范（M2 里程碑落地）

## License

[MIT](LICENSE)
