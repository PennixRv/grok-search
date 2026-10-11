# Grok Skill 修订结果

## 授权与修改

根完整修订包 revision 1 展示后获得用户明确实施批准。本源继续使用原先已绑定摘要的任务计划，不初始化 Trellis，也不改写该计划字节。

SKILL name 改为 pennix-grok-search，系统部署引用同步 pennix-component-lifecycle；普通 search 示例显式 --no-extra，额外来源须当前授权，CLI 内部尝试不授权代理重起命令、切换模型或服务商。可用 degraded 保持来源核验，整条命令不可用才最多一次自托管 Hikari 后备；fetch 已有全文走本地分块读取。

providers 参考同步实际 search 顺序（先 Responses 后 extra）、默认三次总尝试，以及启用 extra 且有原始结果才能 degraded 的条件。实际代码 publicResult:846–887 和 requestJson:124–189 已核对，CLI 算法与配置/凭据均未修改。

中文/英文 README 的直接普通示例同步 --no-extra 与显式 extra 授权条件，修正同一尝试计数漂移；入口导航改为加载 Skill 时读取，避免沿用每轮重复读取的旧说明。属于本计划直接消费说明的局部同步，不追溯重写研究文档或引入新政策。

## 验证

- npm test：通过全部现有 sources/proxy/responses/output/retry/argv/pennix 离线矩阵。
- 系统 skill-creator quick_validate：通过。

下一步审阅并推送源码验收提交供 Pennix catalog 固定。private npm 不发布，无服务商请求或凭据读取；模型组合和安装消费者门由 Pennix/根继续完成。
