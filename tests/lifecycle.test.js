import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "grok-lifecycle-"));
const path = join(home, ".config/grok-search/config.json");
const env = { ...process.env, HOME: home };
for (const key of ["GROK_API_URL", "GROK_API_KEY", "GROK_MODEL", "TAVILY_API_URL", "TAVILY_API_KEY"]) delete env[key];
function payload(target, values, secrets) {
  const canonical = { secrets, target, values };
  return { ...canonical, desired_digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
function run(action, input) {
  return spawnSync(process.execPath, ["bin/grok-search", "lifecycle", action, "--json"], { env, input: JSON.stringify(input), encoding: "utf8" });
}
try {
  await mkdir(join(home, ".config/grok-search"), { recursive: true, mode: 0o700 });
  const original = JSON.stringify({ tavilyApiUrl: "https://tavily.example.test", tavilyApiKey: "test-tavily", defaultExtra: 3 }, null, 4);
  await writeFile(path, original, { mode: 0o600 });
  const tavily = payload("grok-tavily", { base_url: "https://tavily.example.test" }, { api_key: "test-tavily" });
  assert.equal(JSON.parse(run("inspect", tavily).stdout).state, "adoptable");
  assert.notEqual(run("configure", tavily).status, 0);
  tavily.adopt_existing = true;
  assert.equal(run("configure", tavily).status, 0);
  assert.equal(await readFile(path, "utf8"), original);
  const grok = payload("grok", { base_url: "https://grok.example.test", model: "test-model" }, { api_key: "test-grok" });
  const configured = run("configure", grok);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(JSON.parse(run("inspect", tavily).stdout).state, "current");
  assert.equal(JSON.parse(run("inspect", grok).stdout).state, "current");
  const file = JSON.parse(await readFile(path, "utf8"));
  file.defaultExtra = 9;
  await writeFile(path, JSON.stringify(file));
  assert.equal(JSON.parse(run("inspect", grok).stdout).state, "invalid");
  assert.notEqual(run("configure", grok).status, 0);
  assert.notEqual(run("unconfigure", tavily).status, 0);
  console.log("lifecycle adoption, shared receipts and drift guards passed");
} finally {
  await rm(home, { recursive: true, force: true });
}
