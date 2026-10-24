import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS, POSITIONING } from "../../web/public/js/chrome.js";
import { isPsi, loadProfiles, renderLlms, renderProfilePage, renderSitemap, writeSeoFiles } from "../../web/scripts/generate-seo.js";

const PUBLIC = join(import.meta.dirname, "../../web/public");

test("every public page has shared nav, title, and description", () => {
  writeSeoFiles(PUBLIC);
  const pages = [
    "index.html",
    "faq.html",
    "docs.html",
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
    assert.match(header, /Sign in/, `${file} needs a static Sign in link`);
    assert.match(header, new RegExp(POSITIONING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("generated profile pages share the homepage header lockup and nav", () => {
  writeSeoFiles(PUBLIC);
  const home = readFileSync(join(PUBLIC, "index.html"), "utf8");
  const profile = readFileSync(join(PUBLIC, "profiles", "golden-teacher.html"), "utf8");
  for (const [name, html] of [
    ["index.html", home],
    ["profiles/golden-teacher.html", profile],
  ]) {
    const header = html.slice(html.indexOf('data-chrome="header"'), html.indexOf("</header>"));
    for (const label of NAV_ITEMS.map((item) => item.label)) {
      assert.match(header, new RegExp(label), `${name} missing ${label}`);
    }
    assert.match(header, /Sign in/);
    assert.match(header, /Works with Shrooly devices running OpenShrooly/);
    assert.doesNotMatch(header, />Catalog</);
    assert.doesNotMatch(html, /Works with OpenShrooly<\/small>/);
  }
});

test("public visitor files do not use en or em dashes", () => {
  writeSeoFiles(PUBLIC);
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(html|js|css|txt|xml|svg|json)$/i.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      if (/[\u2013\u2014]/.test(text)) hits.push(path.slice(PUBLIC.length + 1));
    }
  };
  walk(PUBLIC);
  assert.deepEqual(hits, [], `U+2013 or U+2014 in ${hits.join(", ")}`);
});

test("public visitor copy does not mention Mike or missing keys", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(html|js)$/i.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      if (/\bMike\b|missing keys|AUTH\.md/i.test(text)) hits.push(path.slice(PUBLIC.length + 1));
    }
  };
  walk(PUBLIC);
  assert.deepEqual(hits, [], `internal copy leaked in ${hits.join(", ")}`);
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
