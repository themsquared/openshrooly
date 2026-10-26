import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDES } from "../../web/scripts/guides/index.js";
import { FREE_IDS } from "../../web/scripts/guides/data.js";

const PUBLIC = join(import.meta.dirname, "../../web/public");
const page = (slug) => readFileSync(join(PUBLIC, "guides", `${slug}.html`), "utf8");
const text = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
const main = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const graph = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];

test("every guide answers first, dates itself, and has a real FAQ", () => {
  assert.ok(GUIDES.length >= 3);
  for (const g of GUIDES) {
    const html = page(g.slug);
    const body = text(main(html));
    assert.ok(g.answer.length >= 120 && g.answer.length <= 600, `${g.slug} answer length`);
    assert.ok(body.indexOf(g.answer.slice(0, 60)) < body.indexOf(g.sections[0].h2.slice(0, 20)), `${g.slug} answer comes first`);
    assert.match(body, /Updated \d{4}-\d{2}-\d{2}/, g.slug);
    assert.ok(g.faq.length >= 3, `${g.slug} has at least three FAQ`);
    assert.ok(g.sections.filter((s) => s.h2.endsWith("?")).length >= 3, `${g.slug} uses question headings`);
    assert.ok(body.split(" ").length >= 600, `${g.slug} is not thin`);
  }
});

test("guide FAQPage schema matches the visible FAQ, and Article has a date", () => {
  for (const g of GUIDES) {
    const html = page(g.slug);
    const nodes = graph(html);
    const faq = nodes.find((n) => n["@type"] === "FAQPage");
    const article = nodes.find((n) => n["@type"] === "Article");
    assert.ok(article?.dateModified, `${g.slug} Article dateModified`);
    assert.ok(nodes.some((n) => n["@type"] === "BreadcrumbList"), `${g.slug} breadcrumbs`);
    assert.deepEqual(faq.mainEntity.map((q) => q.name), g.faq.map((f) => f.q));
    const body = text(main(html));
    for (const q of faq.mainEntity) assert.ok(body.includes(q.acceptedAnswer.text.slice(0, 80)), `${g.slug}: ${q.name}`);
    assert.ok(!nodes.some((n) => /Review|AggregateRating|Product/.test(n["@type"])), `${g.slug} has no review or product schema`);
  }
});

test("guide copy stays plain: no dashes, arrows, jargon, or Coach", () => {
  const banned = [/[\u2013\u2014\u2192\u21d2]/, /\bFAE\b/, /\bRH\b/, /setpoint/i, /fully indexed/i, /\bCoach\b/, /guaranteed?/i, /\bbest[- ]in[- ]class\b/i, /(?<!Open)Shrooly (?!(chambers?|devices?)\b)/];
  for (const g of GUIDES) {
    const body = text(main(page(g.slug)));
    for (const re of banned) assert.doesNotMatch(body, re, `${g.slug} ${re}`);
  }
});

test("guide links resolve: profiles are free and indexed, guides exist, partners are disclosed", () => {
  const indexed = new Set(FREE_IDS);
  for (const g of GUIDES) {
    const html = main(page(g.slug));
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith("http")) {
        assert.match(href, /^https:\/\/(northspore\.com|pnwspore\.com)\//, `${g.slug} external ${href}`);
        continue;
      }
      assert.doesNotMatch(href, /\.html/, `${g.slug} ${href}`);
      const profile = href.match(/^\/profiles\/([a-z0-9-]+)$/);
      if (profile) assert.ok(indexed.has(profile[1]), `${g.slug} links free profile ${href}`);
      else if (href.startsWith("/guides/")) assert.ok(existsSync(join(PUBLIC, `${href}.html`)), `${g.slug} ${href}`);
      else assert.ok(["/", "/grow"].includes(href), `${g.slug} ${href}`);
    }
    if (/northspore|pnwspore/.test(html)) assert.match(text(html), /affiliate links/, `${g.slug} discloses partners`);
    assert.ok(/href="\/profiles\//.test(html) || /href="\/grow"/.test(html), `${g.slug} links to profiles`);
  }
});

test("guides are in the sitemap, llms.txt, llms-full.txt, the hub, and redirect from .html", () => {
  const sitemap = readFileSync(join(PUBLIC, "sitemap.xml"), "utf8");
  const llms = readFileSync(join(PUBLIC, "llms.txt"), "utf8");
  const full = readFileSync(join(PUBLIC, "llms-full.txt"), "utf8");
  const hub = readFileSync(join(PUBLIC, "grow.html"), "utf8");
  const redirects = readFileSync(join(PUBLIC, "_redirects"), "utf8");
  for (const g of GUIDES) {
    const url = `https://shroomlabs.io/guides/${g.slug}`;
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), g.slug);
    assert.ok(llms.includes(url) && full.includes(url), g.slug);
    assert.ok(hub.includes(`href="/guides/${g.slug}"`), g.slug);
    assert.ok(redirects.includes(`/guides/${g.slug}.html /guides/${g.slug} 301!`), g.slug);
  }
});

test("only culinary partners are called partners or affiliates", () => {
  for (const g of GUIDES) {
    const html = main(page(g.slug));
    for (const sentence of text(html).split(/(?<=\.)\s+/)) {
      if (/PNW Spore/.test(sentence)) assert.doesNotMatch(sentence, /partner|affiliate|commission|we work with/i, `${g.slug}: ${sentence}`);
    }
  }
});

test("llms files never call PNW Spore a partner", () => {
  for (const f of ["llms.txt", "llms-full.txt"]) {
    for (const line of readFileSync(join(PUBLIC, f), "utf8").split("\n")) {
      if (/PNW Spore/.test(line)) assert.doesNotMatch(line, /partner|affiliate|we work with/i, `${f}: ${line}`);
    }
  }
});
