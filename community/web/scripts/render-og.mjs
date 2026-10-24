#!/usr/bin/env node
/** Render public/og/<id>.jpg social cards (1200x630) from renderOgHtml with local Chrome. Run after profile copy changes. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { loadProfiles, renderOgHtml } from "./generate-seo.js";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "og");
const fontBase = pathToFileURL(join(ROOT, "public", "fonts")).href;

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "og-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  const cards = [["default", null], ...loadProfiles().map((p) => [p.id, p])];
  for (const [id, profile] of cards) {
    const file = join(work, `${id}.html`);
    writeFileSync(file, renderOgHtml(profile, fontBase));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${id}.jpg`), type: "jpeg", quality: 85 });
  }
  console.log(`rendered ${cards.length} OG cards`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
