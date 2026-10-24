import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { affiliateLinksFor, isPsilocybin, validateProfile, ValidationError } from "../src/profile.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function load(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

test("api and web share one profile schema file", () => {
  const api = readFileSync(new URL("../src/profile-schema.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../web/public/js/profile-schema.js", import.meta.url), "utf8");
  assert.equal(web, api);
});

test("culinary seed profiles validate", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  const profile = validateProfile(pearl);
  assert.equal(profile.pack, "culinary");
  assert.ok(affiliateLinksFor(profile).length > 0);
});

test("paid culinary profile is allowed", () => {
  const premium = load("data/profiles/culinary/king-oyster-thick-stem.json");
  validateProfile(premium);
  assert.equal(premium.pricing.kind, "paid");
  assert.deepEqual(premium.allowed_payment_providers, ["stripe"]);
});

test("every seed profile has a sourced light recipe inside the ranges", () => {
  const files = ["culinary", "psilocybin"].flatMap((pack) =>
    readdirSync(join(root, "data/profiles", pack))
      .filter((name) => name.endsWith(".json"))
      .map((name) => `data/profiles/${pack}/${name}`)
  );
  assert.ok(files.length >= 26);
  for (const file of files) {
    const profile = load(file);
    validateProfile(profile);
    const recipe = profile.light_recipe;
    assert.ok(recipe, file);
    assert.ok(recipe.why);
    assert.match(recipe.wavelength_note, /465 to 475 nm/);
    assert.ok(recipe.sources.length >= 1, file);
    assert.ok(recipe.phases.colonization);
    assert.ok(recipe.phases.fruiting);
    for (const [name, phase] of Object.entries(recipe.phases)) {
      assert.ok(phase.photoperiod_hours >= 0 && phase.photoperiod_hours <= 24, `${file} ${name}`);
      assert.ok(phase.white_brightness_percent >= 0 && phase.white_brightness_percent <= 100, `${file} ${name}`);
    }
  }
});

test("light recipe validation rejects bad ranges and missing sources", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  const badHours = structuredClone(pearl);
  badHours.light_recipe.phases.fruiting.photoperiod_hours = 25;
  assert.throws(() => validateProfile(badHours), ValidationError);
  const badWhite = structuredClone(pearl);
  badWhite.light_recipe.phases.fruiting.white_brightness_percent = -1;
  assert.throws(() => validateProfile(badWhite), ValidationError);
  const noSources = structuredClone(pearl);
  noSources.light_recipe.sources = [];
  assert.throws(() => validateProfile(noSources), ValidationError);
});

test("psilocybin pack rejects payments and affiliates", () => {
  const gt = load("data/profiles/psilocybin/golden-teacher.json");
  validateProfile(gt);
  assert.equal(isPsilocybin(gt), true);
  assert.equal(affiliateLinksFor(gt).length, 0);
  const paid = structuredClone(gt);
  paid.pricing = { kind: "paid", amount_cents: 199, currency: "USD" };
  paid.allowed_payment_providers = ["stripe"];
  assert.throws(() => validateProfile(paid), ValidationError);
  const aff = structuredClone(gt);
  aff.affiliate_links = [{ id: "x", label: "x", merchant: "x", url: "https://example.com" }];
  aff.affiliates_allowed = false;
  assert.throws(() => validateProfile(aff), ValidationError);
});
