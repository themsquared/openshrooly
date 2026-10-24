import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfiles, profileJsonLd, renderProfilePage } from "./generate-seo.js";
import { speciesArt, speciesPhoto } from "../public/js/species-art.js";
import {
  ALLOWED_LICENSES,
  LICENSED_PHOTOS,
  creditText,
  licenseFamily,
  photoRecordFor,
} from "../public/js/species-photos.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "..", "public");
const ATTRIBUTION = join(PUBLIC, "img", "species", "ATTRIBUTION.md");
const DASH = /[\u2013\u2014]/;

function publicPath(src) {
  return join(PUBLIC, src.replace(/^\//, ""));
}

test("every licensed photo exists, has alt text, and an allowed license", () => {
  assert.ok(LICENSED_PHOTOS.length >= 1);
  const credits = readFileSync(ATTRIBUTION, "utf8");
  assert.doesNotMatch(credits, DASH);
  for (const photo of LICENSED_PHOTOS) {
    assert.ok(existsSync(publicPath(photo.src)), photo.src);
    assert.ok(existsSync(publicPath(photo.src640)), photo.src640);
    assert.ok(existsSync(publicPath(photo.og)), photo.og);
    assert.ok(photo.alt && photo.alt.length > 12, `${photo.id} alt`);
    assert.match(photo.alt, /Psilocybe|fruiting/i);
    assert.ok(ALLOWED_LICENSES.has(licenseFamily(photo.license)), `${photo.id} license ${photo.license}`);
    assert.doesNotMatch(photo.license, /nc|nd/i);
    assert.match(photo.licenseUrl, /^https:\/\/creativecommons\.org\//);
    assert.match(photo.sourcePage, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(photo.author);
    assert.ok(photo.changes);
    assert.match(credits, new RegExp(photo.author.replace("ä", "ä")));
    assert.ok(credits.includes(photo.sourcePage), `${photo.id} source page in ATTRIBUTION`);
    assert.ok(credits.includes(photo.license), `${photo.id} license in ATTRIBUTION`);
    const html = renderLicensedMarkup(photo);
    assert.match(html, /alt="/);
    assert.match(html, /srcset="/);
    assert.match(html, /width="/);
    assert.match(html, /height="/);
    assert.match(html, /loading="/);
    assert.match(html, /photo-credit/);
    assert.doesNotMatch(html, DASH);
  }
});

function renderLicensedMarkup(photo) {
  return speciesArt("", "", "", "psilocybin", { id: photo.id });
}

test("Off-menu pages with a photo render credit, ImageObject, and existing og:image path", () => {
  const profiles = loadProfiles().filter((p) => p.pack === "psilocybin");
  assert.deepEqual(
    profiles.map((p) => p.id).sort(),
    ["b-plus", "golden-teacher", "p-cyanescens", "p-natalensis", "penis-envy"]
  );
  for (const profile of profiles) {
    const photo = photoRecordFor(profile);
    const html = renderProfilePage(profile);
    const ld = profileJsonLd(profile);
    const article = ld["@graph"].find((n) => n["@type"] === "Article");
    if (!photo) {
      assert.equal(speciesPhoto(profile.species, profile.strain, profile.name, profile.pack, profile.id), "");
      assert.doesNotMatch(html, /species-photo|img\/species\/.*\.(webp|jpg|svg)/);
      assert.equal(article.image, `https://shroomlabs.io/og/${profile.id}.jpg`);
      continue;
    }
    assert.match(html, new RegExp(`src="${photo.src}"`));
    assert.match(html, new RegExp(`alt="${photo.alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(html, /srcset="/);
    assert.match(html, /loading="eager"/);
    assert.match(html, new RegExp(`Photo: <a href="${photo.sourcePage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    assert.match(html, new RegExp(photo.author));
    assert.match(html, new RegExp(photo.licenseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /legal-prominent/);
    assert.doesNotMatch(html, /Restricted|Grow Coach|affiliate/i);
    assert.equal(article.image["@type"], "ImageObject");
    assert.equal(article.image.license, photo.licenseUrl);
    assert.equal(article.image.creditText, creditText(photo));
    assert.equal(article.image.creator.name, photo.author);
    assert.match(html, new RegExp(`og:image" content="https://shroomlabs.io/og/${profile.id}\\.jpg"`));
  }
});

test("referenced profile images exist on disk and have alt text", () => {
  const profiles = loadProfiles();
  const srcs = new Set();
  for (const profile of profiles) {
    const html = renderProfilePage(profile);
    for (const match of html.matchAll(/<img\b([^>]+)>/g)) {
      const tag = match[1];
      assert.match(tag, /\balt="[^"]+"/, `${profile.id} img missing alt`);
      const src = tag.match(/\bsrc="([^"]+)"/)[1];
      srcs.add(src);
      assert.ok(existsSync(publicPath(src)), `${profile.id} missing ${src}`);
    }
  }
  assert.ok(srcs.size >= 10);
});

test("culinary harvest shots stay on the generated JPEG path", () => {
  const first = speciesArt("Pleurotus ostreatus", "", "Blue Oyster", "culinary", { priority: true });
  assert.match(first, /species-oyster\.jpg|species-blue-oyster\.jpg/);
  assert.doesNotMatch(first, /species-photo|figcaption/);
  assert.equal(speciesArt("Psilocybe cubensis", "Penis Envy", "Penis Envy", "psilocybin", { id: "penis-envy" }), "");
});
