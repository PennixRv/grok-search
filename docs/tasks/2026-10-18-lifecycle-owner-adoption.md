# 本机生命周期连接接管

本工作项归根任务 `codex-workflow-optimization/10-17-lifecycle-install-path-convergence` revision 8 的已批准 owner 补口；在独立工作树修改，原源码工作树的文档改动保留。

为既有同值 Grok/Tavily 配置增加显式接管，保留原文件字节；配置一个目标时同步核验并更新同文件另一个目标的 receipt。输入期望摘要必须吻合，实际文件漂移拒绝 configure/unconfigure。只写本机原生 owner 文件，不访问远端，不执行搜索。

新增临时 home 回归覆盖同值接管、双目标共存和漂移保护。由原 `npm test` 门禁运行，再由 Skills 集合固定提交交付，不另建安装路径。
