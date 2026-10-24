import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS } from "../../web/public/js/chrome.js";
import { isPsi, loadProfiles, renderLlms, renderProfilePage, renderSitemap, writeSeoFiles } from "../../web/scripts/generate-seo.js";

const PUBLIC = join(import.meta.dirname, "../../web/public");

test("every public page has shared nav, title, and description", () => {
  writeSeoFiles(PUBLIC);
  const pages = [
    "index.html",
    "faq.html",
    "docs.html",
    "install.html",
    "coach.html",
    "claim.html",
    "login.html",
    "register.html",
    "account.html",
    "publish.html",
    "profile.html",
  ];
  const labels = NAV_ITEMS.map((item) => item.label);
  for (const file of pages) {
    const html = readFileSync(join(PUBLIC, file), "utf8");
    assert.match(html, /<title>.+<\/title>/, `${file} needs a title`);
    assert.match(html, /<meta name="description" content="[^"]+"/, `${file} needs a description`);
    assert.match(html, /data-chrome="header"/, `${file} needs shared header`);
    assert.match(html, /data-chrome="footer"/, `${file} needs shared footer`);
    const header = html.slice(html.indexOf("data-chrome=\"header\""), html.indexOf("</header>"));
    let last = -1;
    for (const label of labels) {
      const at = header.indexOf(label);
      assert.ok(at > last, `${file} nav missing ${label} in order`);
      last = at;
    }
    assert.doesNotMatch(header, /Restricted|psilocybin|Off-menu/i);
    assert.match(html, /off the printed menu/);
  }
});

test("all profiles are indexed, including Off-menu", () => {
  const profiles = loadProfiles();
  const sitemap = renderSitemap(profiles);
  const llms = renderLlms(profiles);
  assert.ok(profiles.some(isPsi));
  for (const profile of profiles) {
    assert.match(sitemap, new RegExp(`/profiles/${profile.id}\\.html`));
    assert.match(llms, new RegExp(profile.id));
    const html = renderProfilePage(profile);
    assert.match(html, /index,follow/);
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /HowTo/);
    assert.match(html, /<h1>/);
  }
});

test("generated culinary and Off-menu HTML files exist", () => {
  const files = readdirSync(join(PUBLIC, "profiles"));
  assert.ok(files.includes("pearl-oyster.html"));
  assert.ok(files.includes("golden-teacher.html"));
  const gt = readFileSync(join(PUBLIC, "profiles", "golden-teacher.html"), "utf8");
  assert.match(gt, /index,follow/);
  assert.match(gt, /Grow parameters/);
});
