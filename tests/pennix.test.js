import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const run = (args, env = {}) => execFileAsync("node", args, {
  cwd: process.cwd(),
  env: { ...process.env, GROK_RUN_LOG: "off", ...env },
});

const help = await run(["bin/grok-search", "--help"]);
assert.match(help.stdout, /grok-search <search\|fetch\|map>/);

const testHome = await mkdtemp(path.join(tmpdir(), "grok-search-pennix-home-"));
const events = [];
const server = createServer((req, res) => {
  if (req.url === "/responses") {
    events.push("responses-start");
    req.resume();
    setTimeout(() => {
      events.push("responses-end");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
      }));
    }, 30);
    return;
  }
  if (req.url === "/tavily/search") events.push("tavily-start");
  req.resume();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ results: [] }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = server.address().port;
  const result = await run(["bin/grok-search", "search", "--extra", "1", "ordering check"], {
    HOME: testHome,
    USERPROFILE: testHome,
    GROK_API_URL: `http://127.0.0.1:${port}`,
    GROK_API_KEY: "test-key",
    GROK_API_PROVIDER: "xai",
    GROK_MODEL: "test-model",
    TAVILY_API_KEY: "test-tavily-key",
    TAVILY_API_URL: `http://127.0.0.1:${port}/tavily`,
    FIRECRAWL_API_URL: `http://127.0.0.1:${port}/firecrawl`,
  });
  assert.equal(JSON.parse(result.stdout).diagnostics.options.extra, 1);
  assert.deepEqual(events, ["responses-start", "responses-end", "tavily-start"]);
} finally {
  server.close();
}
