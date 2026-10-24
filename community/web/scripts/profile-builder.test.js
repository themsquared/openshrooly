import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blankProfile,
  canCloneFull,
  cloneProfile,
  collectProfileIssues,
  detectsRestrictedTaxon,
  exportProfileDocument,
  isHttpsSourceUrl,
  isStageId,
  parseProfileDocument,
  publishReadyIssues,
  redactLockedProfile,
  slugify,
  syncStageLightFromRecipe,
  validateProfile,
  cToF,
  fToC,
} from "../public/js/profile-schema.js";
import { validateProfile as apiValidate } from "../../api/src/profile.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function seeds() {
  return ["culinary", "psilocybin"].flatMap((pack) =>
    readdirSync(join(root, "data/profiles", pack))
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(root, "data/profiles", pack, name), "utf8")))
  );
}

test("web and api ship the same profile schema module", () => {
  const api = readFileSync(new URL("../../api/src/profile-schema.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../public/js/profile-schema.js", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../../hub/static/builder/profile-schema.js", import.meta.url), "utf8");
  assert.equal(web, api);
  assert.equal(hub, api);
});

test("builder copies match and stage ids are written with setAttribute", async () => {
  const web = readFileSync(new URL("../public/js/profile-builder.js", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../../hub/static/builder/profile-builder.js", import.meta.url), "utf8");
  assert.equal(hub, web);
  globalThis.HTMLElement = class {};
  globalThis.customElements = { get() { return undefined; }, define() {} };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  class FakeNode {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.attrs = {};
      this.children = [];
      this.className = "";
      this.dataset = {};
      this.style = {};
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    addEventListener() {}
  }
  globalThis.document = {
    createElement(tag) {
      return new FakeNode(tag);
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
  };
  const { h } = await import("../public/js/profile-builder.js");
  const evil = `fruiting"><img src=x onerror=alert(1)>`;
  const node = h("button", { id: `tab-${evil}`, "aria-controls": `panel-${evil}` }, evil);
  assert.equal(node.attrs.id, `tab-${evil}`);
  assert.equal(node.attrs["aria-controls"], `panel-${evil}`);
  assert.equal(node.children[0].textContent, evil);
  assert.equal(Object.keys(node.attrs).join(","), "id,aria-controls");
});

test("every built-in profile round-trips through the builder schema", () => {
  const profiles = seeds();
  assert.ok(profiles.length >= 26);
  for (const profile of profiles) {
    assert.deepEqual(collectProfileIssues(profile), [], profile.id);
    const exported = exportProfileDocument(profile);
    const parsed = parseProfileDocument(exported);
    const synced = syncStageLightFromRecipe(parsed);
    validateProfile(synced);
    apiValidate(synced);
    const cloned = cloneProfile(profile, { id: `${profile.id}-copy`, name: `${profile.name} copy` });
    if (canCloneFull(profile, { unlocked: true })) {
      assert.equal(cloned.stages.length, profile.stages.length, profile.id);
      assert.equal(cloned.light_recipe.phases.fruiting.photoperiod_hours, profile.light_recipe.phases.fruiting.photoperiod_hours);
    }
    validateProfile(cloned);
  }
});

test("paid profiles do not leak setpoints into a locked clone", () => {
  const paid = seeds().find((p) => p.pricing?.kind === "paid");
  assert.ok(paid);
  const redacted = redactLockedProfile(paid);
  assert.equal(redacted.locked, true);
  assert.equal(redacted.stages[0].temperature_c, undefined);
  assert.equal(canCloneFull(redacted), false);
  const cloned = cloneProfile(redacted, { id: "paid-shell", name: "Paid shell" });
  assert.notEqual(cloned.light_recipe.why, paid.light_recipe.why);
  validateProfile(cloned);
});

test("blank culinary and off-menu profiles validate after fill", () => {
  const culinary = blankProfile({ id: "test-oyster", name: "Test oyster", pack: "culinary" });
  culinary.species = "Pleurotus ostreatus";
  assert.deepEqual(collectProfileIssues(culinary), []);
  const off = blankProfile({ id: "test-off", name: "Test off", pack: "psilocybin" });
  off.species = "Psilocybe cubensis";
  assert.deepEqual(collectProfileIssues(off), []);
  assert.equal(off.affiliates_allowed, false);
  assert.ok(off.legal_notice);
});

test("publish requires photo, title, and description", () => {
  const issues = publishReadyIssues({ title: "", description: "", photos: [] });
  assert.ok(issues.some((i) => i.path === "publish.title"));
  assert.ok(issues.some((i) => i.path === "publish.description"));
  assert.ok(issues.some((i) => i.path === "publish.photos"));
  assert.equal(publishReadyIssues({ title: "A", description: "B", photos: [{ id: 1 }] }).length, 0);
});

test("temperature unit helpers round trip", () => {
  assert.equal(Math.round(cToF(20)), 68);
  assert.equal(Math.round(fToC(68)), 20);
  assert.equal(slugify("Pearl Oyster"), "pearl-oyster");
});

test("stage ids must be known grow phases and source urls must be https", () => {
  assert.equal(isStageId("colonization"), true);
  assert.equal(isStageId(`fruiting"><img src=x onerror=alert(1)>`), false);
  const bad = blankProfile({ id: "xss-oyster", name: "Xss oyster", pack: "culinary" });
  bad.species = "Pleurotus ostreatus";
  bad.stages[0].id = `fruiting"><img src=x>`;
  assert.ok(collectProfileIssues(bad).some((i) => i.path.includes("id")));
  assert.equal(isHttpsSourceUrl("https://doi.org/10.1111/j.1751-1097.1987.tb07888.x"), true);
  assert.equal(isHttpsSourceUrl("http://example.com/paper"), false);
  assert.equal(isHttpsSourceUrl("javascript:alert(1)"), false);
});

test("scientific and common names force Off-menu even when labeled culinary", () => {
  const labeled = blankProfile({ id: "sneaky-teacher", name: "Garden mix", pack: "culinary" });
  labeled.species = "Psilocybe\u00a0cubensis";
  labeled.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  labeled.allowed_payment_providers = ["stripe"];
  labeled.affiliates_allowed = true;
  assert.equal(detectsRestrictedTaxon(labeled), true);
  const forced = validateProfile(labeled);
  assert.equal(forced.pack, "psilocybin");
  assert.equal(forced.restricted, true);
  assert.equal(forced.affiliates_allowed, false);
  assert.equal(forced.pricing.kind, "free");
  const common = blankProfile({ id: "gt-common", name: "Golden Teacher", pack: "culinary" });
  common.species = "Unknown garden mushroom";
  assert.equal(detectsRestrictedTaxon(common), true);
  const oyster = blankProfile({ id: "still-oyster", name: "Pearl Oyster", pack: "culinary" });
  oyster.species = "Pleurotus ostreatus";
  assert.equal(detectsRestrictedTaxon(oyster), false);
  for (const species of [
    "P. cubensis",
    "cubensis",
    "Stropharia cubensis",
    "Panaeolus cinctulus",
    "Panaeolus subbalteatus",
    "Panaeolus cyanescens",
    "Copelandia",
    "Gymnopilus junonius",
    "Gymnopilus spectabilis",
    "Pluteus salicinus",
    "Inocybe aeruginascens",
    "Conocybe cyanopus",
    "Psilocybecubensis",
  ]) {
    const labeled = blankProfile({ id: "taxon-check", name: "Garden mix", pack: "culinary" });
    labeled.species = species;
    assert.equal(detectsRestrictedTaxon(labeled), true, species);
  }
  const hidden = blankProfile({ id: "hidden-taxon", name: "Garden mix", pack: "culinary" });
  hidden.species = "Psilo\u00adcybe cubensis";
  assert.equal(detectsRestrictedTaxon(hidden), true);
  const cubes = blankProfile({ id: "cubes", name: "Psilocybin cubes", pack: "culinary" });
  cubes.species = "Unknown garden mushroom";
  assert.equal(detectsRestrictedTaxon(cubes), true);
  const tagged = blankProfile({ id: "tagged", name: "Garden mix", pack: "culinary" });
  tagged.species = "Pleurotus ostreatus";
  tagged.tags = ["Psilocybin"];
  assert.equal(detectsRestrictedTaxon(tagged), true);
  const accented = blankProfile({ id: "accented", name: "Garden mix", pack: "culinary" });
  accented.species = "Psílocybe cubénsis";
  assert.equal(detectsRestrictedTaxon(accented), true);
  const misspelled = blankProfile({ id: "misspelled", name: "Garden mix", pack: "culinary" });
  misspelled.species = "psilocibe";
  assert.equal(detectsRestrictedTaxon(misspelled), true);
  const slang = blankProfile({ id: "slang", name: "Garden mix", pack: "culinary" });
  slang.species = "Pleurotus ostreatus";
  slang.notes = "shrooms";
  assert.equal(detectsRestrictedTaxon(slang), true);
  const bolete = blankProfile({ id: "bolete", name: "Garden mix", pack: "culinary" });
  bolete.species = "Gyroporus cyanescens";
  assert.equal(detectsRestrictedTaxon(bolete), false);
  const vitamin = blankProfile({ id: "vitamin", name: "Garden mix", pack: "culinary" });
  vitamin.species = "Pleurotus ostreatus";
  vitamin.summary = "Add vitamin B+ to the soak";
  assert.equal(detectsRestrictedTaxon(vitamin), false);
  const split = blankProfile({ id: "split", name: "Psilo", pack: "culinary" });
  split.species = "cybe";
  assert.equal(detectsRestrictedTaxon(split), false);
});

test("list summaries with a stage count do not crash validation or clone", () => {
  const summary = { id: "pearl-oyster", name: "Pearl Oyster", species: "Pleurotus ostreatus", pack: "culinary", stages: 3 };
  const issues = collectProfileIssues(summary);
  assert.ok(issues.some((i) => i.path === "stages"));
  const cloned = cloneProfile(summary, { id: "pearl-oyster-copy", name: "Pearl Oyster copy" });
  assert.ok(Array.isArray(cloned.stages));
  assert.ok(cloned.stages.length >= 1);
});
