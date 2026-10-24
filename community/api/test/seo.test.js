import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { isOffMenu, packLabel, PSI_LEGAL_NOTICE, PSI_RESOURCES, PSI_SPORE_LAW, seoDescription, seoTitle } from "../src/pack.js";
import { loadProfiles, renderFaq, renderLlms, renderProfilePage, renderSitemap } from "../../web/scripts/generate-seo.js";

function env() {
  return {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    OIDC_STUB: "1",
  };
}

async function call(ctx, method, path) {
  const request = new Request(`http://test${path}`, { method, headers: { "content-type": "application/json" } });
  const res = await handleRequest(request, ctx);
  return { status: res.status, data: await res.json() };
}

test("visitor label is Off-menu and pages stay indexable", () => {
  const gt = { id: "golden-teacher", name: "Golden Teacher", species: "Psilocybe cubensis", pack: "psilocybin", summary: "Common cubensis strain." };
  assert.equal(packLabel("psilocybin"), "Off-menu");
  assert.equal(isOffMenu(gt), true);
  assert.match(seoTitle(gt), /Off-menu/);
  assert.doesNotMatch(seoTitle(gt), /Restricted/i);
  assert.match(seoDescription(gt), /illegal to grow/);
  assert.match(seoDescription(gt), /does not sell spores/);
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
  assert.match(html, /do not endorse/);
  assert.match(html, new RegExp(PSI_SPORE_LAW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /Restricted/i);
  assert.doesNotMatch(html, /Grow Coach/);
  assert.doesNotMatch(html, /[?&](ref|aff|affiliate|utm_)/i);
  for (const resource of PSI_RESOURCES) {
    assert.equal(new URL(resource.url).search, "", `${resource.name} must be a clean outbound URL`);
  }
});

test("sitemap, llms.txt, and FAQ index Off-menu profiles", () => {
  const profiles = loadProfiles();
  const sitemap = renderSitemap(profiles);
  const llms = renderLlms(profiles);
  const faq = renderFaq(profiles);
  assert.match(sitemap, /\/profiles\/golden-teacher\.html/);
  assert.match(sitemap, /\/profiles\/pearl-oyster\.html/);
  assert.match(llms, /## Off-menu/);
  assert.match(llms, /golden-teacher/);
  assert.match(llms, /illegal to grow/);
  assert.match(llms, /pnwspore\.com/);
  assert.doesNotMatch(llms, /Restricted/i);
  assert.match(faq, /golden-teacher/);
  assert.match(faq, /off the printed menu/);
});

test("API Off-menu detail is free, labeled, and resource-only", async () => {
  const ctx = env();
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
