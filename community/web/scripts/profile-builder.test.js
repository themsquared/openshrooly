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
  exportProfileDocument,
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
  assert.equal(web, api);
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

test("list summaries with a stage count do not crash validation or clone", () => {
  const summary = { id: "pearl-oyster", name: "Pearl Oyster", species: "Pleurotus ostreatus", pack: "culinary", stages: 3 };
  const issues = collectProfileIssues(summary);
  assert.ok(issues.some((i) => i.path === "stages"));
  const cloned = cloneProfile(summary, { id: "pearl-oyster-copy", name: "Pearl Oyster copy" });
  assert.ok(Array.isArray(cloned.stages));
  assert.ok(cloned.stages.length >= 1);
});
