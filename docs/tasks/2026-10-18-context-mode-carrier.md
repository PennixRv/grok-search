# Context Mode 执行载体

落实根任务 `codex-workflow-optimization/10-18-context-mode-fastctx-replacement` 的已批准限定修改。Grok CLI 可通过原生入口或 Context Mode 执行；CLI 继续拥有 provider、凭据、重试、后备及输出合同。载体须保留 cwd、参数、退出码和完整状态。秘密操作不进入自动索引。本次不修改服务商实现，不包含现有 provider-layer 结果文档差异。
