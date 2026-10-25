import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const local = readFileSync(join(root, "../wrangler.toml"), "utf8");
const deploy = readFileSync(join(root, "../wrangler.deploy.toml"), "utf8");

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

test("wrangler.deploy.toml matches prod: photos on, AI bound, Coach private beta", () => {
  assert.deepEqual(r2Photos(deploy), { binding: "PHOTOS", bucket_name: "shroomlabs-photos" });
  assert.equal(quoted(deploy, "PHOTOS_ENABLED"), "1");
  assert.equal(hasAiTable(deploy), true);
  assert.equal(quoted(tableBlock(deploy, "[ai]"), "binding"), "AI");
  assert.equal(quoted(deploy, "COACH_PUBLIC"), "0");
  assert.equal(quoted(deploy, "COACH_BETA_USER_IDS"), "82");
  assert.equal(quoted(deploy, "name"), "shroomlabs-api");
  assert.equal(quoted(tableBlock(deploy, "[[d1_databases]]"), "database_id"), quoted(tableBlock(local, "[[d1_databases]]"), "database_id"));
});

test("wrangler.toml keeps local photos off and may bind AI for coach stubs", () => {
  assert.deepEqual(r2Photos(local), { binding: "PHOTOS", bucket_name: "shroomlabs-photos" });
  assert.equal(quoted(local, "PHOTOS_ENABLED"), "0");
});
