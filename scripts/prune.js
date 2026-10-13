#!/usr/bin/env node
import { loadConfig } from "./lib/config.js";
import { maintainOutputDir } from "./lib/output.js";

const execute = process.argv.includes("--yes");
const config = await loadConfig();
const report = await maintainOutputDir(config, { execute });
console.log(JSON.stringify({
  dry_run: !execute,
  removed: report.removed,
  released_bytes: report.releasedBytes,
  blocked: report.blocked,
}, null, 2));
if (report.blocked) process.exitCode = 1;
