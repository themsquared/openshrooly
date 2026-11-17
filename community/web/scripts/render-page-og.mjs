#!/usr/bin/env node
/**
 * Render public/og/pages/<slug>.jpg (1200x630) for guides, owner pages, chamber pages and tools with local Chrome.
 * Default: only pages without a card. Pass --all to re-render every card. Run generate-seo.js afterwards.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { pageOgCards, renderPageOgHtml } from "./generate-seo.js";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "og", "pages");
const fontBase = pathToFileURL(join(ROOT, "public", "fonts")).href;
const all = process.argv.includes("--all");

mkdirSync(OUT, { recursive: true });
const cards = pageOgCards();
const slugs = new Set(cards.map((c) => c.slug));
if (slugs.size !== cards.length) throw new Error("two pages share a slug, so their social cards would collide");
const todo = cards.filter((c) => all || !existsSync(join(OUT, `${c.slug}.jpg`)));
if (!todo.length) {
  console.log("page OG cards up to date");
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "page-og-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  for (const card of todo) {
    const file = join(work, `${card.slug}.html`);
    writeFileSync(file, renderPageOgHtml(card, fontBase));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${card.slug}.jpg`), type: "jpeg", quality: 85 });
  }
  console.log(`rendered ${todo.length} page OG card(s)`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
