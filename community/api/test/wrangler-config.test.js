import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const local = readFileSync(join(root, "../wrangler.toml"), "utf8");
const deploy = readFileSync(join(root, "../wrangler.deploy.toml"), "utf8");
const coachLocal = readFileSync(join(root, "../wrangler.coach-local.toml"), "utf8");

function quoted(block, key) {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

function tableBlock(src, header) {
  const match = src.match(new RegExp(`(?:^|\\n)${header.replace(/[[\]]/g, "\\$&")}\\s*\\n`));
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = src.slice(start);
  const next = rest.search(/\n\[/);
  return next < 0 ? rest : rest.slice(0, next);
}

function r2Photos(src) {
  for (const part of src.split("[[r2_buckets]]").slice(1)) {
    const block = part.split("\n[")[0];
    if (quoted(block, "binding") === "PHOTOS") {
      return { binding: "PHOTOS", bucket_name: quoted(block, "bucket_name") };
    }
  }
  return null;
}

function hasAiTable(src) {
  return /(?:^|\n)\[ai\]\s*\n/.test(src);
}

test("platform workflow runs on every pull request, including stacked branches", () => {
  const yml = readFileSync(join(root, "../../../.github/workflows/platform.yml"), "utf8");
  const on = yml.split("jobs:")[0];
  assert.match(on, /pull_request:/);
  assert.doesNotMatch(on, /pull_request:\s*\n\s+branches:/);
});

test("wrangler.deploy.toml matches prod: photos on, Workers AI bound for Coach", () => {
  assert.deepEqual(r2Photos(deploy), { binding: "PHOTOS", bucket_name: "shroomlabs-photos" });
  assert.equal(quoted(deploy, "PHOTOS_ENABLED"), "1");
  // Mike approved AI in prod on 2026-10-26 for Coach chat and photo checks.
  assert.equal(hasAiTable(deploy), true);
  assert.equal(quoted(tableBlock(deploy, "[ai]"), "binding"), "AI");
  assert.equal(quoted(deploy, "GROW_COACH_VISION_MODEL"), "@cf/meta/llama-4-scout-17b-16e-instruct");
  // Coach and Autopilot are public. Beta chambers get them free while BETA_ACTIVE is "1".
  assert.equal(quoted(deploy, "COACH_PUBLIC"), "1");
  assert.equal(quoted(deploy, "BETA_ACTIVE"), "1");
  assert.equal(quoted(deploy, "COACH_BETA_USER_IDS"), "82");
  // Jev stays the Autopilot decider, with its caps in code (src/jev.js jevCaps).
  assert.equal(quoted(deploy, "AUTOPILOT_DECIDER"), "jev");
  assert.equal(quoted(deploy, "ENVIRONMENT"), null);
  assert.equal(quoted(deploy, "CF_ACCOUNT_ID"), null);
  assert.equal(quoted(deploy, "WORKERS_AI_TOKEN"), null);
  assert.doesNotMatch(deploy, /ENVIRONMENT\s*=\s*"local"/);
  assert.doesNotMatch(deploy, /WORKERS_AI_TOKEN/);
  assert.equal(quoted(deploy, "COACH_AUTOPILOT_ENABLED"), "1");
  assert.equal(quoted(deploy, "FLEET_UI_ENABLED"), null);
  assert.doesNotMatch(deploy, /FLEET_UI_ENABLED/);
  assert.doesNotMatch(quoted(deploy, "CORS_ORIGIN") || "", /localhost|127\.0\.0\.1/);
  assert.equal(quoted(deploy, "name"), "shroomlabs-api");
  assert.equal(quoted(tableBlock(deploy, "[[d1_databases]]"), "database_id"), quoted(tableBlock(local, "[[d1_databases]]"), "database_id"));
});

test("wrangler.toml keeps local photos off and may bind AI for coach stubs", () => {
  assert.deepEqual(r2Photos(local), { binding: "PHOTOS", bucket_name: "shroomlabs-photos" });
  assert.equal(quoted(local, "PHOTOS_ENABLED"), "0");
});

test("wrangler.coach-local.toml is fully local: no AI binding, REST via .dev.vars", () => {
  assert.equal(hasAiTable(coachLocal), false);
  assert.equal(quoted(coachLocal, "ENVIRONMENT"), "local");
  assert.equal(quoted(coachLocal, "COACH_PUBLIC"), "0");
  assert.equal(quoted(coachLocal, "COACH_BETA_USER_IDS"), "1");
  assert.equal(quoted(coachLocal, "CF_ACCOUNT_ID"), null);
  assert.equal(quoted(coachLocal, "WORKERS_AI_TOKEN"), null);
  assert.equal(quoted(tableBlock(coachLocal, "[[d1_databases]]"), "database_name"), "shroomlabs-coach-local");
  assert.equal(quoted(coachLocal, "GROW_COACH_TEXT_MODEL"), "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(quoted(coachLocal, "CORS_ORIGIN"), "http://127.0.0.1:8888,http://localhost:8888");
  const compat = quoted(coachLocal, "compatibility_date");
  assert.ok(compat, "compatibility_date is required");
  assert.ok(compat <= "2026-05-03", `compatibility_date ${compat} exceeds wrangler 4.86 max 2026-05-03`);
  assert.doesNotMatch(coachLocal, /api\.shroomlabs\.io/);
  assert.equal(quoted(coachLocal, "COACH_AUTOPILOT_ENABLED"), "1");
  assert.equal(quoted(coachLocal, "FLEET_UI_ENABLED"), "1");
  assert.match(coachLocal, /\[triggers\]/);
  assert.match(coachLocal, /crons\s*=\s*\[/);
  assert.doesNotMatch(coachLocal, /COACH_CHAMBER_PASSWORD|COACH_CHAMBER_USER/);
  assert.doesNotMatch(deploy, /COACH_CHAMBER_PASSWORD|COACH_CHAMBER_USER/);
  assert.doesNotMatch(local, /COACH_CHAMBER_PASSWORD|COACH_CHAMBER_USER/);
});

test("both configs bind the live cache objects as SQLite-backed Durable Objects", () => {
  for (const src of [deploy, local]) {
    assert.match(src, /\[\[durable_objects\.bindings\]\]\s*\nname = "DEVICE_LIVE"\s*\nclass_name = "DeviceLive"/);
    assert.match(src, /\[\[durable_objects\.bindings\]\]\s*\nname = "USER_LIVE"\s*\nclass_name = "UserLive"/);
    assert.match(src, /\[\[migrations\]\]\s*\ntag = "v1"\s*\nnew_sqlite_classes = \["DeviceLive", "UserLive"\]/);
  }
});
