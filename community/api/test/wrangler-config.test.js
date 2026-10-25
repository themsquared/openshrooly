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

test("wrangler.deploy.toml matches prod: photos on, no AI binding", () => {
  assert.deepEqual(r2Photos(deploy), { binding: "PHOTOS", bucket_name: "shroomlabs-photos" });
  assert.equal(quoted(deploy, "PHOTOS_ENABLED"), "1");
  assert.equal(hasAiTable(deploy), false);
  assert.equal(quoted(deploy, "COACH_PUBLIC"), null);
  assert.equal(quoted(deploy, "COACH_BETA_USER_IDS"), null);
  assert.equal(quoted(deploy, "ENVIRONMENT"), null);
  assert.equal(quoted(deploy, "CF_ACCOUNT_ID"), null);
  assert.equal(quoted(deploy, "WORKERS_AI_TOKEN"), null);
  assert.doesNotMatch(deploy, /ENVIRONMENT\s*=\s*"local"/);
  assert.doesNotMatch(deploy, /WORKERS_AI_TOKEN/);
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
  assert.doesNotMatch(coachLocal, /api\.shroomlabs\.io/);
});
