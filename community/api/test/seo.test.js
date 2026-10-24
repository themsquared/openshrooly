import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { call, testEnv } from "./helpers.js";
import {
  isOffMenu,
  packLabel,
  PSI_LEGAL_NOTICE,
  PSI_RESOURCES,
  PSI_SPORE_LAW,
} from "../src/pack.js";
import {
  FAQ,
  loadProfiles,
  seoDescription,
  renderFaqPage,
  renderLlms,
  renderProfilePage,
  renderSitemap,
  seoTitle,
} from "../../web/scripts/generate-seo.js";

const DASH = /[\u2013\u2014]/;

test("visitor label is Off-menu and pages stay indexable", () => {
  const gt = loadProfiles().find((p) => p.id === "golden-teacher");
  assert.equal(packLabel("psilocybin"), "Off-menu");
  assert.equal(isOffMenu(gt), true);
  assert.equal(seoTitle(gt), "Golden Teacher (Psilocybe cubensis) grow profile · Shroom Labs");
  assert.doesNotMatch(seoTitle(gt), /Restricted/i);
  assert.doesNotMatch(seoDescription(gt), DASH);
  assert.equal(gt.legal_notice, PSI_LEGAL_NOTICE, "data legal notice matches the shared constant");
});

test("API and web ship the same pack.js", () => {
  const api = readFileSync(new URL("../src/pack.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../web/public/js/pack.js", import.meta.url), "utf8");
  assert.equal(web, api);
});

test("research links are plain third-party links without tracking", () => {
  const hosts = PSI_RESOURCES.map((r) => new URL(r.url).host);
  assert.deepEqual(hosts, ["pnwspore.com", "sporeworks.com", "nida.nih.gov", "www.hopkinspsychedelic.org"]);
  for (const r of PSI_RESOURCES) {
    const url = new URL(r.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.search, "", `${r.name} has no query string`);
    assert.equal(url.hash, "");
    assert.doesNotMatch(r.note, /\$|price|discount|coupon/i, `${r.name} note has no prices`);
  }
});

test("generated Off-menu HTML carries legal notice, microscopy, and no commerce", () => {
  const profiles = loadProfiles();
  const gt = profiles.find((p) => p.id === "golden-teacher");
  assert.ok(gt);
  const html = renderProfilePage(gt);
  const legalAt = html.indexOf(PSI_LEGAL_NOTICE);
  const paramsAt = html.indexOf("Grow parameters");
  const microAt = html.indexOf("Microscopy and research resources");
  assert.ok(legalAt > 0 && paramsAt > legalAt, "legal notice sits above grow parameters");
  assert.ok(microAt > paramsAt, "microscopy section follows grow parameters");
  assert.match(html, /rel="nofollow noopener"/);
  assert.match(html, /https:\/\/pnwspore\.com\//);
  assert.match(html, /https:\/\/sporeworks\.com\//);
  assert.match(html, /https:\/\/www\.hopkinspsychedelic\.org\/publications/);
  assert.match(html, /https:\/\/nida\.nih\.gov\/research-topics\/psilocybin-magic-mushrooms/);
  assert.doesNotMatch(html, /Shrooly setpoints|setpoint/i);
  assert.match(html, /Reference conditions for research and education only/);
  assert.match(html, /do not endorse/);
  assert.match(html, new RegExp(PSI_SPORE_LAW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const article = html.slice(html.indexOf("<article"), html.indexOf("</article>"));
  assert.doesNotMatch(html, /Restricted/i);
  assert.doesNotMatch(article, /Grow Coach/);
  assert.doesNotMatch(html, /[?&](ref|aff|affiliate|utm_)/i);
  assert.doesNotMatch(article, DASH);
  for (const resource of PSI_RESOURCES) {
    assert.equal(new URL(resource.url).search, "", `${resource.name} must be a clean outbound URL`);
  }
});

test("sitemap, llms.txt, and FAQ index Off-menu profiles", () => {
  const profiles = loadProfiles();
  const sitemap = renderSitemap(profiles);
  const llms = renderLlms(profiles);
  const faq = renderFaqPage(profiles);
  assert.match(sitemap, /\/profiles\/golden-teacher\.html/);
  assert.match(sitemap, /\/profiles\/pearl-oyster\.html/);
  assert.match(llms, /## Off-menu/);
  assert.match(llms, /golden-teacher/);
  assert.match(llms, /illegal to grow/);
  assert.match(llms, /pnwspore\.com/);
  assert.doesNotMatch(llms, /Restricted/i);
  assert.doesNotMatch(llms, DASH);
  assert.match(faq, /golden-teacher/);
  assert.match(faq, /off the printed menu/);
  assert.doesNotMatch(faq, DASH);
});

test("API Off-menu detail is free, labeled, and resource-only", async () => {
  const ctx = testEnv();
  const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.ok(culinary.data.every((p) => p.pack === "culinary"));
  assert.ok(!culinary.data.some((p) => p.id === "golden-teacher"));
  const list = await call(ctx, "GET", "/api/profiles?pack=psilocybin");
  const card = list.data.find((p) => p.id === "golden-teacher");
  assert.equal(card.pack_label, "Off-menu");
  const detail = await call(ctx, "GET", "/api/profiles/golden-teacher");
  assert.equal(detail.status, 200);
  assert.equal(detail.data.unlocked, true);
  assert.equal(detail.data.profile.pack_label, "Off-menu");
  assert.equal(detail.data.profile.legal_notice, PSI_LEGAL_NOTICE);
  assert.deepEqual(detail.data.links, []);
  assert.equal(detail.data.disclosure, "");
  assert.equal(detail.data.resources.links[0].url, "https://pnwspore.com/");
  assert.match(detail.data.resources.disclaimer, /do not endorse/);
  assert.match(detail.data.resources.spore_law, /microscopy only/);
});

test("built-in profiles are served from the bundled seeds, not stale D1 text", async () => {
  const ctx = testEnv();
  const seed = loadProfiles().find((p) => p.id === "lions-mane");
  const ts = new Date().toISOString();
  await ctx.db.run(
    "INSERT OR IGNORE INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ["lions-mane", JSON.stringify({ ...seed, summary: "Moderate FAE, high RH." }), null, ts, ts]
  );
  const detail = await call(ctx, "GET", "/api/profiles/lions-mane");
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.data.profile.summary, /\bFAE\b|\bRH\b/);
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.doesNotMatch(list.data.find((p) => p.id === "lions-mane").summary, /\bFAE\b|\bRH\b/);
});

test("profile pages show the light recipe, wavelength note, and at least one source", () => {
  const profiles = loadProfiles();
  for (const profile of profiles) {
    const html = renderProfilePage(profile);
    assert.match(html, /Light recipe/);
    assert.match(html, /465 to 475 nm/);
    assert.match(html, /RGB mix is an approximation/);
    if (profile.pricing?.kind === "paid") {
      assert.match(html, /unlock after purchase/);
      assert.doesNotMatch(html, /white 20%/);
      continue;
    }
    assert.match(html, /Recipe sources/);
    const fruit = profile.light_recipe.phases.fruiting;
    assert.match(html, new RegExp(`${fruit.photoperiod_hours} h on`));
    assert.ok(profile.light_recipe.sources.some((note) => html.includes(note.title)));
  }
});

test("FAQ answers read plainly", () => {
  const text = FAQ.map((f) => `${f.q} ${f.a}`).join("\n");
  assert.doesNotMatch(text, /\bFAE\b|\bRH\b|setpoint|fully indexed|learns one chamber|photo checks (are )?included/i);
  const lion = FAQ.find((f) => /lion's mane/i.test(f.q));
  const fruiting = loadProfiles().find((p) => p.id === "lions-mane").stages.find((s) => s.id === "fruiting");
  assert.match(lion.a, new RegExp(`${fruiting.temperature_c} °C and ${fruiting.humidity_percent}% humidity`));
  assert.match(FAQ.find((f) => /Grow Coach/.test(f.q)).a, /coming soon/i);
});

test("visible site copy has no grower jargon or promises the product cannot keep", async () => {
  const { readdirSync } = await import("node:fs");
  const root = new URL("../../web/public/", import.meta.url);
  const pages = [
    ...readdirSync(root).filter((f) => f.endsWith(".html")),
    ...readdirSync(new URL("profiles/", root)).map((f) => `profiles/${f}`),
  ];
  for (const page of pages) {
    const html = readFileSync(new URL(page, root), "utf8");
    const visible = html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ");
    const meta = [...html.matchAll(/<meta [^>]*content="([^"]*)"/g)].map((m) => m[1]).join(" ");
    const text = `${visible} ${meta}`;
    assert.doesNotMatch(text, /\bFAE\b|\bRH\b|setpoint|Shrooly setpoints|fully indexed/i, `${page} jargon`);
    assert.doesNotMatch(text, /learns (one|each|your) chamber|photo checks (and [a-z ]+ )?included|flags? mold/i, `${page} overpromises`);
  }
  const llms = readFileSync(new URL("llms.txt", root), "utf8");
  assert.doesNotMatch(llms, /\bFAE\b|\bRH\b|setpoint/i);
});

test("profile pages without a static file still resolve through the /profiles/:id fallback", async () => {
  const { profileIdFromUrl } = await import("../src/pack.js");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profile.html?id=new-oyster.html"), "new-oyster");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profile.html?id=new-oyster"), "new-oyster");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profiles/lions-mane.html"), "lions-mane");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profiles/a%20b.html"), "a b");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profiles/%E0%A4%A.html"), "%E0%A4%A");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profile.html"), "");
});

test("deploy regenerates static profile pages so new built-in profiles get one", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../web/package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.deploy, /generate-seo\.js[\s\S]*netlify-cli deploy/);
  const toml = readFileSync(new URL("../../web/netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /command = "[^"]*generate-seo\.js/);
});
