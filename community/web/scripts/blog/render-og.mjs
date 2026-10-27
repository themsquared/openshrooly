#!/usr/bin/env node
/**
 * Render public/og/blog/<slug>.jpg (1200x630) for blog posts with local Chrome.
 * Default: only posts without a card. Pass --all to re-render every card.
 * Run `node scripts/generate-seo.js` afterwards so posts pick up their card.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { loadPosts, renderBlogOgHtml } from "./index.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "og", "blog");
const fontBase = pathToFileURL(join(ROOT, "public", "fonts")).href;
const all = process.argv.includes("--all");

mkdirSync(OUT, { recursive: true });
const todo = loadPosts().filter((p) => all || !existsSync(join(OUT, `${p.slug}.jpg`)));
if (!todo.length) {
  console.log("blog OG cards up to date");
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "blog-og-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  for (const post of todo) {
    const file = join(work, `${post.slug}.html`);
    writeFileSync(file, renderBlogOgHtml(post, fontBase, "shroomlabs.io/blog"));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${post.slug}.jpg`), type: "jpeg", quality: 85 });
  }
  console.log(`rendered ${todo.length} blog OG card(s)`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
