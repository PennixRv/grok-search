#!/usr/bin/env node
import assert from "node:assert/strict";
import { compactSource, hasRawSourceValue, mergeSources, parseXPostUrl, selectSources } from "../scripts/lib/sources.js";

assert.deepEqual(parseXPostUrl("https://x.com/xai/status/1975607901571199086"), {
  x_handle: "xai",
  x_post_id: "1975607901571199086",
});
assert.deepEqual(parseXPostUrl("https://twitter.com/elonmusk/statuses/123?s=20"), { x_handle: "elonmusk", x_post_id: "123" });
assert.deepEqual(parseXPostUrl("https://mobile.x.com/xai/status/123"), { x_handle: "xai", x_post_id: "123" });
assert.deepEqual(parseXPostUrl("https://x.com/xai/status/123/photo/1"), { x_handle: "xai", x_post_id: "123" });
// X's own routes are not handles. Only /<handle>/status/<id> names an author, so the
// canonical /i/web/status/<id> form must not be attributed to "@web".
assert.deepEqual(parseXPostUrl("https://x.com/i/status/1975607901571199086"), { x_post_id: "1975607901571199086" });
assert.deepEqual(parseXPostUrl("https://x.com/i/web/status/1975607901571199086"), { x_post_id: "1975607901571199086" });
// Profile URLs from user search still yield attribution.
assert.deepEqual(parseXPostUrl("https://x.com/xai"), { x_handle: "xai" });
assert.equal(parseXPostUrl("https://x.com/about"), null);
assert.equal(parseXPostUrl("https://x.com/login"), null);
assert.equal(parseXPostUrl("https://x.com/i/user/1912644073896206336"), null);
assert.equal(parseXPostUrl("https://x.com/xai/status/not-a-number"), null);
assert.equal(parseXPostUrl("https://example.com/xai/status/123"), null);
assert.equal(parseXPostUrl("https://notx.com/xai/status/123"), null);
assert.equal(parseXPostUrl(""), null);

const xCompacted = compactSource(
  { provider: "grok-responses", url: "https://x.com/xai/status/123", title: "@xai", x_handle: "xai", x_post_id: "123" },
  { sourceChars: 400 }
);
assert.deepEqual(xCompacted, {
  provider: "grok-responses",
  url: "https://x.com/xai/status/123",
  title: "@xai",
  x_handle: "xai",
  x_post_id: "123",
});
// X fields survive compaction, so they must not force a raw-sources dump.
assert.equal(
  hasRawSourceValue(
    { provider: "grok-responses", url: "https://x.com/xai/status/123", title: "@xai", x_handle: "xai", x_post_id: "123" },
    xCompacted
  ),
  false
);

assert.deepEqual(
  mergeSources([{ url: "https://A.example/path/" }], [{ url: "https://a.example/path#section" }, { url: "https://b.example/" }]).map(
    (source) => source.url
  ),
  ["https://A.example/path/", "https://b.example/"]
);

const compacted = compactSource(
  {
    provider: "tavily",
    title: "  Example  ",
    url: "https://example.com/a",
    description: "abcdefghijklmnopqrstuvwxyz",
    score: 0.91,
    published_date: "2026-06-22",
    raw_extra: { hidden: true },
  },
  { sourceChars: 10 }
);
assert.deepEqual(compacted, {
  provider: "tavily",
  url: "https://example.com/a",
  title: "Example",
  snippet: "abcdefghij",
  score: 0.91,
  published_date: "2026-06-22",
});
assert.equal(Object.hasOwn(compacted, "description"), false);
assert.equal(Object.hasOwn(compacted, "content"), false);
assert.equal(hasRawSourceValue({ provider: "tavily", url: "https://example.com/a", description: "abcdefghijklmnopqrstuvwxyz" }, compacted), true);

const noSnippet = compactSource({ provider: "grok", url: "https://example.com/b", description: "hidden" }, { sourceChars: 0 });
assert.deepEqual(noSnippet, { provider: "grok", url: "https://example.com/b" });
assert.equal(hasRawSourceValue({ provider: "grok", url: "https://example.com/b", description: "hidden" }, noSnippet), true);

const fullSnippet = compactSource({ provider: "grok", url: "https://example.com/c", snippet: "short" }, { sourceChars: 400 });
assert.equal(hasRawSourceValue({ provider: "grok", url: "https://example.com/c", snippet: "short" }, fullSnippet), false);

const rankedSources = [
  { url: "https://e.example/1", source_type: "searched" },
  { url: "https://e.example/2", provider: "tavily" },
  { url: "https://e.example/3", source_type: "citation" },
  { url: "https://e.example/4", source_type: "searched" },
];
const capped = selectSources(rankedSources, { maxSources: 2 });
// Citation and extra-provider sources outrank searched-only ones; the picked
// subset keeps the original order.
assert.deepEqual(
  capped.items.map((source) => source.url),
  ["https://e.example/2", "https://e.example/3"]
);
assert.equal(capped.total, 4);
assert.equal(capped.returned, 2);
assert.equal(capped.omitted, 2);

const uncapped = selectSources(rankedSources, { maxSources: 10 });
assert.equal(uncapped.returned, 4);
assert.equal(uncapped.omitted, 0);
assert.deepEqual(selectSources([], { maxSources: 5 }), { items: [], total: 0, returned: 0, omitted: 0 });

console.log("sources fixtures ok");
