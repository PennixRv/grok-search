# Grok Skill 检索分层合同修订

本源侧任务承接根任务 `/home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-11-pennix-skills-audit-gap-remediation/` 的 F09、N01 与 D4/D5/D10。当前只规划；实施批准沿根侧列明当前整包方案后的后续明确答复，不根据设计问答开始编辑。

## 目标与范围

修正 SKILL、references/providers.md 与实际示例中的服务商尝试层级，保持现有 CLI 算法、用户配置与凭据 owner。当前 main/HEAD 为 1af50d6e049d5349cbd44d1f398ea016bd70a37a；本仓库不初始化 Trellis。

## 选定合同

- CLI 原生有限 HTTP 尝试、Tavily/Direct 自动路径与单条命令 deadline 保持；代理不得据此重起命令、并行双跑或轮换 provider。
- Pennix 常规 search 显式 --no-extra；只有用户当前明确要求/批准额外来源才使用 --extra N，不通过读取/改写用户配置开启。
- 当前 search 先 Responses 后 extra，修正参考“并行”漂移；默认 retryMaxAttempts=3 是尝试总数，修正“重试 3 次”的说法。已有算法测试比静态词句更有力，不为文案变更复制实现断言。
- 满足来源/范围的可用 degraded 原始结果不触发代理 Hikari 后备；只有整条 Grok 命令不可用后允许一次自托管 Hikari 有界搜索/页面读取。内部失败不直接冒充命令失败，Hikari 是独立 owner/入口。
- 继续服从指定工具/来源、X-only、域名过滤、隐私、诊断和凭据边界；不新增 provider 或共享 key，不把调用次数当费用保证。
- D10 全部 Skill 统一 Pennix 前缀且简短正确：本真实源 Skill name 改为 pennix-grok-search，直接正文/UI/示例中的 Skill 引用同步；CLI grok-search、package、组件/配置标识保持原生名称。Pennix catalog 生成与模型场景按独立 Skill 身份映射，不在物化快照创建别名。

## 实施步骤

1. 获得已展示根侧当前修订包的后续批准，重读目标文件、直接配置/调用路径和测试入口。
2. 最小修订 source SKILL/reference/直接示例；保留正式名称、机器参数、来源卫生和不确定程度。
3. 运行 npm test 并人工核对默认 no-extra、X-only/显式 extra、degraded、内部尝试与代理后备说明。模型组合验收由 Pennix/根协调，不把 Node 测试当模型证据。
4. 提交推送 origin/main；package.private=true，不发布 npm。Pennix catalog 固定新 SHA，并沿既有 archive 规则物化。
5. 源侧记录实际修改、验证和交付 SHA；根只保存引用、来源与组合验收，不复制本仓库源码。

## 验收与回退

- 文档与 search.js 的顺序、extra 和 degraded 条件以及 http.js 尝试次数一致；无新配置、凭据或服务商访问。
- 原生 Node 测试通过，固定源码可重建 Pennix 快照；当前宿主模型组合遵循已定分层政策。
- 验收不足记失败/受限；源码通过正常反向提交回退，不重写已发布引用或删除无关资料。
- 实质 scope/provider/依赖/费用变化返回根任务重新决策；执行事实留源侧 Git/实际验证结果，必要时使用本源任务独立结果文档，不改变由根侧摘要绑定的本计划字节。
