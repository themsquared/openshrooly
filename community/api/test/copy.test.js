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
  { name: "httpOnly", re: /httpOnly/i },
  { name: "Bearer", re: /\bBearer\b/ },
  { name: "cookie", re: /\bcookies?\b/i },
  { name: "token", re: /\btokens?\b/i },
  { name: "CSR", re: /\bCSR\b/ },
  { name: "mTLS", re: /\bmTLS\b/i },
  { name: "JSON", re: /\bJSON\b/ },
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
  const names = [
    ...readdirSync(PUBLIC).filter((name) => name.endsWith(".html")),
    ...["profiles", "auth", "guides"].flatMap((dir) =>
      readdirSync(join(PUBLIC, dir))
        .filter((name) => name.endsWith(".html"))
        .map((name) => `${dir}/${name}`)
    ),
  ];
  return names.map((name) => ({ name, html: readFileSync(join(PUBLIC, name), "utf8") }));
}

// The privacy policy has to name the vendors that see data and say what cookies we set
// (Stripe requires both), so it alone may say "Cloudflare" and "cookie".
const LEGAL_ALLOW = { "privacy.html": new Set(["Cloudflare", "cookie"]) };

test("visitor-facing pages never mention keys, secrets, docs, infrastructure, or Mike", () => {
  const hits = [];
  for (const page of pages()) {
    const text = visitorFacing(page.html);
    for (const rule of BANNED) {
      if (LEGAL_ALLOW[page.name]?.has(rule.name)) continue;
      const found = text.match(rule.re);
      if (found) hits.push(`${page.name}: ${rule.name} (${found[0]})`);
    }
  }
  assert.deepEqual(hits, []);
});

test("public pages share one nav label set", () => {
  const required = ["Profiles", "Grow guides", "FAQ", "Docs"];
  const missing = [];
  for (const page of pages()) {
    if (page.name === "legacy-preview.html") continue;
    const text = visitorFacing(page.html);
    for (const label of required) {
      if (!text.includes(label)) missing.push(`${page.name}: ${label}`);
    }
  }
  assert.deepEqual(missing, []);
});

const DASH = /[\u2013\u2014]/;

test("visitor-facing pages and chrome never use en or em dashes", () => {
  const hits = [];
  for (const page of pages()) {
    const found = visitorFacing(page.html).match(DASH);
    if (found) hits.push(`${page.name}: ${found[0]}`);
  }
  const jsDir = join(PUBLIC, "js");
  for (const name of readdirSync(jsDir).filter((file) => file.endsWith(".js"))) {
    const found = readFileSync(join(jsDir, name), "utf8").match(DASH);
    if (found) hits.push(`js/${name}: ${found[0]}`);
  }
  assert.deepEqual(hits, []);
});

test("home pack toggle is Off-menu, not Restricted", () => {
  const home = pages().find((page) => page.name === "index.html");
  const text = visitorFacing(home.html);
  assert.match(text, /Off-menu/);
  const hits = [];
  for (const page of pages()) {
    if (/Restricted/i.test(visitorFacing(page.html))) hits.push(page.name);
  }
  assert.deepEqual(hits, []);
});

test("shared chrome uses an accessible mobile menu button", () => {
  const missing = [];
  for (const page of pages()) {
    if (page.name === "legacy-preview.html") continue;
    if (!page.html.includes('class="nav-toggle"')) missing.push(`${page.name}: nav-toggle`);
    if (!page.html.includes('aria-expanded="false"')) missing.push(`${page.name}: aria-expanded`);
    if (!page.html.includes('aria-controls="site-nav"')) missing.push(`${page.name}: aria-controls`);
    if (!page.html.includes('id="site-nav"')) missing.push(`${page.name}: site-nav`);
  }
  assert.deepEqual(missing, []);
});

const API_SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const DASH_ESCAPE = /\\u(?:2013|2014|\{201[34]\})/i;

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

test("API error messages and other API strings never use en or em dashes", () => {
  const hits = [];
  for (const name of readdirSync(API_SRC).filter((file) => /\.(js|json)$/.test(file))) {
    const source = readFileSync(join(API_SRC, name), "utf8");
    const code = name.endsWith(".json") ? source : withoutComments(source);
    for (const literal of code.match(STRING_LITERAL) || []) {
      if (DASH.test(literal) || DASH_ESCAPE.test(literal)) hits.push(`src/${name}: ${literal.slice(0, 80)}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("thrown API errors and json error bodies are dash-free", () => {
  const hits = [];
  const errorCall = /(?:new\s+\w*Error\s*\(|\berror\s*:)\s*([\s\S]{0,200}?)[,)}]/g;
  for (const name of readdirSync(API_SRC).filter((file) => file.endsWith(".js"))) {
    const code = withoutComments(readFileSync(join(API_SRC, name), "utf8"));
    for (const match of code.matchAll(errorCall)) {
      if (DASH.test(match[1])) hits.push(`src/${name}: ${match[1].slice(0, 80)}`);
    }
  }
  assert.deepEqual(hits, []);
});
