# X 搜索与 X 帖子
问题涉及 X（Twitter）时阅读本参考，包括选择 `--source`、过滤账号或日期、读取 X card 和抓取帖子。

## 选择来源

- `--source x`：问题本身关于 X 的反应、情绪、讨论、指定账号或只在 X 流传的主张。仅挂载 `x_search`，Grok 不会回退到 web。
- `--source both`：报道和反应都重要的当前事件，或 web 可能比 X 晚数小时的快速变化主题。Grok 按每次调用决定具体来源。
- 省略 `--source`：文档、发布、版本、价格、规格和用法。X 不是这些问题的默认来源。

X 搜索按每千次调用 5 美元计费，与 web 搜索相同。`diagnostics.responses_x_search_calls` 报告实际调用；`diagnostics.search_budget` 将其与 prompt 的建议预算并列（约 6 次搜索，其中 X 最多约 4 次）。预算是模型建议而非总上限：`max_turns` 限制 Agent 轮数，一轮可以包含多次搜索，并且它只对 X 搜索形成硬上限，web 搜索可以超出。2026-09-08 测试表明，`max_tool_calls` 被 `api.x.ai` 本身忽略（即使上限为 1 仍运行了 4 次调用），也被已观察的每个中继忽略；`parallel_tool_calls: false` 在直接端点及透传它的中继上有效，每轮一次调用，因此 `max_turns` 可形成硬上限。一次中继上 grok-4.5 在相同账号与日期条件下，从 7–14 次降到 3 次，成本降到约三分之一；grok-4.6 直连或经同一中继通常只调用 3–4 次，没有节省。只有 `responses_tool_calls.total` 超过 6 时才增加 `--responses-parallel-tool-calls false`；有一个中继忽略了该参数，并将其回显为 `true`。模型选择通常影响更大：同一中继和问题下，grok-4.6 的调用数约为 grok-4.5 的三分之一到四分之一。可用 `--responses-parallel-tool-calls false` 或配置 `responsesParallelToolCalls: false` 发送该设置，再用 `diagnostics.responses_tool_calls.total` 核对是否生效。

## 过滤器

```bash
./scripts/search.js --source x "what is X saying about the outage"
./scripts/search.js --source both "reaction to the release"
./scripts/search.js --source x --responses-allowed-x-handles xai,OpenAI "query"
./scripts/search.js --source x --x-from-date 2026-08-01 --x-to-date 2026-08-16 "query"
./scripts/search.js --source x --extra 4 "query"           # 同时运行 Tavily（仅 web）
```

- `--responses-allowed-x-handles` 和 `--responses-excluded-x-handles` 互斥，各自最多 20 个；任一个都会启用 X 搜索。
- `--x-from-date` 和 `--x-to-date` 必须是实际日历日期，格式为 `YYYY-MM-DD`；任一个都会启用 X 搜索。
- `--x-images` 和 `--x-videos` 分析帖子媒体并增加 token 费用；只有问题涉及媒体本身时启用。
- 配置文件可能已经限制账号或域名。标记只能进一步收窄；请求被排除的内容会返回 `RESPONSES_FILTER_FORBIDDEN` 或 `RESPONSES_FILTER_EMPTY`，不会静默扩大范围。

## 时间线问题

“现在能否使用”“是否开放”“当前默认是什么”先从 60–90 天窗口检索，窗口为空才扩大。旧 GitHub 问题和帖子解释默认如何形成，不代表今天。日期冲突时都报告，并说明哪一条更新。

第二次 X 搜索前说明它弥补的具体缺口。不要把上一轮的“无用”“损坏”“已修复”等结论词写入查询；同一账号要改变缺口，而不是改写措辞。

## 读取 X card

- URL 是 X 帖子时，card 带 `x_handle`、`x_post_id` 和实际挂载 X 搜索时的 `tool: "x_search"`。`--source web` 下的 x.com card 来自 web 搜索，标记也会相应反映。
- 一些中继把 X 搜索返回为 `x_keyword_search`、`x_semantic_search`、`x_thread_fetch`、`x_user_search` 等底层工具；它们按 `x_search` 计数，`diagnostics.responses_tool_calls.by_action` 展开为 `keyword_search`、`thread_fetch` 等动作。另一些中继不返回逐次项目，只能知道计费总数。
- card 不含帖子正文或日期；二者在 `answer.text` 中，由答案将主张归因给账号和日期。引用账号，不要只给裸 URL。
- 帖子是个人陈述：按账号和日期归因，主张与确认分开；多账号重复不构成相互印证。有官方来源时在官方来源确认事实，将 X 用于反应、时间或第一手经验。
- Tavily extra 搜索 web，不搜索 X。`--source x` 默认关闭它并给出警告（`diagnostics.options.extra_mode: "off-x-only"`）；`--extra N` 强制打开，`--source both` 保持打开。

## 抓取帖子

- URL 同时含账号和帖子 ID，且 `--provider auto` 时，Direct 先运行；只有页面写明账号、经过 X 重定向后的规范账号有日期和非模板正文才算成功。结果只含主帖。核验失败则尝试 Tavily；Tavily 不可用时仍可返回 Direct 文本并给出警告。
- Direct 先运行，是因为它可以在不增加第二个服务商请求的情况下核验规范账号和帖子日期。不支持完整线程或回复。
- `/i/web/status/<id>` 没有账号，无法完成上述核验，使用普通顺序。

引用帖子作为决定性证据时，记录日期、模型版本、客户端和作者登录方式。许多表面冲突其实来自不同的配置。
