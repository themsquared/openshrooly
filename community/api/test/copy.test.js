import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "../../web/public");
const ALLOW = /\bpasskeys?\b/gi;
const BANNED = [
  { name: "key", re: /\bkeys?\b/i },
  { name: "R2", re: /\bR2\b/i },
  { name: "Cloudflare", re: /Cloudflare/i },
  { name: "wrangler", re: /wrangler/i },
  { name: "docs/", re: /docs\//i },
  { name: "Mike", re: /\bMike\b/ },
];

function visitorFacing(html) {
  const withoutAssets = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const extras = [];
  for (const match of withoutAssets.matchAll(
    /\b(?:content|placeholder|title|alt|aria-label|aria-description)\s*=\s*("([^"]*)"|'([^']*)')/gi
  )) {
    extras.push(match[2] ?? match[3] ?? "");
  }
  const text = `${withoutAssets.replace(/<[^>]+>/g, " ")} ${extras.join(" ")}`;
  return text.replace(ALLOW, " ").replace(/\s+/g, " ");
}

function pages() {
  return readdirSync(PUBLIC)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({ name, html: readFileSync(join(PUBLIC, name), "utf8") }));
}

test("visitor-facing pages never mention keys, secrets, docs, infrastructure, or Mike", () => {
  const hits = [];
  for (const page of pages()) {
    const text = visitorFacing(page.html);
    for (const rule of BANNED) {
      const found = text.match(rule.re);
      if (found) hits.push(`${page.name}: ${rule.name} (${found[0]})`);
    }
  }
  assert.deepEqual(hits, []);
});
