import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "grok-lifecycle-"));
const path = join(home, ".config/grok-search/config.json");
const env = { PATH: process.env.PATH, HOME: home };
for (const key of ["GROK_API_URL", "GROK_API_KEY", "GROK_MODEL", "TAVILY_API_URL", "TAVILY_API_KEY"]) delete env[key];
function payload(target, values, secrets) {
  const canonical = { secrets, target, values };
  return { ...canonical, desired_digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
function run(action, input, extraEnvironment = {}) {
  return spawnSync(process.execPath, [new URL("../bin/grok-search", import.meta.url).pathname, "lifecycle", action, "--json"], { env: { ...env, ...extraEnvironment }, input: JSON.stringify(input), encoding: "utf8" });
}
try {
  await mkdir(join(home, ".config/grok-search"), { recursive: true, mode: 0o700 });
  for (const [target, fields] of [["grok", { apiKey: "partial-secret" }],
    ["grok-tavily", { tavilyApiUrl: "https://example.test" }], ["grok", { api_key: "alias-secret" }]]) {
    const original = JSON.stringify(fields);
    await writeFile(path, original, { mode: 0o600 });
    assert.equal(JSON.parse(run("inspect", { target }).stdout).state, "external");
    assert.notEqual(run("configure", payload(target, { base_url: "https://example.test", model: "test" }, { api_key: "synthetic" })).status, 0);
    assert.equal(await readFile(path, "utf8"), original);
  }
  await rm(path);
  const probe = { ...payload("grok", { base_url: "https://example.test", model: "test" }, { api_key: "synthetic" }),
    operation: "configure", operation_id: "grok-probe" };
  const validated = run("validate", probe);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).effect, "none");
  assert.equal(JSON.parse(validated.stdout).operation_id, "grok-probe");
  await assert.rejects(readFile(path), { code: "ENOENT" });
  const original = JSON.stringify({ tavilyApiUrl: "https://tavily.example.test", tavilyApiKey: "test-tavily", defaultExtra: 3 }, null, 4);
  await writeFile(path, original, { mode: 0o600 });
  const tavily = payload("grok-tavily", { base_url: "https://tavily.example.test" }, { api_key: "test-tavily" });
  assert.equal(JSON.parse(run("inspect", tavily).stdout).state, "adoptable");
  assert.notEqual(run("configure", tavily).status, 0);
  tavily.adopt_existing = true;
  assert.equal(run("configure", tavily).status, 0);
  assert.equal(await readFile(path, "utf8"), original);
  const grok = payload("grok", { base_url: "https://grok.example.test", model: "test-model" }, { api_key: "test-grok" });
  const fault = join(home, "fault.mjs");
  await writeFile(fault, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.rename; let failed = false;
fs.rename = async (from, to) => {
  if (!failed && String(to).endsWith('.pennix-lifecycle-grok.json')) {
    failed = true; throw new Error('private failure sentinel');
  }
  return rename(from, to);
};
syncBuiltinESMExports();
`);
  const rejected = run("configure", { ...grok, operation_id: "restore-probe" }, { NODE_OPTIONS: `--import=${fault}` });
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).effect, "restored");
  assert.equal(JSON.parse(rejected.stdout).operation_id, "restore-probe");
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /private failure sentinel|test-grok/);
  assert.equal(await readFile(path, "utf8"), original);
  assert.equal(JSON.parse(run("inspect", tavily).stdout).state, "current");
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
