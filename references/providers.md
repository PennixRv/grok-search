# Providers, Limits, And Run Records

Read this when a result mentions a skipped or failed provider, when configuration errors appear, or when you need the durable record of a run.

## Provider Order

- `search.js`: Grok Responses runs alongside independent Tavily Search when `TAVILY_API_KEY` is set. Extras are never fed into Grok. The default extra target is 0; `--extra N` enables Tavily and `--no-extra` disables extras and the degraded fallback. On `--source x`, extras are off unless `--extra N` is given (`extra_mode: "off-x-only"`).
- `fetch.js --provider auto`: Tavily Extract → Direct Fetch. Exception: X post URLs try Direct first (`references/x-search.md`).
- `map.js --provider auto`: Tavily Map → Direct Map.
- `--responses-openrouter-engine exa` forces a web-only engine on OpenRouter.

Domain filters apply to Grok and Tavily: `--responses-allowed-domains` / `--responses-excluded-domains` are pushed to Tavily (`include_domains`/`exclude_domains`). Anything that still comes back off-domain is ranked after Grok's own results, not dropped. `diagnostics.options.extra_domain_filter` reports `pushed`, `demoted`, or `none`; extra attempts report `off_domain`.

Direct is this repo's own fallback: a plain HTTP GET through Node's `fetch` (undici, honoring the proxy settings) with a `grok-search-skill/0.1` user agent, following redirects, capped at 2 MB, rejecting binary and attachment responses, then stripping HTML to text with regexes (scripts, styles, nav noise are only partly removed). It does not execute JavaScript, log in, use cookies, parse PDFs, or bypass anti-bot; its text is noisier than Tavily's and can lose body content on some layouts. Direct Map only reads `/sitemap.xml` and same-domain homepage links, ignores `--instructions`, and is limited to `--max-depth 1`. Neither Direct nor Tavily reliably extracts Reddit or YouTube pages.

HTTP 408/429/500/502/503/504 responses retry up to 3 times with backoff, honoring `Retry-After` when it fits the budget. Bad JSON and 4xx responses such as 403 "IP looks suspicious" are not retried. Attempts report `requests` (HTTP calls made) and `duration_ms`.

## Relay Behaviour

The Responses endpoint is usually reached through an OpenAI-compatible relay, and relays differ in ways that change cost and output: one served `grok-4.5-build` for every `grok-4.5` request (two to three times the tool calls and cost), one drops `parallel_tool_calls` (the parameter works against `api.x.ai` directly; `max_tool_calls` does not, anywhere), grok-4.5 through one relay returned its between-call narration as extra `message` items (grok-4.6 through the same relay does not), one returns X search as `custom_tool_call` items. `usage.cost_in_usd_ticks`, and so `diagnostics.cost_usd`, is whatever the endpoint reports: one relay reported 40% of xAI's own figure for identical token and call counts, so compare cost across providers by tokens and calls, not by this field. `diagnostics.responses_model` is the model the relay actually served; a warning is added when it differs from the requested one. Narration messages are dropped from `answer.text` (the last message is the answer; earlier ones stay only when long or cited).

## Grok Failures

When Grok returns 402, a quota error code, or a 429 whose body talks about quota/credits/billing, `search.js` returns a visibly marked degraded answer built from raw Tavily results: `diagnostics.degraded: true`, `diagnostics.grok_error.code: QUOTA_EXHAUSTED`. A plain 429 degrades the same way with `RATE_LIMITED`. Other Grok failures are errors. If `search.js` returns `GROK_API_URL 未配置` or `GROK_API_KEY 未配置`, the project is missing required setup; point the user at `README.md` rather than working around it.

## Source Cards

- `source_type`: `citation` (used in the answer), `searched` (listed by a search call), `extra` (Tavily). `opened: true` marks pages Grok actually read (from `open_page` actions; web only, X search has no trace). Rank: citation > opened > in-domain extra > searched > off-domain extra.
- Duplicate URLs across channels are merged into one card; `merged_from` lists the providers that contributed fields. A placeholder title such as `"1"` or `[2]` counts as missing: a real title replaces it, otherwise the card has no `title`.
- `diagnostics.responses_tool_calls` is `{ total, upstream: { web, x } | null, trace: { web, x }, by_action: { search, open_page, find_in_page }, failed? }`. `total` is the per-tool maximum of the billing usage and the trace; the two raw tallies stay visible because relays under-report either side. `grok_tool_calls[].source_count` in the run record is a relay-cumulative value, not per call.
- Fetch `metadata`: `{ title, description, author, published_at, language, status, source_url }`; Direct adds `status`, `content_type`, `content_length`, `content_disposition`.

## Run Records

Every command writes one JSON run record to the output directory (`~/.cache/grok-search/outputs/`, `GROK_OUTPUT_DIR` overrides). Search exposes it as `sources.raw_path` (always set), fetch and map as `diagnostics.run_path`. Records are also written on errors and on `DEADLINE_EXCEEDED`.

Search records hold `argv` (secrets redacted), `query`, `instructions`, `options`, the full `answer`, `sources.grok` / `sources.extra` / `sources.items` (uncapped), `provider_attempts`, `grok_tool_calls`, and `diagnostics`. Fetch records hold the full content and `metadata`; map records hold `urls`. `GROK_DEBUG_RAW=1` or `--full-sources` also embeds the redacted Grok response as `grok_raw`. `GROK_RUN_LOG=off` (or `runLog: false`) disables records; `raw_path` / `run_path` become null. Files older than 30 days are cleaned up on each run.

## Proxy

The scripts use terminal proxy variables via undici: `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` and lowercase variants; `NO_PROXY` is honored and loopback hosts bypass. `GROK_PROXY="http://127.0.0.1:7890"` sets a proxy for this tool only, `GROK_PROXY=off` forces direct connections, `GROK_DEBUG=true` prints proxy and retry debug lines to stderr.
