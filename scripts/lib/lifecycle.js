import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { configFilePath } from "./config.js";

async function snapshot(path) {
  const metadata = [];
  for (let current = path; ; current = dirname(current)) {
    try { const value = await lstat(current); metadata.push([current, value.mode, value.uid]); }
    catch (error) { if (error?.code !== "ENOENT") throw error; metadata.push([current, null]); }
    if (current === dirname(current)) break;
  }
  return [await digest(path), metadata];
}

const TARGETS = {
  grok: {
    fields: { apiUrl: "base_url", apiKey: "api_key", model: "model" },
    secretFields: ["apiKey"],
    env: ["GROK_API_URL", "GROK_API_KEY", "GROK_MODEL"],
  },
  "grok-tavily": {
    fields: { tavilyApiUrl: "base_url", tavilyApiKey: "api_key" },
    secretFields: ["tavilyApiKey"],
    env: ["TAVILY_API_URL", "TAVILY_API_KEY"],
  },
};

function paths(target) {
  const config = configFilePath();
  return { config, receipt: join(dirname(config), `.pennix-lifecycle-${target}.json`) };
}

function inputDigest(target, values, secrets) {
  const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ secrets: sorted(secrets), target, values: sorted(values) })).digest("hex");
}

async function readRaw(path, optional = false) {
  if (!path.startsWith("/")) throw new Error("lifecycle path must be absolute");
  for (let current = dirname(path); ; current = dirname(current)) {
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || ![0, process.getuid()].includes(info.uid)
        || (info.mode & 0o022) && !(info.mode & 0o1000)) throw new Error("unsafe lifecycle parent");
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (current === dirname(current)) break;
  }
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid()
      || (metadata.mode & 0o077) !== 0 || metadata.size > 64 * 1024) throw new Error("unsafe lifecycle file");
    const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return await descriptor.readFile(); } finally { await descriptor.close(); }
  } catch (error) { if (optional && error?.code === "ENOENT") return null; throw error; }
}

async function readJson(path, optional = false) {
  const raw = await readRaw(path, optional);
  if (raw === null) return null;
  const value = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid lifecycle object");
  return value;
}

async function digest(path) {
  const raw = await readRaw(path, true);
  return raw === null ? null : createHash("sha256").update(raw).digest("hex");
}

function jsonBytes(value) { return value === null ? null : Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function same(left, right) { return left === null ? right === null : right !== null && left.equals(right); }

async function writeRaw(path, content, before) {
  if (!same(await readRaw(path, true), before)) throw new Error("lifecycle target changed before write");
  if (same(content, before)) return;
  if (content === null) { await rm(path); return; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.chmod(0o600);
    await handle.close();
    if (!same(await readRaw(path, true), before)) throw new Error("lifecycle target changed before commit");
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function commitFiles(writes) {
  for (const item of writes) if (!same(await readRaw(item.path, true), item.before)) throw new Error("lifecycle inputs changed");
  const committed = [];
  try {
    for (const item of writes) { await writeRaw(item.path, item.after, item.before); committed.push(item); }
  } catch (error) {
    try { for (const item of committed.reverse()) await writeRaw(item.path, item.before, item.after); }
    catch (rollback) { throw new Error("Grok lifecycle operation failed and rollback failed", { cause: rollback }); }
    throw new Error("Grok lifecycle operation failed and was rolled back", { cause: error });
  }
}

async function sharedReceipts(target) {
  const shared = [];
  for (const other of Object.keys(TARGETS).filter(name => name !== target)) {
    const path = paths(other).receipt;
    const raw = await readRaw(path, true);
    if (raw !== null) {
      if ((await inspect(other)).state !== "current") throw new Error("shared Grok receipt is invalid or drifted");
      shared.push({ path, raw, record: JSON.parse(raw) });
    }
  }
  return shared;
}

async function inspect(target, desiredDigest = null) {
  const spec = TARGETS[target];
  if (!spec) throw new Error("unknown Grok lifecycle target");
  const { config, receipt } = paths(target);
  const file = await readJson(config, true);
  const record = await readJson(receipt, true);
  const keys = Object.keys(spec.fields);
  if (record && (record.schema !== 2 || record.owner !== "grok-search" || record.target !== target
    || !Array.isArray(record.fields) || record.fields.join("\0") !== keys.join("\0")
    || typeof record.digest !== "string" || typeof record.desiredDigest !== "string")) {
    return { state: "invalid", owned: false, detail: "Grok lifecycle receipt is invalid" };
  }
  const aliases = target === "grok"
    ? ["GROK_API_URL", "grokApiUrl", "grok_api_url", "api_url", "GROK_API_KEY", "grokApiKey", "grok_api_key", "api_key", "GROK_MODEL", "grokModel", "grok_model"]
    : ["TAVILY_API_URL", "tavily_api_url", "TAVILY_API_KEY", "tavily_api_key"];
  if (spec.env.some((name) => process.env[name]?.trim())) {
    return { state: "environment-override", owned: Boolean(record), detail: "environment overrides the Grok owner file" };
  }
  if (!file || ![...keys, ...aliases].some((key) => Object.hasOwn(file, key))) {
    if (record) return { state: "orphaned", owned: true, detail: "Grok target fields are missing from their receipt" };
    return { state: "missing", owned: false, detail: "Grok target fields are absent" };
  }
  if (keys.some((key) => typeof file[key] !== "string" || !file[key].trim()) || aliases.some((key) => Object.hasOwn(file, key))) {
    return { state: record ? "invalid" : "external", owned: Boolean(record), detail: "Grok target contains partial or aliased fields" };
  }
  if (!record) {
    const values = {}, secrets = {};
    for (const [field, name] of Object.entries(spec.fields)) (spec.secretFields.includes(field) ? secrets : values)[name] = file[field];
    const expected = inputDigest(target, values, secrets);
    return { state: desiredDigest === expected ? "adoptable" : "external", owned: false, detail: "Grok target fields exist without lifecycle ownership" };
  }
  if (record.schema !== 2 || record.owner !== "grok-search" || record.target !== target
    || !Array.isArray(record.fields) || typeof record.digest !== "string" || typeof record.desiredDigest !== "string") {
    return { state: "invalid", owned: false, detail: "Grok lifecycle receipt is invalid" };
  }
  if (record.digest !== await digest(config)) return { state: "invalid", owned: true, detail: "Grok owner file changed outside lifecycle ownership" };
  const current = record.schema === 2 && record.owner === "grok-search" && record.target === target
    && Array.isArray(record.fields) && record.fields.join("\0") === keys.join("\0")
    && record.digest === await digest(config)
    && (!desiredDigest || record.desiredDigest === desiredDigest);
  return { state: current ? "current" : "drifted", owned: true, detail: current ? "Grok owner file matches lifecycle receipt" : "Grok owner file drifted" };
}

async function validateLifecycle(target, input, operation) {
  const spec = TARGETS[target];
  if (!spec || !["configure", "unconfigure"].includes(operation)) throw new Error("invalid Grok lifecycle operation");
  const { config, receipt } = paths(target);
  const beforeConfig = await readRaw(config, true);
  const beforeReceipt = await readRaw(receipt, true);
  const unchanged = async () => {
    if (!same(await readRaw(config, true), beforeConfig) || !same(await readRaw(receipt, true), beforeReceipt)) {
      throw new Error("Grok lifecycle inputs changed during validation");
    }
  };
  await sharedReceipts(target);
  if (operation === "unconfigure") {
    const before = await inspect(target);
    if (before.state !== "missing" && (!before.owned || !["current", "orphaned"].includes(before.state))) throw new Error("Grok lifecycle ownership is missing or drifted");
    await unchanged();
    return { before, beforeConfig, beforeReceipt };
  }
  if (!spec || input.target !== target || typeof input.desired_digest !== "string" || !input.values || !input.secrets) throw new Error("Grok lifecycle input is invalid");
  if (inputDigest(target, input.values, input.secrets) !== input.desired_digest) throw new Error("Grok lifecycle desired digest is invalid");
  const before = await inspect(target, input.desired_digest);
  if (["external", "invalid", "environment-override", "orphaned"].includes(before.state)
    || (before.state === "adoptable" && input.adopt_existing !== true)) throw new Error(`Grok owner state ${before.state} cannot be taken over`);
  const file = beforeConfig === null ? {} : JSON.parse(beforeConfig);
  for (const [field, source] of Object.entries(spec.fields)) {
    if (typeof input.values[source] !== "string" && typeof input.secrets[source] !== "string") throw new Error(`Grok lifecycle field missing: ${source}`);
    const value = spec.secretFields.includes(field) ? input.secrets[source] : input.values[source];
    if (!value || /[\r\n]/.test(value)) throw new Error("Grok lifecycle value is invalid");
    file[field] = value;
  }
  await unchanged();
  return { before, file, beforeConfig, beforeReceipt };
}

async function configure(target, input) {
  const spec = TARGETS[target];
  const { before, file, beforeConfig, beforeReceipt } = await validateLifecycle(target, input, "configure");
  if (before.state === "current") return before;
  const { config, receipt } = paths(target);
  const shared = await sharedReceipts(target);
  const afterConfig = before.state === "adoptable" ? beforeConfig : jsonBytes(file);
  const hash = createHash("sha256").update(afterConfig).digest("hex");
  await commitFiles([
    { path: config, before: beforeConfig, after: afterConfig },
    { path: receipt, before: beforeReceipt, after: jsonBytes({ schema: 2, owner: "grok-search", target,
      fields: Object.keys(spec.fields), digest: hash, desiredDigest: input.desired_digest }) },
    ...shared.map(item => ({ path: item.path, before: item.raw, after: jsonBytes({ ...item.record, digest: hash }) })),
  ]);
  return { state: "current", owned: true, detail: "Grok owner configured without network access" };
}

async function unconfigure(target) {
  const { before, beforeConfig, beforeReceipt } = await validateLifecycle(target, {}, "unconfigure");
  if (before.state === "missing") return { state: "absent", owned: false, detail: "Grok target is absent" };
  const { config, receipt } = paths(target);
  if (before.state === "orphaned" && before.owned) {
    await commitFiles([{ path: receipt, before: beforeReceipt, after: null }]);
    return { state: "absent", owned: false, detail: "Grok orphaned receipt removed" };
  }
  if (!before.owned || before.state !== "current") throw new Error("Grok lifecycle ownership is missing or drifted");
  const file = JSON.parse(beforeConfig);
  const shared = await sharedReceipts(target);
  for (const field of Object.keys(TARGETS[target].fields)) delete file[field];
  const afterConfig = Object.keys(file).length ? jsonBytes(file) : null;
  const hash = afterConfig === null ? null : createHash("sha256").update(afterConfig).digest("hex");
  await commitFiles([
    { path: config, before: beforeConfig, after: afterConfig },
    { path: receipt, before: beforeReceipt, after: null },
    ...shared.map(item => ({ path: item.path, before: item.raw, after: jsonBytes({ ...item.record, digest: hash }) })),
  ]);
  return { state: "absent", owned: false, detail: "Grok target fields removed" };
}

const input = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { value += chunk; });
  process.stdin.on("end", () => resolve(value));
  process.stdin.on("error", reject);
});
const [action] = process.argv.slice(2);
const protocol = { protocol_version: 1, capabilities: ["validate", "execution-effect"], operation_id: null };
let effect = "none";
let baseline = null;
let observedPaths = [];
try {
  const parsed = input ? JSON.parse(input) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid lifecycle input");
  if (parsed.operation_id !== undefined && (typeof parsed.operation_id !== "string" || !parsed.operation_id.trim() || parsed.operation_id.length > 200)) throw new Error("invalid operation identity");
  protocol.operation_id = parsed.operation_id ?? null;
  const target = parsed.target || "grok";
  let result;
  if (action === "inspect") result = await inspect(target, parsed.desired_digest ?? null);
  else {
    const operation = action === "validate" ? parsed.operation : action;
    const { before } = await validateLifecycle(target, parsed, operation);
    if (action === "validate") result = before;
    else {
      observedPaths = [...new Set(Object.keys(TARGETS).flatMap(name => Object.values(paths(name))))];
      baseline = await Promise.all(observedPaths.map(snapshot));
      effect = "unknown";
      result = action === "configure" ? await configure(target, parsed) : await unconfigure(target);
      effect = action === "configure" && before.state === "current" || action === "unconfigure" && before.state === "missing" ? "none" : "changed";
    }
  }
  process.stdout.write(`${JSON.stringify({ ...result, ...protocol, effect })}\n`);
} catch {
  if (baseline) {
    try {
      if (JSON.stringify(await Promise.all(observedPaths.map(snapshot))) === JSON.stringify(baseline)) effect = "restored";
    } catch { /* Unreadable post-state remains unknown. */ }
  }
  process.stdout.write(`${JSON.stringify({ ...protocol, effect, state: "blocked", owned: false, detail: "Grok lifecycle operation failed" })}\n`);
  process.exitCode = 2;
}
