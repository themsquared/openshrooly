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
  isIndexableProfile,
  httpsSourceHref,
  loadProfiles,
  seoDescription,
  renderFaqPage,
  renderLightRecipe,
  renderSources,
  renderLlms,
  renderLlmsFull,
  renderHubPage,
  renderProfilePage,
  renderSitemap,
  seoTitle,
} from "../../web/scripts/generate-seo.js";

const DASH = /[\u2013\u2014]/;

test("pending community profiles never enter the sitemap or llms.txt", () => {
  const pending = { id: "pending-community", name: "Pending community", summary: "hidden" };
  assert.equal(isIndexableProfile(pending, { status: "pending", published_live: 0 }), false);
  assert.equal(isIndexableProfile(pending, { status: "rejected", published_live: 0 }), false);
  assert.equal(isIndexableProfile(pending, { status: "pending", published_live: 1 }), true);
  const sitemap = renderSitemap(loadProfiles().filter((p) => isIndexableProfile(p)));
  assert.doesNotMatch(sitemap, /pending-community/);
  assert.match(sitemap, /pearl-oyster/);
  assert.doesNotMatch(renderLlms(loadProfiles()), /pending-community/);
});

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

test("Off-menu photos use licensed files, alt text, and ImageObject credits", async () => {
  const { LICENSED_PHOTOS, photoRecordFor, creditText } = await import("../../web/public/js/species-photos.js");
  const gt = loadProfiles().find((p) => p.id === "golden-teacher");
  const html = renderProfilePage(gt);
  const photo = photoRecordFor(gt);
  assert.ok(photo);
  assert.match(html, new RegExp(`src="${photo.src}"`));
  assert.match(html, /alt="Cluster of Golden Teacher Psilocybe cubensis/);
  assert.match(html, /photo-credit/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const article = ld["@graph"].find((n) => n["@type"] === "Article");
  assert.equal(article.image["@type"], "ImageObject");
  assert.equal(article.image.creditText, creditText(photo));
  assert.equal(article.image.license, photo.licenseUrl);
  assert.ok(LICENSED_PHOTOS.every((row) => row.alt && /CC BY-SA|CC BY|CC0|Public domain/.test(row.license)));
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

test("Off-menu profiles stay out of the sitemap, llms.txt, llms-full.txt, FAQ, and hub", () => {
  const profiles = loadProfiles();
  const sitemap = renderSitemap(profiles);
  const llms = renderLlms(profiles);
  const full = renderLlmsFull(profiles);
  const faq = renderFaqPage(profiles);
  const hub = renderHubPage(profiles);
  assert.match(sitemap, /\/profiles\/pearl-oyster</);
  for (const p of profiles.filter(isOffMenu)) {
    for (const [name, text] of Object.entries({ sitemap, llms, full, faq, hub })) assert.ok(!text.includes(`/profiles/${p.id}`), `${p.id} in ${name}`);
  }
  for (const text of [llms, full, faq, hub]) {
    assert.doesNotMatch(text, /Off-menu|psilocyb|Golden Teacher/i);
    assert.doesNotMatch(text, DASH);
  }
  const gt = renderProfilePage(profiles.find((p) => p.id === "golden-teacher"));
  assert.match(gt, /<meta name="robots" content="noindex,follow">/);
});

test("free profile pages are full grow guides built only from profile data", () => {
  const profiles = loadProfiles();
  const lion = profiles.find((p) => p.id === "lions-mane");
  const html = renderProfilePage(lion, profiles);
  assert.match(html, /<title>How to grow Lion&#39;s Mane at home: temps, humidity, light by stage<\/title>|<title>How to grow Lion's Mane at home: temps, humidity, light by stage<\/title>/);
  assert.match(html, /<h1>How to grow Lion's Mane at home<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/shroomlabs\.io\/profiles\/lions-mane">/);
  for (const stage of lion.stages) {
    assert.ok(html.includes(`<th scope="row">${stage.name}</th><td>${stage.duration_days}</td><td>${stage.temperature_c} °C`), stage.id);
  }
  const fruit = lion.stages.find((s) => s.id === "fruiting");
  assert.match(html, new RegExp(`fruit at ${fruit.temperature_c} °C \\(\\d+ °F\\) and ${fruit.humidity_percent}% humidity`));
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
  const types = ld.map((n) => n["@type"]);
  assert.deepEqual(types, ["Article", "HowTo", "FAQPage", "BreadcrumbList"]);
  const faq = ld.find((n) => n["@type"] === "FAQPage");
  for (const q of faq.mainEntity) assert.ok(html.includes(q.name.replaceAll("'", "'")), q.name);
  assert.match(html, /<time datetime="\d{4}-\d\d-\d\d">/);
  assert.match(html, /href="\/grow"/);
  assert.doesNotMatch(html, /\.html"/, "no .html links on profile pages");
  assert.doesNotMatch(html, DASH);
  assert.match(html, /src="\/js\/lite\.js"/);
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

test("profile pages lead with a one-line light recipe and keep details and sources collapsed", () => {
  const profiles = loadProfiles();
  for (const profile of profiles) {
    const html = renderProfilePage(profile);
    assert.match(html, /Light recipe/);
    if (profile.pricing?.kind === "paid") {
      assert.match(html, /unlock after purchase/);
      assert.doesNotMatch(html, /white 20%|WS2812/);
      assert.match(html, />Buy for \$\d+\.\d\d</);
      assert.doesNotMatch(html, /example/i);
      continue;
    }
    const section = html.slice(html.indexOf('class="light-recipe"'), html.indexOf("</section>", html.indexOf('class="light-recipe"')));
    // The first line is plain words; nm and WS2812 talk only inside the collapsed details.
    const firstLine = section.slice(0, section.indexOf("<details"));
    assert.match(firstLine, /h a day|grows in the dark/);
    assert.doesNotMatch(firstLine, /WS2812|nm\b|RGB/);
    assert.match(section, /<details class="light-details">[\s\S]*465 to 475 nm/);
    const fruit = profile.light_recipe.phases.fruiting;
    if (fruit) assert.match(html, new RegExp(`${fruit.photoperiod_hours} h on`));
    // Sources sit at the end of the article, collapsed.
    const sources = html.indexOf('<details class="sources-block">');
    assert.ok(sources > html.indexOf('class="actions"'), profile.id);
    assert.ok(profile.light_recipe.sources.some((note) => html.slice(sources).includes(note.title)));
  }
});

test("light recipe source links drop javascript, data, and http hrefs", () => {
  const pearl = structuredClone(loadProfiles().find((p) => p.id === "pearl-oyster"));
  assert.equal(httpsSourceHref("https://doi.org/10.1111/j.1751-1097.1987.tb07888.x"), "https://doi.org/10.1111/j.1751-1097.1987.tb07888.x");
  for (const badUrl of ["javascript:alert(1)", "data:text/html,hi", "http://example.com/paper"]) {
    assert.equal(httpsSourceHref(badUrl), "");
    pearl.light_recipe.sources = [{ title: "Bad link", detail: "Must not be clickable.", url: badUrl }];
    const html = renderSources(pearl);
    assert.doesNotMatch(html, /href="/);
    assert.match(html, /Bad link/);
  }
});

test("FAQ answers read plainly", () => {
  const text = FAQ.map((f) => `${f.q} ${f.a}`).join("\n");
  assert.doesNotMatch(text, /\bFAE\b|\bRH\b|setpoint|fully indexed|learns one chamber|photo checks (are )?included/i);
  const lion = FAQ.find((f) => /lion's mane/i.test(f.q));
  const fruiting = loadProfiles().find((p) => p.id === "lions-mane").stages.find((s) => s.id === "fruiting");
  assert.match(lion.a, new RegExp(`${fruiting.temperature_c} °C and ${fruiting.humidity_percent}% humidity`));
  // Grow Coach is a private beta. Public FAQ copy never names or prices it.
  assert.doesNotMatch(text, /Grow Coach|3\.99/);
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
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profiles/lions-mane"), "lions-mane");
  assert.equal(profileIdFromUrl("https://shroomlabs.io/profile?id=new-oyster"), "new-oyster");
});

test("deploy regenerates static profile pages so new built-in profiles get one", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../web/package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.deploy, /generate-seo\.js[\s\S]*netlify-cli deploy/);
  const toml = readFileSync(new URL("../../web/netlify.toml", import.meta.url), "utf8");
  assert.match(toml, /command = "[^"]*generate-seo\.js/);
});
