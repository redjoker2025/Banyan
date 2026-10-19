# Backlog（按 §7：发现「不做清单」外的诱惑功能一律先记录，不实现）

- 索引漂移检测：除「空即重建」外，按 mtime 增量比对 vault 与索引的差异（M1 期间未做，见 decisions.md D9）
- web 构建产物代码分割（vite manualChunks）：当前单 chunk 约 590KB，本地服务场景无碍
- 服务端优雅关闭时向 WS 客户端广播提示
- 应用内对话框替换原生 prompt/confirm（新建/重命名/删除），M2 客户端插件宿主落地时一并处理（见 test-report-m1.md §6.1）
- 客户端插件 worker 沙箱：M2 仅做「声明 + 撤销」，真正的执行隔离延后
