#!/usr/bin/env node
/**
 * Set an AC Infinity controller from a Shroom Labs grow profile stage. Community, untested.
 *
 *   node scripts/ac-infinity-apply.js --profile lions-mane --stage fruiting          (dry run, prints the plan)
 *   node scripts/ac-infinity-apply.js --profile lions-mane --stage fruiting --apply  (writes to the controller)
 *   node scripts/ac-infinity-apply.js --list-controllers
 *
 * Credentials and ports come from your environment only (see configFromEnv in src/adapters/ac-infinity.js).
 * Put them in your shell or a local file you never commit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { applyStage, configFromEnv, createAcInfinityClient } from "../src/adapters/ac-infinity.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const PROFILES = join(import.meta.dirname, "..", "..", "..", "data", "profiles");

function findProfile(id) {
  const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(`${id}.json`) && f === `${id}.json` ? [p] : []; });
  const hit = walk(PROFILES)[0];
  if (!hit) throw new Error(`no profile named ${id}`);
  return JSON.parse(readFileSync(hit, "utf8"));
}

const cfg = configFromEnv();
if (flag("list-controllers")) {
  const client = createAcInfinityClient(cfg);
  await client.login();
  for (const c of (await client.controllers()) || []) console.log(`${c.devId}\t${c.devName}`);
  process.exit(0);
}
const profile = findProfile(opt("profile") || "");
const stage = profile.stages.find((s) => s.id === opt("stage")) || profile.stages[profile.stages.length - 1];
const apply = flag("apply");
const result = await applyStage({ client: apply ? createAcInfinityClient(cfg) : null, controllerId: cfg.controllerId, ports: cfg.ports, stage, apply });
console.log(`${profile.name}, ${stage.name}: ${result.applied ? "written" : "dry run, nothing sent"}`);
for (const p of result.plan) console.log(`port ${p.port} ${p.device}: ${JSON.stringify(p.values)}${p.notes.length ? ` (${p.notes.join("; ")})` : ""}`);
