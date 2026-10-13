#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { maintainOutputDir, printJson, runRecordBase, writeFullOutput, writeRunRecord, writeRunRecordSync } from "../scripts/lib/output.js";

const outputDir = await mkdtemp(path.join(tmpdir(), "grok-search-output-test-"));
const config = { outputDir, outputRetentionDays: 30 };

// CJK labels all slug to the same fallback; parallel writes in the same second
// must still land in distinct files.
const [first, second] = await Promise.all([
  writeFullOutput(config, { kind: "sources", provider: "search", label: "中文查询一", content: "one" }),
  writeFullOutput(config, { kind: "sources", provider: "search", label: "中文查询二", content: "two" }),
]);
assert.notEqual(first, second);
assert.equal(await readFile(first, "utf8"), "one");
assert.equal(await readFile(second, "utf8"), "two");

assert.equal((await stat(first)).mode & 0o777, 0o600);
assert.equal((await stat(second)).mode & 0o777, 0o600);

// Run records: one JSON per command, named by kind, private, with the schema header.
const base = runRecordBase("search", { grokApiKey: "" }, "2026-09-08T00:00:00.000Z");
assert.equal(base.schema_version, 2);
assert.equal(base.kind, "search");
assert.equal(base.created_at, "2026-09-08T00:00:00.000Z");
assert.equal(Array.isArray(base.argv), true);

const runPath = await writeRunRecord(config, {
  kind: "search",
  label: "run record query",
  record: { ...base, query: "run record query", answer: "full answer", error: null },
});
assert.match(path.basename(runPath), /^grok-search-\d{8}-\d{6}-run-search-run-record-query-[0-9a-f]{6}\.json$/);
assert.equal((await stat(runPath)).mode & 0o777, 0o600);
const stored = JSON.parse(await readFile(runPath, "utf8"));
assert.equal(stored.schema_version, 2);
assert.equal(stored.answer, "full answer");
assert.equal(stored.error, null);

// The synchronous variant (used on the deadline exit path) writes the same shape.
const syncPath = writeRunRecordSync(config, { kind: "fetch", label: "https://example.com/x", record: { ...base, kind: "fetch" } });
assert.match(path.basename(syncPath), /-run-fetch-example-com-x-/);
assert.equal(JSON.parse(await readFile(syncPath, "utf8")).kind, "fetch");

// runLog: false disables both variants without touching the disk.
assert.equal(await writeRunRecord({ ...config, runLog: false }, { kind: "search", label: "off", record: base }), null);
assert.equal(writeRunRecordSync({ ...config, runLog: false }, { kind: "search", label: "off", record: base }), null);

const originalLog = console.log;
let boundedOutput;
console.log = (value) => {
  boundedOutput = JSON.parse(value);
};
try {
  printJson({ payload: "x".repeat(50 * 1024) }, { config, kind: "search", provider: "test", label: "large" });
} finally {
  console.log = originalLog;
}
assert.equal(boundedOutput.truncated, true);
assert.equal(typeof boundedOutput.full_path, "string");
assert.equal(boundedOutput.bytes > 45 * 1024, true);
assert.equal(JSON.parse(await readFile(boundedOutput.full_path, "utf8")).payload.length, 50 * 1024);

console.log = (value) => {
  boundedOutput = JSON.parse(value);
};
try {
  printJson({ payload: "x".repeat(50 * 1024) });
} finally {
  console.log = originalLog;
}
assert.equal(boundedOutput.truncated, true);
assert.equal(Object.hasOwn(boundedOutput, "full_path"), false);
assert.match(boundedOutput.warning, /无法保存完整输出/);

// Cleanup is bounded and respects the explicit age/size policy.
await utimes(first, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
const cleanup = await maintainOutputDir({ ...config, outputMaxFiles: 1 }, { execute: true });
assert.equal(cleanup.blocked, false);
assert.equal(cleanup.removed > 0, true);

const absent = path.join(outputDir, "absent");
assert.equal((await maintainOutputDir({ outputDir: absent })).blocked, false);
await assert.rejects(lstat(absent), { code: "ENOENT" });

const policyDir = await mkdtemp(path.join(tmpdir(), "grok-search-policy-"));
const old = path.join(policyDir, "grok-search-old.txt");
const recent = path.join(policyDir, "grok-search-recent.txt");
const active = path.join(policyDir, "grok-search-active.txt");
await writeFile(old, "old");
await writeFile(recent, "recent");
await writeFile(active, "active");
await writeFile(path.join(policyDir, "other-owner.txt"), "retained");
await symlink(old, path.join(policyDir, "grok-search-link.txt"));
await writeFile(path.join(policyDir, "grok-search-old.txt.tmp-123"), "temporary");
await utimes(old, new Date(0), new Date(0));
await utimes(recent, new Date(Date.now() - 120000), new Date(Date.now() - 120000));
const policy = { outputDir: policyDir, outputRetentionDays: 30, outputMaxBytes: 8, outputMaxFiles: 2 };
const preview = await maintainOutputDir(policy);
assert.equal(preview.files, 3);
assert.equal(preview.bytes, 15);
assert.equal(preview.candidates.length, 2);
assert.equal(preview.estimatedBytes, 9);
assert.equal(preview.removed, 0);
assert.equal(preview.releasedBytes, 0);
assert.equal(await readFile(old, "utf8"), "old");
if (process.getuid?.() !== 0) {
  await chmod(policyDir, 0o500);
  try {
    const failed = await maintainOutputDir(policy, { execute: true });
    assert.equal(failed.failed.length, 2);
    assert.equal(failed.removed, 0);
    assert.equal(failed.releasedBytes, 0);
  } finally {
    await chmod(policyDir, 0o700);
  }
}
const executed = await maintainOutputDir(policy, { execute: true });
assert.equal(executed.removed, 2);
assert.equal(executed.releasedBytes, 9);
assert.equal(await readFile(active, "utf8"), "active");
assert.equal((await lstat(path.join(policyDir, "grok-search-link.txt"))).isSymbolicLink(), true);
assert.equal(await readFile(path.join(policyDir, "other-owner.txt"), "utf8"), "retained");

const boundedDir = await mkdtemp(path.join(tmpdir(), "grok-search-bounded-"));
for (let index = 0; index < 8193; index++) await writeFile(path.join(boundedDir, `other-${index}`), "");
const bounded = await maintainOutputDir({ outputDir: boundedDir }, { execute: true });
assert.equal(bounded.blocked, true);
assert.equal(bounded.removed, 0);

// Secrets pasted into argv are masked in the record header.
const originalArgv = process.argv;
process.argv = ["node", "search.js", "--model", "m", "leak sk-secret-value here"];
try {
  const redacted = runRecordBase("search", { grokApiKey: "sk-secret-value" });
  assert.deepEqual(redacted.argv, ["--model", "m", "leak *** here"]);
} finally {
  process.argv = originalArgv;
}

console.log("output fixtures ok");
