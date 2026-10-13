#!/usr/bin/env node
import { loadConfig } from "./lib/config.js";
import { maintainOutputDir } from "./lib/output.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--yes")) {
  console.error("Usage: grok-search prune [--yes]");
  process.exit(2);
}
const execute = args.includes("--yes");
const config = await loadConfig();
const report = await maintainOutputDir(config, { execute });
console.log(JSON.stringify({
  dry_run: !execute,
  ...report,
}, null, 2));
if (report.blocked || report.failed.length) process.exitCode = 1;
