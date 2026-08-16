#!/usr/bin/env node
import assert from "node:assert/strict";
import { inferApiProvider } from "../scripts/lib/config.js";
import { buildResponsesBody, parseGrokResponses } from "../scripts/lib/grok-responses.js";

const baseOptions = {
  platform: "",
  model: "grok-4-fast",
  maxTurns: 1,
  reasoningEffort: "low",
  allowedDomains: [],
  excludedDomains: [],
  searchSource: "web",
  allowedXHandles: [],
  excludedXHandles: [],
  xFromDate: "",
  xToDate: "",
  xImageUnderstanding: false,
  xVideoUnderstanding: false,
  openRouterEngine: "auto",
};

assert.equal(inferApiProvider("https://openrouter.ai/api/v1"), "openrouter");
assert.equal(inferApiProvider("https://api.x.ai/v1"), "xai");
assert.equal(inferApiProvider("https://example.com/v1"), "openai-compatible");
const directBody = buildResponsesBody(
  "latest docs",
  {
    ...baseOptions,
    maxTurns: 2,
    reasoningEffort: "medium",
    allowedDomains: ["docs.x.ai", "openai.com"],
    searchSource: "both",
    allowedXHandles: ["xai", "OpenAI"],
  },
  { apiProvider: "xai" }
);
assert.equal(directBody.model, "grok-4-fast");
assert.equal(directBody.max_turns, 2);
assert.equal(directBody.reasoning.effort, "medium");
assert.equal(directBody.stream, false);
assert.deepEqual(directBody.tools, [
  { type: "web_search", filters: { allowed_domains: ["docs.x.ai", "openai.com"] } },
  { type: "x_search", allowed_x_handles: ["xai", "OpenAI"] },
]);
// The base prompt stays the first system message so it remains a cache prefix.
assert.equal(directBody.input.length, 3);
assert.equal(directBody.input[0].role, "system");
assert.equal(directBody.input[1].role, "system");
assert.match(directBody.input[1].content, /X \(Twitter\) evidence/);
assert.equal(directBody.input[2].role, "user");

const webOnlyBody = buildResponsesBody("latest docs", baseOptions, { apiProvider: "xai" });
assert.deepEqual(webOnlyBody.tools, [{ type: "web_search" }]);
assert.equal(webOnlyBody.input.length, 2);
assert.equal(webOnlyBody.input.every((message) => !/X \(Twitter\) evidence/.test(message.content)), true);

const xOnlyBody = buildResponsesBody(
  "what is X saying",
  {
    ...baseOptions,
    searchSource: "x",
    excludedXHandles: ["spam_account"],
    xFromDate: "2026-08-01",
    xToDate: "2026-08-16",
    xImageUnderstanding: true,
    xVideoUnderstanding: true,
  },
  { apiProvider: "xai" }
);
assert.deepEqual(xOnlyBody.tools, [
  {
    type: "x_search",
    excluded_x_handles: ["spam_account"],
    from_date: "2026-08-01",
    to_date: "2026-08-16",
    enable_image_understanding: true,
    enable_video_understanding: true,
  },
]);

const nonReasoningBody = buildResponsesBody(
  "latest docs",
  { ...baseOptions, model: "grok-4.20-0309-non-reasoning" },
  { apiProvider: "xai" }
);
assert.equal(Object.hasOwn(nonReasoningBody, "reasoning"), false);

const fixedReasoningBody = buildResponsesBody(
  "latest docs",
  { ...baseOptions, model: "grok-4.20-0309-reasoning" },
  { apiProvider: "xai" }
);
assert.equal(Object.hasOwn(fixedReasoningBody, "reasoning"), false);

const multiAgentBody = buildResponsesBody(
  "latest docs",
  { ...baseOptions, model: "grok-4.20-multi-agent-0309" },
  { apiProvider: "xai" }
);
assert.equal(multiAgentBody.reasoning.effort, "low");

const openRouterBody = buildResponsesBody(
  "latest docs",
  {
    ...baseOptions,
    model: "x-ai/grok-4.1-fast",
    excludedDomains: ["reddit.com"],
    searchSource: "both",
    excludedXHandles: ["noisy_account"],
    xFromDate: "2026-01-01",
    openRouterEngine: "exa",
  },
  { apiProvider: "openrouter" }
);
assert.equal(openRouterBody.model, "x-ai/grok-4.1-fast");
assert.equal(openRouterBody.model.includes(":online"), false);
assert.equal(Object.hasOwn(openRouterBody, "max_turns"), false);
assert.deepEqual(openRouterBody.tools, [
  {
    type: "openrouter:web_search",
    parameters: {
      engine: "exa",
      max_results: 5,
      max_total_results: 10,
      excluded_domains: ["reddit.com"],
    },
  },
]);
assert.deepEqual(openRouterBody.x_search_filter, {
  excluded_x_handles: ["noisy_account"],
  from_date: "2026-01-01",
});

const parsed = parseGrokResponses({
  output: [
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "Answer with citations.",
          annotations: [{ type: "url_citation", url: "https://Example.com/a/#section", title: "Official A" }],
        },
      ],
    },
    {
      type: "web_search_call",
      status: "completed",
      action: {
        sources: [
          { url: "https://example.com/a", title: "Duplicate searched source", snippet: "duplicate" },
          { url: "https://example.com/b", title: "Searched B", snippet: "searched snippet" },
        ],
      },
    },
  ],
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cost_in_usd_ticks: 123456,
  },
});

assert.equal(parsed.text, "Answer with citations.");
assert.equal(parsed.sources.length, 2);
assert.deepEqual(parsed.sources[0], {
  provider: "grok-responses",
  source_type: "citation",
  tool: "web_search",
  url: "https://example.com/a",
  title: "Official A",
  snippet: "duplicate",
});
assert.deepEqual(parsed.sources[1], {
  provider: "grok-responses",
  source_type: "searched",
  tool: "web_search",
  url: "https://example.com/b",
  title: "Searched B",
  snippet: "searched snippet",
});
assert.equal(parsed.diagnostics.responses_web_search_calls, 1);
assert.equal(parsed.diagnostics.responses_x_search_calls, 0);
assert.equal(parsed.diagnostics.cost_in_usd_ticks, 123456);
assert.equal(parsed.diagnostics.cost_usd, 0.0000123456);
assert.deepEqual(parsed.diagnostics.warnings, []);

const openRouterParsed = parseGrokResponses(
  {
    output: [
      {
        type: "message",
        message: {
          content: [
            {
              type: "output_text",
              text: "OpenRouter answer.",
              annotations: [{ url: "https://docs.example.com/page", title: "Docs" }],
            },
          ],
        },
      },
    ],
    citations: ["https://top.example.com/ref"],
    usage: { cost_usd: 0.25 },
  },
  { defaultTool: "openrouter:web_search" }
);

assert.equal(openRouterParsed.text, "OpenRouter answer.");
assert.deepEqual(
  openRouterParsed.sources.map((source) => ({ source_type: source.source_type, tool: source.tool, url: source.url })),
  [
    { source_type: "citation", tool: "openrouter:web_search", url: "https://docs.example.com/page" },
    { source_type: "citation", tool: "openrouter:web_search", url: "https://top.example.com/ref" },
  ]
);
assert.equal(openRouterParsed.diagnostics.cost_usd, 0.25);

const xPayload = {
  output: [
    {
      type: "x_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "from:xai grok 4.5",
        sources: [{ type: "url", url: "https://x.com/xai/status/123" }],
      },
    },
    {
      type: "web_search_call",
      status: "completed",
      action: { type: "open_page", url: "https://docs.x.ai/developers/grok-4-5" },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "X-backed answer.",
          annotations: [{ type: "url_citation", url: "https://x.com/xai/status/123", title: "1" }],
        },
      ],
    },
  ],
};

const xParsed = parseGrokResponses(xPayload, { xEnabled: true });

assert.equal(xParsed.sources.length, 1);
assert.equal(xParsed.sources[0].tool, "x_search");
// The citation title is only the inline marker; the handle comes from the URL instead.
assert.equal(xParsed.sources[0].title, "@xai");
assert.equal(xParsed.sources[0].x_handle, "xai");
assert.equal(xParsed.sources[0].x_post_id, "123");
assert.equal(xParsed.diagnostics.responses_web_search_calls, 1);
assert.equal(xParsed.diagnostics.responses_x_search_calls, 1);
assert.equal(xParsed.diagnostics.responses_tool_call_total, 2);
assert.deepEqual(xParsed.diagnostics.responses_tool_calls, [
  {
    tool: "x_search",
    type: "x_search_call",
    status: "completed",
    action_type: "search",
    query: "from:xai grok 4.5",
    source_count: 1,
  },
  {
    tool: "web_search",
    type: "web_search_call",
    status: "completed",
    action_type: "open_page",
    url: "https://docs.x.ai/developers/grok-4-5",
    source_count: 0,
  },
]);

// Under --source web no x_search tool is mounted, so an x.com citation web search found
// must not be relabeled as an X search that never ran.
const webOnlyXCitation = parseGrokResponses(xPayload, { xEnabled: false });
assert.equal(webOnlyXCitation.sources[0].tool, "web_search");
// The URL-derived attribution is still useful and stays regardless of the mounted tool.
assert.equal(webOnlyXCitation.sources[0].x_handle, "xai");

// Relays that bill x_search without emitting x_search_call items in output[]: usage wins.
const usageCountedParsed = parseGrokResponses({
  output: [
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "Answer from X.",
          annotations: [
            { type: "url_citation", url: "https://x.com/kunchenguid/status/2087942296721559607", title: "1" },
            { type: "url_citation", url: "https://x.com/i/status/2087942296721559608", title: "2" },
          ],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    server_side_tool_usage_details: { web_search_calls: 0, x_search_calls: 8 },
  },
}, { xEnabled: true });

assert.equal(usageCountedParsed.diagnostics.responses_x_search_calls, 8);
assert.equal(usageCountedParsed.diagnostics.responses_web_search_calls, 0);
assert.equal(usageCountedParsed.diagnostics.responses_tool_call_total, 8);
assert.equal(usageCountedParsed.diagnostics.responses_tool_calls.length, 0);
assert.equal(usageCountedParsed.sources[0].title, "@kunchenguid");
assert.equal(usageCountedParsed.sources[0].x_handle, "kunchenguid");
// x.com/i/status/... carries no handle, so the marker title is dropped rather than kept.
assert.equal(usageCountedParsed.sources[1].x_post_id, "2087942296721559608");
assert.equal(Object.hasOwn(usageCountedParsed.sources[1], "x_handle"), false);
assert.equal(Object.hasOwn(usageCountedParsed.sources[1], "title"), false);

// The mirror relay bug: usage reports the field zeroed out while output[] shows the calls.
// Neither source alone is trustworthy, so the higher per-tool count wins.
const zeroedUsageParsed = parseGrokResponses({
  output: [
    { type: "web_search_call", status: "completed", action: { type: "search", query: "a" } },
    { type: "web_search_call", status: "completed", action: { type: "search", query: "b" } },
    { type: "message", content: [{ type: "output_text", text: "Answer." }] },
  ],
  usage: { server_side_tool_usage_details: { web_search_calls: 0, x_search_calls: 0 } },
});
assert.equal(zeroedUsageParsed.diagnostics.responses_web_search_calls, 2);
assert.equal(zeroedUsageParsed.diagnostics.responses_tool_call_total, 2);

const missing = parseGrokResponses({});
assert.equal(missing.text, "");
assert.equal(missing.sources.length, 0);
assert.equal(missing.diagnostics.warnings.length >= 1, true);

console.log("responses fixtures ok");
