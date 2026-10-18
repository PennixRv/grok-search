import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { configFilePath } from "./config.js";

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

async function readJson(path, optional = false) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid()
      || (metadata.mode & 0o077) !== 0 || metadata.size > 64 * 1024) {
      throw new Error("unsafe lifecycle file");
    }
    const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return JSON.parse(await descriptor.readFile({ encoding: "utf8" }));
    } finally {
      await descriptor.close();
    }
  } catch (error) {
    if (optional && (error?.code === "ENOENT" || error?.code === "ENOTDIR")) return null;
    throw error;
  }
}

async function digest(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path, value) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(0o600);
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeRaw(path, content) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.restore`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.chmod(0o600);
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function inspect(target, desiredDigest = null) {
  const spec = TARGETS[target];
  if (!spec) throw new Error("unknown Grok lifecycle target");
  const { config, receipt } = paths(target);
  const file = await readJson(config, true);
  const record = await readJson(receipt, true);
  const keys = Object.keys(spec.fields);
  if (!file || keys.some((key) => typeof file[key] !== "string" || !file[key].trim())) {
    return { state: "missing", owned: false, detail: "Grok target fields are absent" };
  }
  if (spec.env.some((name) => process.env[name]?.trim())) {
    return { state: "environment-override", owned: Boolean(record), detail: "environment overrides the Grok owner file" };
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

async function configure(target, input) {
  const spec = TARGETS[target];
  if (!spec || input.target !== target || typeof input.desired_digest !== "string" || !input.values || !input.secrets) throw new Error("Grok lifecycle input is invalid");
  if (inputDigest(target, input.values, input.secrets) !== input.desired_digest) throw new Error("Grok lifecycle desired digest is invalid");
  const before = await inspect(target, input.desired_digest);
  if (before.state === "current") return before;
  if (["external", "invalid", "environment-override"].includes(before.state)
    || (before.state === "adoptable" && input.adopt_existing !== true)) throw new Error(`Grok owner state ${before.state} cannot be taken over`);
  const { config, receipt } = paths(target);
  const file = (await readJson(config, true)) || {};
  for (const [field, source] of Object.entries(spec.fields)) {
    if (typeof input.values[source] !== "string" && typeof input.secrets[source] !== "string") throw new Error(`Grok lifecycle field missing: ${source}`);
    const value = spec.secretFields.includes(field) ? input.secrets[source] : input.values[source];
    if (!value || /[\r\n]/.test(value)) throw new Error("Grok lifecycle value is invalid");
    file[field] = value;
  }
  let beforeConfig = null;
  let beforeReceipt = null;
  try { beforeConfig = await readFile(config); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  try { beforeReceipt = await readFile(receipt); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const shared = [];
  for (const other of Object.keys(TARGETS).filter((item) => item !== target)) {
    const otherPath = paths(other).receipt;
    const record = await readJson(otherPath, true);
    if (record) {
      if ((await inspect(other)).state !== "current") throw new Error("shared Grok receipt is invalid or drifted");
      shared.push({ path: otherPath, record, raw: await readFile(otherPath) });
    }
  }
  try {
    if (before.state !== "adoptable") await writeJson(config, file);
    await writeJson(receipt, { schema: 2, owner: "grok-search", target, fields: Object.keys(spec.fields), digest: await digest(config), desiredDigest: input.desired_digest });
    for (const other of shared) await writeJson(other.path, { ...other.record, digest: await digest(config) });
  } catch (error) {
    try {
      if (beforeConfig === null) await rm(config, { force: true }); else await writeRaw(config, beforeConfig);
      if (beforeReceipt === null) await rm(receipt, { force: true }); else await writeRaw(receipt, beforeReceipt);
      for (const other of shared) await writeRaw(other.path, other.raw);
    } catch (rollback) {
      throw new Error("Grok lifecycle write failed and rollback failed", { cause: rollback });
    }
    throw new Error("Grok lifecycle write failed and was rolled back", { cause: error });
  }
  return { state: "current", owned: true, detail: "Grok owner configured without network access" };
}

async function unconfigure(target) {
  const before = await inspect(target);
  if (before.state === "missing") return { state: "absent", owned: false, detail: "Grok target is absent" };
  if (!before.owned || before.state !== "current") throw new Error("Grok lifecycle ownership is missing or drifted");
  const spec = TARGETS[target];
  const { config, receipt } = paths(target);
  const file = await readJson(config);
  for (const field of Object.keys(spec.fields)) delete file[field];
  if (Object.keys(file).length === 0) await rm(config, { force: true });
  else await writeJson(config, file);
  await rm(receipt, { force: true });
  for (const other of Object.keys(TARGETS).filter((item) => item !== target)) {
    const otherPaths = paths(other);
    const otherReceipt = await readJson(otherPaths.receipt, true);
    if (otherReceipt) await writeJson(otherPaths.receipt, { ...otherReceipt, digest: await digest(config) });
  }
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
const parsed = input ? JSON.parse(input) : {};
const target = parsed.target || "grok";
const result = action === "inspect" ? await inspect(target, parsed.desired_digest ?? null)
  : action === "configure" ? await configure(target, parsed)
    : action === "unconfigure" ? await unconfigure(target)
      : (() => { throw new Error("unknown lifecycle action"); })();
process.stdout.write(`${JSON.stringify(result)}\n`);
