# 服务商、限制与运行记录
结果提到跳过或失败的服务商、出现配置错误，或需要查看运行持久记录时阅读本参考。

## 服务商顺序

- `search.js`：Grok Responses 与独立 Tavily Search 并行运行，前提是设置 `TAVILY_API_KEY`。extra 永远不送入 Grok；默认 extra 目标为 0，`--extra N` 启用 Tavily，`--no-extra` 禁用 extra 和降级后备。`--source x` 下除非显式提供 `--extra N`，否则 extra 关闭（`extra_mode: "off-x-only"`）。
- `fetch.js --provider auto`：Tavily Extract → Direct Fetch。X 帖子 URL 例外，先尝试 Direct（见 `references/x-search.md`）。
- `map.js --provider auto`：Tavily Map → Direct Map。
- `--responses-openrouter-engine exa` 强制使用仅 web 的 OpenRouter 引擎。

域名过滤同时应用于 Grok 和 Tavily：`--responses-allowed-domains` 或 `--responses-excluded-domains` 会传给 Tavily 的 `include_domains` 或 `exclude_domains`。仍返回的站外结果会排在 Grok 自己的结果后面，而不是直接丢弃。`diagnostics.options.extra_domain_filter` 报告 `pushed`、`demoted` 或 `none`；额外尝试会报告 `off_domain`。

Direct 是本仓库自己的后备：通过 Node `fetch`（undici，遵守代理设置）进行普通 HTTP GET，使用 `grok-search-skill/0.1` User-Agent，跟随重定向，限制 2 MB，拒绝二进制和附件响应，再用正则清理 HTML 文本；脚本、样式和导航噪声仅部分移除。它不执行 JavaScript、不登录、不使用 Cookie、不解析 PDF，也不绕过反爬；结果噪声比 Tavily 大，部分页面可能缺正文。Direct Map 只读 `/sitemap.xml` 和同域主页链接，忽略 `--instructions`，限制 `--max-depth 1`。Direct 和 Tavily 都不能可靠提取 Reddit 或 YouTube 页面。

HTTP 408、429、500、502、503、504 最多重试 3 次并退避，遵守预算内的 `Retry-After`；坏 JSON 和 403 等 4xx 不重试。尝试记录 `requests`（HTTP 请求数）和 `duration_ms`。

Responses 端点通常经由 OpenAI 兼容中继，中继差异会改变成本和输出：一次中继对所有 `grok-4.5` 请求实际提供 `grok-4.5-build`，工具调用和成本增加到两到三倍；一次中继丢弃 `parallel_tool_calls`（该参数对 `api.x.ai` 直连有效，`max_tool_calls` 在任何已观察位置都无效）；同一中继下 grok-4.5 会把轮次之间的叙述作为额外 `message`，grok-4.6 则不会；另一个中继把 X 搜索返回为 `custom_tool_call`。因此以 `diagnostics.responses_model` 和警告为准。`usage.cost_in_usd_ticks` 及 `diagnostics.cost_usd` 是端点报告的值：曾有中继对相同 token 数和调用数只报告 xAI 自有数值的 40%，所以不同服务商之间应按 token 和调用数比较，不应直接比较该字段。叙述消息从 `answer.text` 中丢弃；最后一条消息作为答案，较早的消息仅在内容较长或包含引用时保留。

## Grok 失败

Grok 返回 402、配额错误码，或 429 正文涉及配额、余额或计费时，`search.js` 返回带明显标记的 Tavily 原始结果：`diagnostics.degraded: true`、`diagnostics.grok_error.code: QUOTA_EXHAUSTED`。普通 429 同样降级为 `RATE_LIMITED`。其他 Grok 失败返回错误。如果出现 `GROK_API_URL 未配置` 或 `GROK_API_KEY 未配置`，说明缺少必要配置；应将用户指向 `README.md`，不要绕过。

## 来源卡片

- `source_type`：`citation`（答案使用）、`searched`（搜索列出）、`extra`（Tavily）。`opened: true` 表示 Grok 通过 `open_page` 实际读取页面；该轨迹只适用于 web，X 搜索不提供它。排序为 citation > opened > 同域 extra > searched > 站外 extra。
- 跨渠道重复 URL 合并为一个 card，`merged_from` 列出提供字段的服务商。占位标题如 `"1"` 或 `[2]` 视为缺失：真实标题会替换它；如果没有真实标题，card 不包含 `title`。
- `diagnostics.responses_tool_calls` 的结构为 `{ total, upstream: { web, x } | null, trace: { web, x }, by_action: { search, open_page, find_in_page }, failed? }`。`total` 取计费使用量和 trace 的逐工具最大值；原始两类统计仍保留，因为中继可能少报其中一类。`grok_tool_calls[].source_count` 是中继累计值，不是单次调用值。
- Fetch 的 `metadata` 为 `{ title, description, author, published_at, language, status, source_url }`；Direct 还增加 `status`、`content_type`、`content_length` 和 `content_disposition`。

## 运行记录

每个命令都在输出目录写入一条 JSON 运行记录（默认 `~/.cache/grok-search/outputs/`，可由 `GROK_OUTPUT_DIR` 覆盖）。启用运行记录时，search 通过 `sources.raw_path` 暴露它，fetch 和 map 通过 `diagnostics.run_path` 暴露。错误和 `DEADLINE_EXCEEDED` 也写记录；`GROK_RUN_LOG=off` 或 `runLog: false` 时，`raw_path` 和 `run_path` 为 `null`。

Search 记录包含脱敏后的 `argv`、`query`、`instructions`、`options`、完整 `answer`、`sources.grok`、`sources.extra`、`sources.items`（均不截断）、`provider_attempts`、`grok_tool_calls` 和 `diagnostics`。Fetch 保存完整 `content` 和 `metadata`；map 保存 `urls`。`GROK_DEBUG_RAW=1` 或 `--full-sources` 还会嵌入脱敏的 Grok 原始响应 `grok_raw`。记录超过 30 天会在每次运行时清理。

## 代理

脚本通过 undici 使用终端代理变量：`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 及小写变体；遵守 `NO_PROXY`，并绕过回环主机。`GROK_PROXY="http://127.0.0.1:7890"` 只为本工具设置代理，`GROK_PROXY=off` 强制直连，`GROK_DEBUG=true` 将代理和重试调试行输出到 stderr。
