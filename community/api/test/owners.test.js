import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_PAGES, SOURCES, TARGET_QUERIES } from "../../web/scripts/owners/index.js";

const PUBLIC = join(import.meta.dirname, "..", "..", "web", "public");
const read = (f) => readFileSync(join(PUBLIC, f), "utf8");
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const main = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
  const d = JSON.parse(m[1]);
  return d["@graph"] || [d];
});

test("owner pages lead with Shrooly in the title, H1, and description", () => {
  for (const p of OWNER_PAGES) {
    const html = read(`${p.slug}.html`);
    for (const [what, value] of [["title", p.title], ["h1", p.h1], ["description", p.description]]) {
      assert.ok(value.slice(0, 40).includes("Shrooly"), `${p.slug} ${what} leads with Shrooly: ${value}`);
    }
    assert.ok(html.includes(`<h1>${p.h1}</h1>`), p.slug);
  }
});

test("every FAQ answer is on the page, first, right under its question", () => {
  for (const p of OWNER_PAGES) {
    const html = read(`${p.slug}.html`);
    const faq = jsonLd(html).find((n) => n["@type"] === "FAQPage");
    assert.ok(faq && faq.mainEntity.length >= 4, `${p.slug} has FAQPage`);
    for (const q of faq.mainEntity) {
      const at = html.indexOf(`<h2>${q.name.replace(/'/g, "&#39;")}</h2>`);
      assert.ok(at > 0, `${p.slug} shows question ${q.name}`);
      const after = html.slice(at, at + 1500);
      const first = after.match(/<h2>[\s\S]*?<\/h2>\s*<p class="answer-first">([\s\S]*?)<\/p>/);
      assert.ok(first, `${p.slug} ${q.name} opens with an answer`);
      assert.equal(text(first[1]).trim(), q.acceptedAnswer.text.trim(), `${p.slug} ${q.name} answer matches markup`);
    }
  }
});

test("owner copy stays plain and fair: no dashes, arrows, Coach, or Off-menu", () => {
  for (const p of OWNER_PAGES) {
    const body = text(main(read(`${p.slug}.html`)));
    assert.doesNotMatch(body, /[\u2013\u2014\u2192\u2190]|->|=>/, p.slug);
    assert.doesNotMatch(body, /\bCoach\b|Off-menu|psilocybin|scam|fraud|stole|ripped off/i, p.slug);
  }
});

test("pages that talk about the company cite dated sources", () => {
  for (const p of OWNER_PAGES) {
    const html = read(`${p.slug}.html`);
    assert.ok(p.sources.length >= 3, `${p.slug} sources`);
    for (const key of p.sources) {
      assert.ok(SOURCES[key], `${p.slug} source ${key}`);
      assert.ok(html.includes(`href="${SOURCES[key].url}"`), `${p.slug} links ${key}`);
    }
    assert.match(html, /checked on October 26, 2026/i, p.slug);
  }
});

test("every owner page ends with the install button and links its siblings", () => {
  for (const p of OWNER_PAGES) {
    const body = main(read(`${p.slug}.html`));
    const last = body.lastIndexOf('href="/install">Install on your Shrooly</a>');
    assert.ok(last > body.length - 700, `${p.slug} ends with the install button`);
    for (const other of OWNER_PAGES.filter((o) => o !== p)) assert.ok(body.includes(`href="/${other.slug}"`), `${p.slug} links ${other.slug}`);
  }
});

test("owner pages are in the sitemap, llms files, and .html redirects, and linked from home, install, and docs", () => {
  const sitemap = read("sitemap.xml");
  const llms = read("llms.txt");
  const full = read("llms-full.txt");
  const redirects = read("_redirects");
  for (const p of OWNER_PAGES) {
    assert.ok(sitemap.includes(`<loc>https://shroomlabs.io/${p.slug}</loc>`), p.slug);
    assert.ok(llms.includes(`https://shroomlabs.io/${p.slug}`), p.slug);
    assert.ok(full.includes(`https://shroomlabs.io/${p.slug}`), p.slug);
    assert.match(redirects, new RegExp(`^/${p.slug}\\.html /${p.slug} 301!$`, "m"), p.slug);
    for (const f of ["index.html", "docs.html"]) assert.ok(read(f).includes(`href="/${p.slug}"`), `${f} links ${p.slug}`);
  }
  assert.ok(read("install.html").includes('href="/reuse-your-shrooly"'));
  assert.ok(read("install.html").includes('href="/what-happened-to-shrooly"'));
});

test("home puts the Shrooly owner ask above everything else", () => {
  const home = read("index.html");
  const hero = home.slice(home.indexOf('<section class="hero"'), home.indexOf("</section>", home.indexOf('<section class="hero"')));
  assert.match(hero, /<h1>Got a Shrooly\? Bring it back to life\.<\/h1>/);
  assert.match(hero, /id="get-started" href="\/install">Install on your Shrooly<\/a>/);
  assert.match(hero, /href="\/what-happened-to-shrooly">What happened to Shrooly\?<\/a>/);
});

test("the owner pages answer the questions owners search for", () => {
  const all = OWNER_PAGES.map((p) => text(main(read(`${p.slug}.html`))).toLowerCase()).join(" ");
  const words = { "no internet connection": "no internet connection", "server down": "server", offline: "offline", bricked: "bricked", firmware: "firmware", flash: "flash", refund: "refund", "customer service": "customer service", "class action": "class action", bankrupt: "bankrupt", "out of business": "out of business", "replacement app": "replacement", "can i still use my shrooly": "can i still use my shrooly" };
  assert.ok(TARGET_QUERIES.length >= 15);
  for (const [query, needle] of Object.entries(words)) assert.ok(all.includes(needle), `covers ${query}`);
});
