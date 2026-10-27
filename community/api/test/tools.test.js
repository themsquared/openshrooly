import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPECIES, TOOL_PAGES } from "../../web/scripts/tools/index.js";

const PUBLIC = join(import.meta.dirname, "..", "..", "web", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");
const SITE = "https://shroomlabs.io";

test("tool pages are in the sitemap, llms files, and redirects, and linked from home and install", () => {
  const sitemap = read("sitemap.xml");
  const llms = read("llms.txt");
  const full = read("llms-full.txt");
  const redirects = read("_redirects");
  for (const t of TOOL_PAGES) {
    assert.ok(sitemap.includes(`<loc>${SITE}${t.path}</loc>`), t.slug);
    assert.ok(llms.includes(`${SITE}${t.path}`), t.slug);
    assert.ok(full.includes(`${SITE}${t.path}`), t.slug);
    assert.match(redirects, new RegExp(`^${t.path}\\.html ${t.path} 301!$`, "m"), t.slug);
    for (const f of ["index.html", "install.html", "docs.html"]) assert.ok(read(f).includes(`href="${t.path}"`), `${f} links ${t.path}`);
  }
  for (const slug of ["how-long-to-grow-mushrooms", "mushroom-grow-kit-not-growing"]) {
    for (const f of ["index.html", "install.html"]) assert.ok(read(f).includes(`href="/guides/${slug}"`), `${f} links ${slug}`);
  }
});

test("tool pages work without script: a form, a worked example, FAQ, and no inline script", () => {
  for (const t of TOOL_PAGES) {
    const html = read(`tools/${t.slug}.html`);
    assert.match(html, /<form [^>]*id="tool-form"/);
    assert.match(html, /<div id="tool-result" class="tool-result" aria-live="polite">[\s\S]*?<table/);
    assert.match(html, /"@type":"FAQPage"|"@type": "FAQPage"/);
    assert.match(html, /<script type="module" src="\/js\/tools.js"><\/script>/);
    for (const [, body] of html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) assert.equal(body.trim(), "", `${t.slug} inline script`);
    assert.doesNotMatch(html.slice(html.indexOf("<main"), html.indexOf("</main>")), /[\u2013\u2014\u2192\u2190]/, t.slug);
  }
});

test("every species page links both tools with its species preset", () => {
  for (const s of SPECIES) {
    const html = read(`profiles/${s.id}.html`);
    assert.ok(html.includes(`href="/tools/grow-timeline?species=${s.id}"`), s.id);
    assert.ok(html.includes(`href="/tools/fresh-air-planner?species=${s.id}"`), s.id);
    assert.ok(html.includes('href="/guides/how-long-to-grow-mushrooms"'), s.id);
    assert.ok(html.includes('href="/guides/mushroom-grow-kit-not-growing"'), s.id);
  }
});
