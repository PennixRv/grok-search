import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat, mkdir, opendir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "./http.js";
import {
  DEFAULT_OUTPUT_MAX_BYTES,
  DEFAULT_OUTPUT_MAX_FILES,
  DEFAULT_OUTPUT_RETENTION_DAYS,
} from "./config.js";

const OUTPUT_PREFIX = "grok-search-";
const MAX_MAINTENANCE_ENTRIES = 8192;
const ACTIVE_OUTPUT_GRACE_MS = 60 * 1000;
export const RUN_RECORD_SCHEMA_VERSION = 2;
export const MAX_SERIALIZED_OUTPUT_BYTES = 45 * 1024;

function debug(config, message) {
  if (config?.debug) console.error(`[grok-search] ${message}`);
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function slug(value, fallback = "output") {
  const out = String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function extensionFor(value) {
  const ext = String(value || "txt").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return ext || "txt";
}

export async function cleanupOutputDir(config) {
  await maintainOutputDir(config, { execute: true });
}

export async function maintainOutputDir(config, { execute = false } = {}) {
  const outputDir = config?.outputDir;
  const report = { files: 0, bytes: 0, candidates: [], estimatedBytes: 0, removed: 0, releasedBytes: 0, skipped: [], failed: [], blocked: false };
  if (!outputDir) return report;

  try {
    const rootStat = await lstat(outputDir);
    if (!rootStat.isDirectory()) throw new Error("output directory is not a regular directory");
    const now = Date.now();
    const cutoff = now - (config.outputRetentionDays || DEFAULT_OUTPUT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    const activeCutoff = now - ACTIVE_OUTPUT_GRACE_MS;
    const files = [];
    let scanned = 0;
    const directory = await opendir(outputDir);
    for await (const entry of directory) {
      if (++scanned > MAX_MAINTENANCE_ENTRIES || Date.now() - now > 5000) {
        report.blocked = true;
        report.reason = "scan limit exceeded";
        return report;
      }
      if (!entry.name.startsWith(OUTPUT_PREFIX)) continue;
      if (!entry.isFile() || entry.name.includes(".tmp-")) {
        report.skipped.push({ name: entry.name, reason: "non-regular or temporary file" });
        continue;
      }
      const fullPath = path.join(outputDir, entry.name);
      try {
        const fileStat = await lstat(fullPath);
        if (!fileStat.isFile()) {
          report.skipped.push({ name: entry.name, reason: "non-regular file" });
          continue;
        }
        files.push({ name: entry.name, path: fullPath, mtimeMs: fileStat.mtimeMs, bytes: fileStat.size, ino: fileStat.ino });
        if (fileStat.mtimeMs >= activeCutoff) report.skipped.push({ name: entry.name, reason: "active grace period" });
      } catch (error) {
        report.skipped.push({ name: entry.name, reason: error.code || error.message });
      }
    }
    const maxBytes = config.outputMaxBytes || DEFAULT_OUTPUT_MAX_BYTES;
    const maxFiles = config.outputMaxFiles || DEFAULT_OUTPUT_MAX_FILES;
    const eligible = files
      .filter((file) => file.mtimeMs < activeCutoff)
      .sort((left, right) => left.mtimeMs - right.mtimeMs);
    let totalBytes = files.reduce((total, file) => total + file.bytes, 0);
    let totalFiles = files.length;
    report.files = totalFiles;
    report.bytes = totalBytes;
    const candidates = [];
    for (const file of eligible) {
      if (file.mtimeMs < cutoff || totalBytes > maxBytes || totalFiles > maxFiles) {
        candidates.push(file);
        totalBytes -= file.bytes;
        totalFiles--;
      }
    }
    report.candidates = candidates.map(({ name, bytes }) => ({ name, bytes }));
    report.estimatedBytes = candidates.reduce((total, file) => total + file.bytes, 0);
    for (const file of candidates) {
      if (execute) {
        try {
          const current = await lstat(file.path);
          if (!current.isFile() || current.ino !== file.ino || current.size !== file.bytes || current.mtimeMs !== file.mtimeMs) {
            report.skipped.push({ name: file.name, reason: "changed after selection" });
            continue;
          }
          await unlink(file.path);
          report.removed++;
          report.releasedBytes += file.bytes;
        } catch (error) {
          const results = error.code === "ENOENT" ? report.skipped : report.failed;
          results.push({ name: file.name, reason: error.code || error.message });
        }
      }
    }
    return report;
  } catch (error) {
    if (error.code === "ENOENT") return report;
    debug(config, `output cleanup skipped: ${error.message}`);
    return { ...report, blocked: true, reason: error.code || error.message };
  }
}

async function writeAtomic(fullPath, content) {
  const temporaryPath = `${fullPath}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, fullPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function writeAtomicSync(fullPath, content) {
  const temporaryPath = `${fullPath}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, fullPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
}

function outputPath(config, { kind, provider, label, extension = "txt" }) {
  const fileName = [
    OUTPUT_PREFIX,
    timestamp(),
    "-",
    slug(kind, "output"),
    "-",
    slug(provider, "provider"),
    "-",
    slug(label, "content"),
    "-",
    // Second-granularity timestamps plus slug fallbacks (e.g. CJK labels) collide
    // across parallel invocations; a random suffix keeps each file distinct.
    randomBytes(3).toString("hex"),
    ".",
    extensionFor(extension),
  ].join("");
  return path.join(config.outputDir, fileName);
}

export async function writeFullOutput(config, { kind, provider, label, content, extension = "txt" }) {
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  const fullPath = outputPath(config, { kind, provider, label, extension });
  await writeAtomic(fullPath, content);
  return fullPath;
}

export async function writeJsonOutput(config, { kind, provider, label, value }) {
  return writeFullOutput(config, {
    kind,
    provider,
    label,
    content: JSON.stringify(value, jsonReplacer, 2),
    extension: "json",
  });
}

/**
 * Common head of a run record. `argv` is what the caller typed, minus any configured
 * secret that happened to be pasted into it.
 */
export function runRecordBase(kind, config, createdAt = new Date().toISOString()) {
  return {
    schema_version: RUN_RECORD_SCHEMA_VERSION,
    kind,
    created_at: createdAt,
    argv: process.argv.slice(2).map((arg) => redactSecrets(arg, config)),
  };
}

function runLogEnabled(config) {
  return Boolean(config?.outputDir) && config?.runLog !== false;
}

/**
 * One JSON file per command so a run can be replayed later: query, resolved options, the
 * full answer, every source, usage, tool calls and errors. Cheap to keep (a few KB, swept by
 * the 30-day retention) and the only durable trace of what a search cost and returned.
 */
export async function writeRunRecord(config, { kind, label, record }) {
  if (!runLogEnabled(config)) return null;
  try {
    return await writeJsonOutput(config, { kind: "run", provider: kind, label, value: record });
  } catch (error) {
    debug(config, `run record skipped: ${error.message}`);
    return null;
  }
}

/** Synchronous variant for exit paths (the deadline handler calls process.exit right after). */
export function writeRunRecordSync(config, { kind, label, record }) {
  if (!runLogEnabled(config)) return null;
  try {
    mkdirSync(config.outputDir, { recursive: true, mode: 0o700 });
    const fullPath = outputPath(config, { kind: "run", provider: kind, label, extension: "json" });
    writeAtomicSync(fullPath, JSON.stringify(record, jsonReplacer, 2));
    return fullPath;
  } catch (error) {
    debug(config, `run record skipped: ${error.message}`);
    return null;
  }
}

export async function previewText(config, { kind, provider, label, content, maxChars, extension = "txt" }) {
  const text = String(content ?? "");
  const limit = Number.isFinite(maxChars) ? Math.max(0, maxChars) : text.length;
  const truncated = text.length > limit;
  const preview = truncated ? text.slice(0, limit).trimEnd() : text;
  const fullOutputPath = truncated
    ? await writeFullOutput(config, { kind, provider, label, content: text, extension })
    : null;

  return {
    preview,
    truncated,
    original_length: text.length,
    full_output_path: fullOutputPath,
  };
}

export function jsonReplacer(_key, value) {
  return value === undefined ? undefined : value;
}

export function printJson(value, { config, kind = "output", provider = "result", label = "output" } = {}) {
  const serialized = JSON.stringify(value, jsonReplacer, 2);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= MAX_SERIALIZED_OUTPUT_BYTES) {
    console.log(serialized);
    return;
  }

  let fullPath = null;
  if (config?.outputDir) {
    try {
      mkdirSync(config.outputDir, { recursive: true, mode: 0o700 });
      fullPath = outputPath(config, { kind, provider, label, extension: "json" });
      writeAtomicSync(fullPath, serialized);
    } catch (error) {
      debug(config, `bounded output archive skipped: ${error.message}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        truncated: true,
        ...(fullPath ? { full_path: fullPath } : {}),
        chars: serialized.length,
        bytes,
        warning: fullPath
          ? `完整 JSON 输出超过 ${MAX_SERIALIZED_OUTPUT_BYTES} 字节，已保存到 full_path。`
          : `完整 JSON 输出超过 ${MAX_SERIALIZED_OUTPUT_BYTES} 字节，且无法保存完整输出。`,
      },
      jsonReplacer,
      2
    )
  );
}
