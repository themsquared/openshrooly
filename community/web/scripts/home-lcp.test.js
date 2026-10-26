import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { speciesArt } from "../public/js/species-art.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

test("only the priority card image is eager with fetchpriority=high", () => {
  const first = speciesArt("Pleurotus ostreatus", "", "Blue Oyster", "culinary", { priority: true });
  assert.match(first, /loading="eager"/);
  assert.match(first, /fetchpriority="high"/);
  assert.doesNotMatch(first, /loading="lazy"/);
  const rest = speciesArt("Pleurotus ostreatus", "", "Blue Oyster", "culinary");
  assert.match(rest, /loading="lazy"/);
  assert.doesNotMatch(rest, /fetchpriority/);
});

test("card photos offer small WebP sizes so phones skip the full JPEG", () => {
  const rest = speciesArt("Pleurotus ostreatus", "", "Blue Oyster", "culinary");
  assert.match(rest, /srcset="\/img\/species\/species-blue-oyster-640\.webp 640w, \/img\/species\/species-blue-oyster-960\.webp 960w"/);
  assert.match(rest, /sizes="\(max-width: 767px\) 100vw, 360px"/);
  assert.match(rest, /src="\/img\/species\/species-blue-oyster\.jpg"/);
  // Every culinary JPEG has both WebP sizes next to it.
  const dir = join(PUBLIC, "img", "species");
  for (const f of readdirSync(dir).filter((n) => /^species-.*\.jpg$/.test(n))) {
    for (const w of [640, 960]) assert.ok(existsSync(join(dir, f.replace(/\.jpg$/, `-${w}.webp`))), `${f} ${w}`);
  }
});

test("home grid marks only the first card as the LCP image", () => {
  const cards = readFileSync(join(PUBLIC, "js", "profile-cards.js"), "utf8");
  assert.match(cards, /speciesArt\([^)]*\{ priority: index === 0, id: p.id, linked: false \}\)/);
});

test("pack toggle buttons are 44px tap targets on phones", () => {
  const css = readFileSync(join(PUBLIC, "css", "style.css"), "utf8");
  const block = css.match(/@media \(max-width: 640px\) \{\s*\/\*[^*]*\*\/\s*\.pack-toggle[\s\S]*?\n\}/);
  assert.ok(block, "mobile pack-toggle block present");
  assert.match(block[0], /\.pack-toggle button[\s\S]*min-height: 44px/);
});
