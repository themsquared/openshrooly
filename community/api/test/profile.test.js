import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { affiliateLinksFor, isPsilocybin, validateProfile, ValidationError } from "../src/profile.js";
import { detectsRestrictedTaxon } from "../src/profile-schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function load(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

test("api and web share one profile schema file", () => {
  const api = readFileSync(new URL("../src/profile-schema.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../web/public/js/profile-schema.js", import.meta.url), "utf8");
  const hub = readFileSync(new URL("../../../hub/static/builder/profile-schema.js", import.meta.url), "utf8");
  assert.equal(web, api);
  assert.equal(hub, api);
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
  for (const badUrl of ["javascript:alert(1)", "data:text/html,hi", "http://example.com/paper"]) {
    const bad = structuredClone(pearl);
    bad.light_recipe.sources[0].url = badUrl;
    assert.throws(() => validateProfile(bad), /https/);
  }
});

const OFFMENU_CASES = [
  { field: "species", value: "P. cubensis" },
  { field: "species", value: "cubensis" },
  { field: "species", value: "Stropharia cubensis" },
  { field: "species", value: "Panaeolus cinctulus" },
  { field: "species", value: "Panaeolus subbalteatus" },
  { field: "species", value: "Panaeolus cyanescens" },
  { field: "species", value: "Copelandia tropicalis" },
  { field: "species", value: "Copelandia cyanescens" },
  { field: "species", value: "Gymnopilus junonius" },
  { field: "species", value: "Gymnopilus spectabilis" },
  { field: "species", value: "Pluteus salicinus" },
  { field: "species", value: "Inocybe aeruginascens" },
  { field: "species", value: "Conocybe cyanopus" },
  { field: "species", value: "Pluteus" },
  { field: "species", value: "Inocybe" },
  { field: "species", value: "Psilocybe cubensis".replace("c", "\u0441") },
  { field: "species", value: "Psilo\u200dcybe cubensis" },
  { field: "species", value: "Psilo\u00adcybe cubensis" },
  { field: "species", value: "Psilocybecubensis" },
  { field: "species", value: "Psílocybe cubénsis" },
  { field: "species", value: "Psi\u0301locybe cubensis" },
  { field: "species", value: "Psilocybé" },
  { field: "species", value: "Psilocÿbe" },
  { field: "name", value: "Golden Teächer" },
  { field: "species", value: "Psılocybe" },
  { field: "species", value: "cubensıs" },
  { field: "species", value: "Psil\u0585cybe" },
  { field: "species", value: "cuben\u057dis" },
  { field: "species", value: "Ps\u04cflocybe" },
  { field: "species", value: "p\ua731ilocybe" },
  { field: "species", value: "psiloc\u028fbe" },
  { field: "species", value: "\u13e2silocybe" },
  { field: "name", value: "Golden Te\u0251cher" },
  { field: "species", value: "Psil0cybe" },
  { field: "species", value: "Ps1locybe" },
  { field: "species", value: "cubenzis" },
  { field: "species", value: "cubensys" },
  { field: "species", value: "cubensus" },
  { field: "species", value: "psilocibe" },
  { field: "species", value: "psylocybe" },
  { field: "species", value: "psilocyb" },
  { field: "species", value: "psilocibin" },
  { field: "name", value: "Psilocybin cubes" },
  { field: "summary", value: "Notes about Golden Teacher only" },
  { field: "notes", value: "This grow used APE" },
  { field: "notes", value: "Penis Envy clone" },
  { field: "summary", value: "B+ spore print" },
  { field: "summary", value: "B Plus isolate" },
  { field: "tags", value: ["Psilocybin"] },
  { field: "notes", value: "shroom" },
  { field: "notes", value: "shrooms" },
  { field: "notes", value: "magic shrooms" },
  { field: "notes", value: "mushies" },
  { field: "notes", value: "cubes" },
  { field: "strain", value: "PE" },
  { field: "strain", value: "PE6" },
  { field: "strain", value: "Mazatapec" },
  { field: "strain", value: "Treasure Coast" },
  { field: "strain", value: "Jack Frost" },
  { field: "strain", value: "Avery's Albino" },
  { field: "strain", value: "Tidal Wave" },
  { field: "strain", value: "Enigma" },
  { field: "strain", value: "Thrasher" },
  { field: "strain", value: "McKennaii" },
  { field: "strain", value: "Cambodian" },
  { field: "strain", value: "Ecuador" },
  { field: "strain", value: "Hillbilly" },
  { field: "strain", value: "Z-strain" },
  { field: "strain", value: "Lizard King" },
  { field: "strain", value: "Huautla" },
  { field: "strain", value: "Pink Buffalo" },
  { field: "strain", value: "Koh Samui" },
  { field: "strain", value: "Amazonian" },
  { field: "strain", value: "Texas Yellow" },
  { field: "strain", value: "Melmac" },
  { field: "stageName", value: "Psilocybe pins" },
  { field: "lightNotes", value: "Golden Teacher lighting" },
  { field: "affiliateLabel", value: "APE syringes" },
];

const CULINARY_CASES = [
  { field: "species", value: "Gyroporus cyanescens" },
  { field: "species", value: "Lentinus tropicalis" },
  { field: "species", value: "Pleurotus ostreatus" },
  { field: "summary", value: "Add vitamin B+ to the soak" },
  { field: "name", value: "Psilo" },
];

test("a culinary label cannot hide a restricted species", () => {
  const sneak = structuredClone(load("data/profiles/culinary/pearl-oyster.json"));
  sneak.id = "sneaky-teacher";
  sneak.name = "Garden mix";
  sneak.species = "Psilocybe cubensis";
  sneak.pack = "culinary";
  sneak.restricted = false;
  sneak.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  sneak.allowed_payment_providers = ["stripe"];
  sneak.affiliates_allowed = true;
  const forced = validateProfile(sneak);
  assert.equal(forced.pack, "psilocybin");
  assert.equal(forced.restricted, true);
  assert.equal(forced.affiliates_allowed, false);
  assert.equal(forced.pricing.kind, "free");
  assert.ok(forced.legal_notice);
  for (const species of [
    "Panaeolus cyanescens",
    "Gymnopilus junonius",
    "Pluteus salicinus",
    "Inocybe aeruginascens",
    "Conocybe cyanopus",
  ]) {
    const labeled = structuredClone(load("data/profiles/culinary/pearl-oyster.json"));
    labeled.id = "taxon-check";
    labeled.name = "Garden mix";
    labeled.species = species;
    labeled.pack = "culinary";
    labeled.restricted = false;
    assert.equal(validateProfile(labeled).pack, "psilocybin", species);
  }
});

function applyTaxonCase(base, row) {
  const labeled = structuredClone(base);
  labeled.id = "taxon-check";
  labeled.name = row.field === "name" ? row.value : "Garden mix";
  labeled.species = row.field === "species" ? row.value : "Pleurotus ostreatus";
  labeled.strain = row.field === "strain" ? row.value : "";
  labeled.summary = row.field === "summary" ? row.value : labeled.summary;
  labeled.notes = row.field === "notes" ? row.value : "";
  labeled.tags = row.field === "tags" ? row.value : ["culinary"];
  labeled.pack = "culinary";
  labeled.restricted = false;
  if (row.field === "stageName") labeled.stages[0].name = row.value;
  if (row.field === "lightNotes") labeled.light_recipe.sources[0].detail = row.value;
  if (row.field === "affiliateLabel") labeled.affiliate_links = [{ id: "bags", label: row.value, merchant: "x", url: "https://example.com/bags" }];
  return labeled;
}

test("off-menu classifier catches short names, synonyms, hidden characters, and other fields", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  for (const [i, row] of OFFMENU_CASES.entries()) {
    const labeled = applyTaxonCase(pearl, row);
    labeled.id = `taxon-${i}`;
    assert.equal(detectsRestrictedTaxon(labeled), true, `${row.field}=${row.value}`);
    assert.equal(validateProfile(labeled).pack, "psilocybin", `${row.field}=${row.value}`);
  }
  for (const row of CULINARY_CASES) {
    const labeled = applyTaxonCase(pearl, row);
    assert.equal(detectsRestrictedTaxon(labeled), false, `${row.field}=${row.value}`);
    assert.equal(validateProfile(labeled).pack, "culinary", `${row.field}=${row.value}`);
  }
  const split = applyTaxonCase(pearl, { field: "name", value: "Psilo" });
  split.species = "cybe";
  assert.equal(detectsRestrictedTaxon(split), false, "does not join across fields");
  const oyster = structuredClone(pearl);
  assert.equal(detectsRestrictedTaxon(oyster), false);
  assert.equal(validateProfile(oyster).pack, "culinary");
  const wine = structuredClone(load("data/profiles/culinary/wine-cap.json"));
  assert.equal(detectsRestrictedTaxon(wine), false);
});

test("affiliate ids and urls must be safe https slugs", () => {
  const pearl = structuredClone(load("data/profiles/culinary/pearl-oyster.json"));
  pearl.affiliate_links = [{ id: `bags"><img src=x>`, label: "x", merchant: "x", url: "https://evil.example" }];
  assert.throws(() => validateProfile(pearl), /Affiliate ids/);
  const badUrl = structuredClone(load("data/profiles/culinary/pearl-oyster.json"));
  badUrl.affiliate_links = [{ id: "bags", label: "x", merchant: "x", url: "javascript:alert(1)" }];
  assert.throws(() => validateProfile(badUrl), /https/);
});

test("psilocybin pack rejects payments and affiliates", () => {
  const gt = load("data/profiles/psilocybin/golden-teacher.json");
  validateProfile(gt);
  assert.equal(isPsilocybin(gt), true);
  assert.equal(affiliateLinksFor(gt).length, 0);
  const paid = structuredClone(gt);
  paid.pricing = { kind: "paid", amount_cents: 199, currency: "USD" };
  paid.allowed_payment_providers = ["stripe"];
  const forcedPaid = validateProfile(paid);
  assert.equal(forcedPaid.pricing.kind, "free");
  assert.deepEqual(forcedPaid.allowed_payment_providers, []);
  const aff = structuredClone(gt);
  aff.affiliate_links = [{ id: "x", label: "x", merchant: "x", url: "https://example.com" }];
  aff.affiliates_allowed = true;
  const forcedAff = validateProfile(aff);
  assert.equal(forcedAff.affiliates_allowed, false);
  assert.deepEqual(forcedAff.affiliate_links, []);
});
