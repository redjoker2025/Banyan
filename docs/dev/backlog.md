# Backlog（按 §7：发现「不做清单」外的诱惑功能一律先记录，不实现）

- 索引漂移检测：除「空即重建」外，按 mtime 增量比对 vault 与索引的差异（M1 期间未做，见 decisions.md D9）
- web 构建产物代码分割（vite manualChunks）：当前单 chunk 约 590KB，本地服务场景无碍
- 服务端优雅关闭时向 WS 客户端广播提示
