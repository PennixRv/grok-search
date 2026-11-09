# 生命周期 owner 协议与外部字段保护

根任务 `11-09-lifecycle-audit-findings-convergence` 已获完整实施、发布、重装及收尾批准。WP-S 中 Grok 的真实源码位于本仓，集合只通过固定提交物化，不直接维护第二份实现。本仓没有 Trellis 初始化，沿用 `docs/tasks/` 记录，不自动初始化。

本次在 `scripts/lib/lifecycle.js` 复用 owner 规则加入无写入 validate、protocol_version=1、操作身份与副作用回执；部分外部字段及兼容别名不再被当作 missing 覆盖；可信孤立 receipt 只允许受控撤回。失败回执不泄露输入，只有文件字节、权限和目录状态恢复才报告 restored。

验收使用隔离 HOME/XDG/CODEX_HOME、空宿主凭据环境的原生 npm test；不调用真实 Grok/Tavily。源码提交推送后，集合从精确提交重新物化，并独立运行协议及集合检查；最终由 Lifecycle 原生升级和根集成核对固定来源。不扩大为真实远端功能已通过。
