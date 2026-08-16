# Responses 搜索协议

`search.js` 的唯一生产搜索协议是 Responses API：

```bash
./scripts/search.js "query"
```

它不支持 Chat Completions，也没有模式切换或 Chat fallback。

## Direct xAI / openai-compatible

请求发送到：

```text
{GROK_API_URL}/responses
```

核心 body：

```json
{
  "model": "grok-4.3",
  "input": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "tools": [{ "type": "web_search" }],
  "max_turns": 3,
  "reasoning": { "effort": "low", "summary": "concise" },
  "stream": false
}
```

域名过滤放在 tool 的 `filters`：

```json
{
  "type": "web_search",
  "filters": { "allowed_domains": ["docs.x.ai"] }
}
```

X 搜索：

```bash
./scripts/search.js --responses-x-search "query"
./scripts/search.js --responses-x-search --responses-allowed-x-handles xai,OpenAI "query"
```

固定推理模型或名称包含 `non-reasoning` 的模型不会发送可配置 reasoning 字段。

## OpenRouter

OpenRouter 使用：

```json
{
  "tools": [
    {
      "type": "openrouter:web_search",
      "parameters": {
        "engine": "auto",
        "max_results": 5,
        "max_total_results": 10
      }
    }
  ]
}
```

可选 engine：

```text
auto | native | exa | firecrawl | parallel | perplexity
```

```bash
./scripts/search.js --responses-openrouter-engine exa "query"
```

模型名不会自动追加 `:online`。

## 配置与命令行的优先级

优先级从高到低：命令行参数 > 环境变量 > 配置文件 > 兜底默认。

需要注意 **配置文件由使用者书写，命令行参数由调用本工具的 agent 书写**，两者作者不同。因此标量配置是**默认值**语义、命令行可以覆盖（实际生效值始终记录在 `diagnostics.options`，可事后审计），但配置中的**限制**不会被命令行静默抹掉。

allow-list 与 deny-list 都是限制：deny-list 去掉列举的值，allow-list 去掉没列举的一切。命令行只能收紧，不能放宽。

| 配置 | 命令行 | 结果 |
| --- | --- | --- |
| deny-list | allow-list | 允许（deny 自动满足）；若显式请求了已排除的值，报 `RESPONSES_FILTER_FORBIDDEN` |
| deny-list | deny-list | 合并去重；超过上限（domain 5）报 `RESPONSES_FILTER_LIMIT` |
| allow-list | allow-list | 必须是配置清单的子集，否则报 `RESPONSES_FILTER_FORBIDDEN` |
| allow-list | deny-list | 从配置清单里减掉；减空报 `RESPONSES_FILTER_EMPTY`（空 allow-list 对 API 等于「不限制」，与配置意图相反） |

比较一律不区分大小写。

本工具没有「命令行完全不可覆盖」的硬策略层。若确有此需求，请提 issue 说明场景。

## Responses sources

解析器收集：

- output text annotations 与 top-level citations；
- `web_search_call`、`x_search_call` 的 action/query/url/source；
- usage 与费用字段。

解析出的每条 source 形如：

```json
{
  "provider": "grok-responses",
  "source_type": "citation",
  "tool": "web_search",
  "url": "https://example.com"
}
```

同一 URL 同时是 `citation` 和 `searched` 时，citation 优先。

## Tavily 与 Firecrawl

它们与 Responses 请求并行，但不进入 `input`：

```text
Grok Responses ──────────────┐
Tavily Search（有 key）───────┼─ sources.items（去重合并 + 上限裁剪）
Firecrawl Search（Keyless/key）┘
```

默认合计 6 条；两家可用时 3/3。Firecrawl provider attempt 会包含 `auth_mode`，可能包含 `credits_used`。

## 额度错误

只有明确额度信号触发 degraded success：

- HTTP 402；
- HTTP 429 且正文包含 quota、credit、balance、billing、rate limit 等信号；
- `insufficient_quota`、`credits_exhausted` 等错误码。

降级输出同时包含人类可见警告和结构化 `diagnostics.grok_error`。`--no-extra` 时返回 `GROK_QUOTA_EXHAUSTED`。401/403、404/422、5xx、超时和空响应仍是普通错误。

## Diagnostics

重点字段：

- `grok_endpoint: responses`
- `responses_max_turns`
- `responses_web_search_calls`
- `responses_x_search_calls`
- `responses_tool_calls`
- `extra_allocation`
- `firecrawl_auth_mode`
- `degraded` / `grok_error`
- `usage` / `cost_usd`
