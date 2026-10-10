---
name: grok-search
description: 用户明确要求网络搜索、核对当前或最新事实、抓取 URL 或发现网站页面时使用；除非用户要求实时网络访问，不用于本地代码搜索或稳定的离线知识。
metadata:
  short-description: 以 Grok 为首选并使用独立来源的网络检索
---
# Grok Search

普通调用使用已安装的 `grok-search` 命令（`grok-search search`、`grok-search fetch` 或 `grok-search map`）。`pennix-workflow-lifecycle` 的目录定义 `replace-staged` 流程会安装本地生产依赖，并通过 `~/.local/bin` 提供受管命令；不要使用全局 `npm` 安装或创建服务商包装器。在受管链接建立前，只在安装诊断中从 Skill 根目录或绝对路径调用可执行文件。

该可执行文件属于 `grok-search`，必须通过宿主原生直接命令路径启动。不要用 `mcp__fastctx.run`、FastCtx 任务、`replace`、Shell HTTP 或通用包装器启动；FastCtx 不是 Grok 传输、服务商、凭据或后备入口。Grok 调用完成后，FastCtx 可以读取已批准的普通结果文件做限定分析，但不得据此重试、轮询或改变 Grok 状态。

## 选择命令

- 给出 URL → `grok-search fetch URL`。
- 指定网站但不知道 URL → `grok-search map URL`，再对选定 URL 使用 `grok-search fetch`。
- 要求当前或最新信息，或不知道 URL → `grok-search search`。
- 本地仓库或主机问题 → 使用宿主本地检查和批准的代码搜索工具；本 Skill 只用于外部事实或解释本地结果。

使用能回答问题的最少命令；独立子问题并行运行。不要串联 map → fetch → search。

所有命令都输出一个 JSON 对象。使用外部事实前检查 `error`、`diagnostics.provider_attempts` 和返回的来源 URL。`degraded: true` 表示明确 Grok 失败后返回未经 Grok 综合的额外服务商原始结果；服务商后备仍遵守宿主工作流的路由规则。

用户在本 Skill 外配置 `GROK_API_URL`、`GROK_API_KEY` 和服务商或模型设置。不得读取、输出、提交或复制这些值。更新 fork 代码前阅读 [UPSTREAM.md](UPSTREAM.md)；多部分调研才阅读 `references/planning.md`。

## 命令

```bash
grok-search search "plain keywords"
grok-search search --instructions "what to return, language, what to leave out" "plain keywords"
grok-search search --responses-allowed-domains github.com "plain keywords"
grok-search search --source x --x-from-date 2026-07-01 "what people say about ..."
grok-search fetch https://example.com        # --max-chars 50000 only for a deliberate deep read
grok-search map https://docs.example.com --limit 20
```

查询规则：

- query 是 Tavily 按原文搜索的关键词字符串，应保持简短。需要返回的字段、语言、“只引用和给日期、没有结果就说明”等都放在 `--instructions`；只有 Grok 看到它。不要用一组会诱发背景臆造的关键词替代明确问题；例如，`GPT Codex 1M 272k context window` 这类关键词会诱发背景臆造，使用 `codex context window` 并在指令中要求当前限制。
- 不使用 `repo:`、`path:`、`language:` 等代码搜索操作符。用 `--responses-allowed-domains` 限定范围；它同时限制 Grok 和 Tavily，仍返回的站外结果只会排在后面。
- 每个问题预算约两次搜索。第二次前说清它要弥补的缺口；相同 X 账号应改变缺口，不要重复换一种说法，也不要把上一轮结论词带入关键词。

## 搜索来源

默认来源为 web。涉及 X 上的说法、指定账号、主题或只在 X 流传的主张时使用 `--source x`；报道和反应都重要的当前事件使用 `--source both`，Grok 按调用决定来源。`--source x` 不会回退到 web，并且关闭 Tavily（`--extra N` 才会强制启用）。

- “现在是否可用”或“当前状态”问题先使用 `--x-from-date` 回溯 60–90 天；为空时才扩大范围。旧问题只解释历史，不代表当前状态。
- X 帖子是个人陈述：引用账号和日期（都在 `answer.text`，不在 card），将主张与确认分开，并在官方来源核实事实。
- X 搜索报告 `responses_tool_calls.total` 超过 6 时，下次增加 `--responses-parallel-tool-calls false`，每轮一个调用，使 `max_turns` 限制调用数；不超过 6 时通常没有节省。
- 账号过滤、日期、媒体标记和 card 字段见 `references/x-search.md`。

## 抓取成本

- X 帖子 `auto` 先尝试 Direct（免费，返回带日期的主帖），再尝试 Tavily 和 Direct 后备。
- 只抓取会改变结论的证据：每轮一两个 URL，经验报告取一两个代表性帖子，不要重复抓取已有文本。Reddit 和 YouTube 的每个服务商通常都只返回外壳。
- 引用决定性证据时记录日期、模型版本、客户端和登录方式。

## 读取结果

每个脚本都输出一个 JSON 对象，失败时也如此（退出码非零时另有 stderr 行）。

- `error` 读取 `error.message`、`error.code` 和 `diagnostics.provider_attempts`。宿主允许重新调用时，重试前必须改变查询、`--provider` 或 `--model`；`DEADLINE_EXCEEDED` 表示命令用尽时间预算（默认 240 秒，可用 `--deadline N`）。脚本内部的受控重试不授权代理重复调用或切换服务商，代理调用仍服从宿主检索规则。
- `diagnostics.warnings` 和 `diagnostics.provider_attempts` 说明跳过、失败或提供内容的服务商，以及中继是否实际使用了不同模型。
- search 读取 `answer.text` 和 `sources.items`（合并后最多 12 条）。`source_type` 为 `citation` 表示用于答案，`searched` 表示只列出；`opened: true` 表示 Grok 读取了页面。`sources.raw_path` 在启用运行记录时指向记录文件（完整来源、答案和工具调用）；只在 card 不足时分块读取。检查 `diagnostics.degraded`、`cost_usd` 和 `search_budget`，后者是建议预算而非实际调用上限。
- fetch 读取 `content.text`；`content.truncated` 为真时分块读取 `content.full_path`，或仅在一次有明确理由的情况下用更大的 `--max-chars` 重跑。`metadata` 在服务商提供时包含标题、作者和发布时间。`diagnostics.run_path` 是运行记录。
- map 读取 `urls`，再抓取确需的少量 URL。

服务商顺序、代理和配置错误见 `references/providers.md`；多部分或互相冲突的调研先读 `references/planning.md`。
