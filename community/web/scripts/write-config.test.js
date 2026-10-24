import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("write-config emits apiBase and turnstileSiteKey from env", () => {
  const script = fileURLToPath(new URL("./write-config.js", import.meta.url));
  const configPath = fileURLToPath(new URL("../public/js/config.js", import.meta.url));
  const registerPath = fileURLToPath(new URL("../public/register.html", import.meta.url));
  const before = readFileSync(configPath, "utf8");
  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        API_BASE_URL: "https://api.shroomlabs.io",
        TURNSTILE_SITE_KEY: "0x4AAAAAAFjd0Rzec6mAd5y6",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const written = readFileSync(configPath, "utf8");
    assert.match(written, /apiBase: "https:\/\/api.shroomlabs.io"/);
    assert.match(written, /turnstileSiteKey: "0x4AAAAAAFjd0Rzec6mAd5y6"/);
  } finally {
    writeFileSync(configPath, before);
  }
  assert.doesNotMatch(readFileSync(registerPath, "utf8"), /Turnstile and OIDC keys are documented/);
});

test("visitor-facing pages never mention keys, secrets, docs, infrastructure, or Mike", () => {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
  const allow = /\bpasskeys?\b/gi;
  const banned = [
    { name: "key", re: /\bkeys?\b/i },
    { name: "R2", re: /\bR2\b/i },
    { name: "Cloudflare", re: /Cloudflare/i },
    { name: "wrangler", re: /wrangler/i },
    { name: "docs/", re: /docs\//i },
    { name: "Mike", re: /\bMike\b/ },
    { name: "httpOnly", re: /httpOnly/i },
    { name: "Bearer", re: /\bBearer\b/ },
    { name: "cookie", re: /\bcookies?\b/i },
    { name: "token", re: /\btokens?\b/i },
    { name: "CSR", re: /\bCSR\b/ },
    { name: "mTLS", re: /\bmTLS\b/i },
  ];
  const hits = [];
  for (const name of readdirSync(publicDir).filter((file) => file.endsWith(".html"))) {
    const html = readFileSync(join(publicDir, name), "utf8")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
    const extras = [];
    for (const match of html.matchAll(
      /\b(?:content|placeholder|title|alt|aria-label|aria-description)\s*=\s*("([^"]*)"|'([^']*)')/gi
    )) {
      extras.push(match[2] ?? match[3] ?? "");
    }
    const text = `${html.replace(/<[^>]+>/g, " ")} ${extras.join(" ")}`.replace(allow, " ");
    for (const rule of banned) {
      const found = text.match(rule.re);
      if (found) hits.push(`${name}: ${rule.name} (${found[0]})`);
    }
  }
  assert.deepEqual(hits, []);
});
