# Vendor 说明：Cordis 内核

## 来源与版本

| 项 | 值 |
|---|---|
| 包名 | `@cordisjs/core` |
| 版本 | **3.18.1** |
| 上游仓库 | https://github.com/cordiverse/cordis（MIT） |
| 获取方式 | `npm pack @cordisjs/core`（回退方案，见下） |
| 获取日期 | 2026-10-19 |
| 原作者 | Shigma <shigma10826@gmail.com> and cordis contributors |

## 获取过程记录

按构建提示词 §6 M0 的要求，首选方案是克隆
`https://github.com/deepseek-ai/deepseek-harness` 并按其 `vendor/README.md`
复制 cordis 相关内容。**实际执行时该仓库在当前网络环境下克隆挂起
（约 12 分钟 0 字节传输，FETCH_HEAD 始终未生成），WebFetch 访问同样失败**，
判定为克隆失败，遂按提示词的既定回退方案执行：

```
npm pack @cordisjs/core --pack-destination <临时目录>
tar -xzf cordisjs-core-3.18.1.tgz
# 将解包内容复制到 vendor/cordis/
```

## 目录内容

- `lib/`：上游编译产物（`index.mjs` / `index.cjs` / `index.d.ts`），运行时与类型解析入口
- `src/`：上游 TypeScript 源码（只读参考，与 lib 对应）
- `LICENSE`：npm 包内未随附 LICENSE 文件，本文件按上游 package.json 的
  `license: MIT` 与 `author` 字段补齐了标准 MIT 文本与版权声明
- `package.json`：保留上游原样，仅作为 workspace 成员参与 pnpm 安装
  （其唯一运行时依赖 `cosmokit` 由 pnpm 正常安装）

## 本地修改政策

**vendor 目录保持上游原样，不做源码级修改。** Banyan 对内核语义的扩展
一律通过运行时补丁或外部封装实现，集中在 `@banyan/core`：

1. `waterfall` 分发模式（洋葱式 `next()`）：vendor 无此模式，见
   `packages/core/src/waterfall.ts`（实现）与 `docs/dev/decisions.md` D1
2. LIFO 释放顺序：vendor 的 `EffectScope.reset()` 为 FIFO，通过运行时补丁
   调整，见 `packages/core/src/kernel.ts` 与 decisions.md D2

以上补丁依赖 vendor 的具体内部结构，因此 vendor 版本被锁定为 3.18.1；
升级 vendor 前必须先跑 `packages/core/__tests__/` 的内核冒烟测试。

## 升级流程（未来）

1. `npm pack @cordisjs/core@<新版>` 解包覆盖 `vendor/cordis/`
2. 核对 `src/` 中 `EffectScope.reset`、`Lifecycle._hooks`、
   `ReflectService.handler` 是否有破坏性变更
3. `pnpm -w test` 全绿后更新本文件的版本与日期记录
