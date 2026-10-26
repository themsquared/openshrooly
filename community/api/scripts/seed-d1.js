#!/usr/bin/env node
/** Apply catalog seeds with INSERT OR IGNORE. Use --remote against production D1. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { seedSql } from "../src/seed.js";
import seeds from "../src/seeds.json" with { type: "json" };

const remote = process.argv.includes("--remote");
const printOnly = process.argv.includes("--print");
const sql = seedSql(seeds);
if (printOnly) {
  process.stdout.write(sql);
  process.exit(0);
}

const file = join(mkdtempSync(join(tmpdir(), "shroomlabs-seed-")), "seed.sql");
writeFileSync(file, sql);
const args = ["wrangler", "d1", "execute", "shroomlabs", "--file", file];
if (remote) args.push("--remote");
const result = spawnSync("npx", args, { stdio: "inherit", cwd: join(import.meta.dirname, "..") });
process.exit(result.status ?? 1);
