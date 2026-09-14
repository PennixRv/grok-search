---
name: grok-search
description: Use when the user explicitly asks to search the web, check latest/current facts, fetch a URL, or discover pages on a website. Do not use for local code search or stable offline knowledge unless the user asks for live web access.
metadata:
  short-description: Grok-first web retrieval with explicit independent sources
---

# Grok Search

Use the `grok-search` executable from the grok-search root (the directory of this SKILL.md), or use its absolute path. The Pennix installer installs the local production dependency; do not run global `npm` installs or create a provider wrapper.

## Choose The Command

- URL given → `grok-search fetch URL`.
- Site named, URL unknown → `grok-search map URL`, then `grok-search fetch` on
  the URLs you pick.
- Current/latest information, or URL unknown → `grok-search search`.
- Local repository or machine question → use the host's local inspection and
  approved code-search tools; use this Skill only for external facts or to
  interpret a local result.

Run the fewest commands that answer the question; run independent sub-questions in parallel. Do not chain map → fetch → search.

All commands emit one JSON object. Check `error`, `diagnostics.provider_attempts`,
and the returned source URLs before using external facts. `degraded: true`
means the answer is raw extra-provider output after an explicit Grok failure,
not a Grok synthesis. Follow the host workflow's routing policy for provider
fallbacks and local-first decisions.

The user configures `GROK_API_URL`, `GROK_API_KEY`, and provider/model settings
outside this Skill. Never read, print, commit, or copy those values. Read
[UPSTREAM.md](UPSTREAM.md) before updating the forked code; read
`references/planning.md` only for multi-part research.

## Commands

```bash
./bin/grok-search search "plain keywords"
./bin/grok-search search --instructions "what to return, language, what to leave out" "plain keywords"
./bin/grok-search search --responses-allowed-domains github.com "plain keywords"
./bin/grok-search search --source x --x-from-date 2026-07-01 "what people say about ..."
./bin/grok-search fetch https://example.com        # --max-chars 50000 only for a deliberate deep read
./bin/grok-search map https://docs.example.com --limit 20
```

Query rules:

- The query is a keyword string that Tavily/Firecrawl search verbatim, so keep it short. Everything else (fields wanted, language, "quote and date only, no advice, say if not found") goes in `--instructions`; only Grok sees it. A bag of keywords like `GPT Codex 1M 272k context window` makes Grok invent background; `codex context window` plus an instruction asking for the current limit does not.
- No code-search operators (`repo:`, `path:`, `language:`). Scope with `--responses-allowed-domains`; it restricts Grok, Tavily, and Firecrawl alike, and off-domain leftovers rank last.
- Budget about 2 searches per question. Before a second search, name the gap it closes. Do not carry the previous round's conclusion words into the keywords; for the same X handle, change the gap, not the phrasing.

## Search Source

Default is web. `--source x` for what people are saying, a named account's posts, a thread, or a claim only circulating on X. `--source both` for a current event where reporting and reaction both matter. `--source x` cannot fall back to the web and turns Tavily/Firecrawl off (`--extra N` forces them).

- For "is it available now / current state" questions, start with `--x-from-date` 60–90 days back; widen only if empty. Old issues explain history, not the present.
- X posts are personal statements: cite handle and date (both live in `answer.text`, not the card), keep claims separate from confirmations, confirm facts at the official source.
- Cost: when an X search reports `responses_tool_calls.total` above 6, add `--responses-parallel-tool-calls false` next time: one call per turn, so `max_turns` caps the count; below 6 it saves nothing.
- Handle filters, dates, media flags, card fields: `references/x-search.md`.

## Fetch Cost

- X posts: `auto` tries Direct first (free, main post with date). `--provider firecrawl` only for the thread or replies; about 30 credits per post.
- Fetch only evidence that would change the conclusion: one or two URLs per turn, a representative post or two for experience reports, never re-fetch text you have. Reddit and YouTube return shells from every provider.
- When citing decisive evidence, record date, model version, client, and login method.

## Reading Results

Every script prints one JSON object, also on failure (non-zero exit, stderr line).

- `error`: read `error.message`, `error.code`, `diagnostics.provider_attempts`. Change something before retrying (query, `--provider`, `--model`). `DEADLINE_EXCEEDED`: the whole command hit its time budget (default 240s, `--deadline N`).
- `diagnostics.warnings` and `diagnostics.provider_attempts` say which providers were skipped (e.g. Firecrawl in cooldown), failed, or produced content, and whether the relay served another model than requested.
- Search: `answer.text`, then `sources.items` (merged, max 12). `source_type` `citation` = used in the answer, `searched` = only listed; `opened: true` = Grok read the page. `sources.raw_path` always points to the run record (full list, answer, tool calls); read it in chunks only when the cards are not enough. Check `diagnostics.degraded`, `cost_usd`, and `search_budget` (advisory budget vs. calls made).
- Fetch: `content.text`; if `content.truncated`, read `content.full_path` in chunks or rerun once with a larger `--max-chars`. `metadata` has title/author/published_at when the provider had them. `diagnostics.run_path` is the run record.
- Map: `urls`; fetch the few you need.

Provider order, proxy, cooldown, config errors: `references/providers.md`. Multi-part or conflicting research: `references/planning.md` first.
