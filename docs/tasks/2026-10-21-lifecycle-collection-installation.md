# 修正 Skill 的 Lifecycle 集合安装说明

本直接文档任务落实 `pennix-skills/.trellis/tasks/10-17-skill-collection-path-contract` 已批准 revision 5 执行计划第 2 步：必要修改先回到实际来源，再正常物化第三方 Skill；由根任务 `codex-workflow-optimization/.trellis/tasks/10-21-closed-plan-workflow-rollout` 串联发布、安装和最终验收。

当前 `SKILL.md` 仍引用旧 `replace-staged` 入口。独立 Lifecycle 工具已通过集合 manifest 管理安装，普通 `apply` 按锁安装，显式升级使用 `pennix update pennix-skills`；Grok Skill 只导航到 `$pennix-component-lifecycle`，不复制其完整部署协议。本任务修改范围为该安装说明和本记录，保留命令调用、服务商配置、运行代码、包版本和既有历史记录。

验证范围：核对当前 Lifecycle README 与集合目录合同，运行 Skill 静态验证、中文文案检查和 `git diff --check`。文档修正不需要新的运行时测试或 npm 发布。源码提交固定并推送 `main` 后，由根任务记录来源 SHA，在 collection manifest 固定同一提交，并按既有同步工作流重新物化；不得手改快照或用户安装副本。最终停止点仍由根 rollout 的四层对齐验收决定。

实际验证：已核对 Lifecycle README 中 `apply` 的锁定语义、`update` 的单组件替换语义和 catalog 中 Grok 连接所属 `pennix-skills` 集合；Skill 静态验证、两个本任务中文文件的文案检查和 `git diff --check` 均通过。源码推送与快照身份的后续结果回写到根任务执行记录。
