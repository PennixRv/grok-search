# Smoke Tests

## 本地 fixture

```bash
npm test
```

覆盖 Responses body/解析、三路并发、Keyless/API-key、额度降级、source schema、代理与 fetch/map fallback。

## 无 Grok key

```bash
./scripts/fetch.js --provider firecrawl https://example.com
./scripts/fetch.js --provider direct https://example.com
./scripts/map.js --provider direct https://example.com --limit 5
```

第一条验证 Firecrawl Keyless；输出应含 `diagnostics.firecrawl_auth_mode: keyless`。

## Direct xAI

```bash
export GROK_API_PROVIDER="xai"
export GROK_API_URL="https://api.x.ai/v1"
export GROK_API_KEY="your-key"
export GROK_MODEL="grok-4.3"

./scripts/search.js "latest xAI docs"
./scripts/search.js --no-extra "only Grok Responses"
```

期望：

- `diagnostics.grok_endpoint` 为 `responses`；
- 默认 `responses_max_turns` 为 3；
- `diagnostics.options.search_source` 为 `web`，且请求体只挂 `web_search`；
- `sources.items` 可含 `citation` / `searched`，`sources.omitted` 标记裁剪；
- 默认 extra allocation 在没有 Tavily key 时全部给 Firecrawl。

## X 检索

```bash
./scripts/search.js --source x --no-extra "X 上大家怎么评价 grok-4.6"
./scripts/search.js --source both --responses-allowed-x-handles xai "latest xAI news"
./scripts/search.js --source x --x-from-date 2026-08-01 --no-extra "query"
```

期望：

- `diagnostics.options.search_source` 为 `x`，请求体 `tools` 只有 `x_search`；
- `diagnostics.responses_x_search_calls` 大于 0，且不小于 `usage.server_side_tool_usage_details.x_search_calls` 与 `output[]` 里 `x_search_call` item 数中的任一个（两侧都有中转会漏报，此处须是真实次数，不能是 0）；
- `sources.items` 中 X 来源带 `tool: x_search`、`title: "@handle"`、`x_handle`、`x_post_id`，且不出现 `"1"` / `"2"` 这类序号标题；
- `answer.text` 对每条 X 论据署名到 handle 与日期。

错误路径：

```bash
./scripts/search.js --source twitter "query"                        # SEARCH_SOURCE_INVALID，退出码 2
./scripts/search.js --source web --x-from-date 2026-08-01 "query"   # SEARCH_SOURCE_CONFLICT
./scripts/search.js --x-from-date 08/01/2026 "query"                # ARGUMENT_ERROR
./scripts/search.js --x-from-date 2026-02-30 "query"                # ARGUMENT_ERROR（溢出日期不滚动）
```

配置里已有 `responsesAllowedDomains` 时（命令行只能收紧）：

```bash
./scripts/search.js --responses-allowed-domains 清单外域名 "query"   # RESPONSES_FILTER_FORBIDDEN
./scripts/search.js --responses-excluded-domains 清单内全部域名 "query"  # RESPONSES_FILTER_EMPTY
```

## OpenRouter

```bash
export GROK_API_PROVIDER="openrouter"
export GROK_API_URL="https://openrouter.ai/api/v1"
export GROK_API_KEY="your-key"
export GROK_MODEL="x-ai/grok-4.1-fast"

./scripts/search.js --responses-openrouter-engine exa "latest OpenAI docs"
```

期望 tool 为 `openrouter:web_search`，模型名没有自动 `:online`。

## Tavily + Firecrawl

```bash
export TAVILY_API_KEY="tvly-your-key"
./scripts/search.js "latest pi coding agent docs"
./scripts/search.js --extra 10 "latest pi coding agent docs"

export FIRECRAWL_API_KEY="fc-your-key"
./scripts/search.js "latest pi coding agent docs"
```

默认 `extra=6` 时应分配 Tavily 3 / Firecrawl 3。移除 Firecrawl key 后仍应成功，auth mode 变为 `keyless`。

## Fetch 主备链

```bash
./scripts/fetch.js https://example.com
./scripts/fetch.js --provider firecrawl https://example.com
./scripts/fetch.js --provider direct https://example.com
```

配置 Tavily 时顺序为 Tavily → Firecrawl → Direct；未配置 Tavily 时 Firecrawl Keyless → Direct。

## 输出安全

所有非 help 命令都应向 stdout 写 JSON。stderr 只放简短摘要，不得包含 API key。额度降级必须在 `answer.text` 和 `diagnostics.grok_error` 两处都可见。
