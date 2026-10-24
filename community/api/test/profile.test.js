import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { affiliateLinksFor, isPsilocybin, validateProfile, ValidationError } from "../src/profile.js";
import {
  applyPackRules,
  classifyTaxon,
  detectsRestrictedTaxon,
  needsOffmenuFlag,
  PSILOCYBIN_LEGAL_NOTICE,
  serveProfileDocument,
} from "../src/profile-schema.js";

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

const FORCE_CASES = [
  { field: "species", value: "Psilocybe cubensis" },
  { field: "species", value: "P. cubensis" },
  { field: "species", value: "P. tampanensis" },
  { field: "species", value: "Stropharia cubensis" },
  { field: "species", value: "Panaeolus cinctulus" },
  { field: "species", value: "Panaeolus cyanescens" },
  { field: "species", value: "Copelandia tropicalis" },
  { field: "species", value: "Gymnopilus junonius" },
  { field: "species", value: "Pluteus salicinus" },
  { field: "species", value: "Inocybe aeruginascens" },
  { field: "species", value: "Conocybe cyanopus" },
  { field: "species", value: "Psilocybecubensis" },
  { field: "species", value: "Psílocybe cubénsis" },
  { field: "species", value: "Psi\u0301locybe cubensis" },
  { field: "species", value: "Psilo\u00adcybe cubensis" },
];

const HOLD_CASES = [
  { field: "species", value: "Psiłocybe cubɛnsis" },
  { field: "species", value: "Псилоцибе кубенсис" },
  { field: "species", value: "Agaricus sp." },
  { field: "species", value: "Unknown garden mushroom" },
  { field: "species", value: "Pluteus" },
  { field: "species", value: "cubensis" },
  { field: "species", value: "Psilocybé" },
  { field: "species", value: "Agaricus cubensis" },
  { field: "species", value: "Pleurotus cyanescens" },
  { field: "species", value: "Lentinula tampanensis" },
  { field: "species", value: "Agaricus semilanceata" },
  { field: "species", value: "Hypsizygus tropicalis" },
  { field: "species", value: "Lentinus cyanescens" },
  { field: "species", value: "Lentinus tropicalis" },
  { field: "species", value: "Agaricus bisporus var. cubensis" },
];

const FLAG_ONLY_CASES = [
  { field: "summary", value: "Grown with the Shroom Labs kit." },
  { field: "tags", value: ["shroom"] },
  { field: "notes", value: "Wild lookalikes include Inocybe and Galerina" },
  { field: "notes", value: "Cut into cubes before cooking." },
  { field: "summary", value: "Add vitamin B+ to the soak" },
  { field: "name", value: "Psilo" },
];

const CULINARY_CASES = [
  { field: "species", value: "Gyroporus cyanescens" },
  { field: "species", value: "Pleurotus ostreatus" },
  { field: "species", value: "Auricularia auricula-judae" },
  { field: "species", value: "Cordyceps militaris" },
  { field: "name", value: "Shiitake (椎茸)" },
  { field: "name", value: "Blue Oyster" },
  { field: "name", value: "Golden Oyster" },
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

function paidCulinary(base, row) {
  const labeled = applyTaxonCase(base, row);
  labeled.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  labeled.allowed_payment_providers = ["stripe"];
  labeled.affiliates_allowed = true;
  return labeled;
}

test("off-menu classifier uses a culinary allowlist and only forces high-confidence taxa", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  for (const [i, row] of FORCE_CASES.entries()) {
    const labeled = applyTaxonCase(pearl, row);
    labeled.id = `force-${i}`;
    const classified = classifyTaxon(labeled);
    assert.equal(classified.force, true, `${row.field}=${row.value}`);
    assert.equal(validateProfile(labeled).pack, "psilocybin", `${row.field}=${row.value}`);
  }
  for (const [i, row] of HOLD_CASES.entries()) {
    const labeled = applyTaxonCase(pearl, row);
    labeled.id = `hold-${i}`;
    const classified = classifyTaxon(labeled);
    assert.equal(classified.force, false, `${row.field}=${row.value}`);
    assert.equal(classified.hold, true, `${row.field}=${row.value}`);
    assert.equal(validateProfile(labeled).pack, "psilocybin", `${row.field}=${row.value}`);
  }
  const albino = applyTaxonCase(pearl, { field: "species", value: "Agaricus sp." });
  albino.strain = "Albino A+";
  albino.id = "hold-albino";
  assert.equal(classifyTaxon(albino).hold, true);
  assert.equal(validateProfile(albino).pack, "psilocybin");
  const tamp = applyTaxonCase(pearl, { field: "species", value: "P. tampanensis" });
  tamp.strain = "philosopher stone";
  tamp.id = "force-tamp";
  assert.equal(classifyTaxon(tamp).force, true);
  assert.equal(validateProfile(tamp).pack, "psilocybin");
  const monster = applyTaxonCase(pearl, { field: "species", value: "Agaricus sp." });
  monster.strain = "Great White Monster";
  monster.id = "hold-gwm";
  assert.equal(classifyTaxon(monster).hold, true);
  assert.equal(validateProfile(monster).pack, "psilocybin");

  for (const row of FLAG_ONLY_CASES) {
    const labeled = paidCulinary(pearl, row);
    const classified = classifyTaxon(labeled);
    assert.equal(classified.force, false, `${row.field}=${row.value}`);
    assert.equal(classified.hold, false, `${row.field}=${row.value}`);
    const out = validateProfile(labeled);
    assert.equal(out.pack, "culinary", `${row.field}=${row.value}`);
    assert.equal(out.pricing.kind, "paid", `${row.field}=${row.value}`);
    assert.equal(out.pricing.amount_cents, 199, `${row.field}=${row.value}`);
    assert.equal(out.affiliates_allowed, true, `${row.field}=${row.value}`);
  }
  const labs = paidCulinary(pearl, { field: "summary", value: "Grown with the Shroom Labs kit." });
  labs.tags = ["shroom"];
  assert.equal(needsOffmenuFlag(labs), true);
  assert.equal(validateProfile(labs).pack, "culinary");
  assert.equal(validateProfile(labs).pricing.kind, "paid");

  for (const row of CULINARY_CASES) {
    const labeled = applyTaxonCase(pearl, row);
    assert.equal(classifyTaxon(labeled).culinary, true, `${row.field}=${row.value}`);
    assert.equal(validateProfile(labeled).pack, "culinary", `${row.field}=${row.value}`);
  }
  const split = applyTaxonCase(pearl, { field: "name", value: "Psilo" });
  split.species = "cybe";
  assert.equal(classifyTaxon(split).force, false, "does not join across fields");
  assert.equal(classifyTaxon(split).hold, true, "unknown genus is held");
  const oyster = structuredClone(pearl);
  assert.equal(classifyTaxon(oyster).culinary, true);
  assert.equal(detectsRestrictedTaxon(oyster), false);
  assert.equal(validateProfile(oyster).pack, "culinary");
  const wine = structuredClone(load("data/profiles/culinary/wine-cap.json"));
  assert.equal(classifyTaxon(wine).culinary, true);
  const shiitake = applyTaxonCase(pearl, { field: "species", value: "Lentinula edodes" });
  shiitake.name = "Shiitake (椎茸)";
  assert.equal(classifyTaxon(shiitake).culinary, true);
  assert.equal(validateProfile(shiitake).pack, "culinary");
  const prose = paidCulinary(pearl, { field: "summary", value: "Psilocybe cubensis" });
  prose.notes = "Panaeolus cyanescens";
  prose.tags = ["culinary", "psilocybe", "cubensis"];
  assert.equal(classifyTaxon(prose).culinary, true);
  assert.equal(classifyTaxon(prose).proseFlag, true);
  assert.equal(needsOffmenuFlag(prose), true);
  assert.equal(validateProfile(prose).pack, "culinary");
  for (const strain of ["GT", "PE6", "JMF", "ＧＴ"]) {
    const cube = paidCulinary(pearl, { field: "strain", value: strain });
    assert.equal(classifyTaxon(cube).proseFlag, true, strain);
    assert.equal(validateProfile(cube).pack, "culinary", strain);
  }
});

test("unknown genus plus a restricted epithet is forced off-menu", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  for (const species of ["Foo cubensis", "Mystery cyanescens", "Psilocibe cubensis"]) {
    const labeled = applyTaxonCase(pearl, { field: "species", value: species });
    assert.equal(classifyTaxon(labeled).force, true, species);
    assert.equal(validateProfile(labeled).pack, "psilocybin", species);
    assert.equal(validateProfile(labeled).legal_notice, PSILOCYBIN_LEGAL_NOTICE, species);
  }
});

test("moderator culinary confirm rewrites pack fields and is refused on force-match taxa", () => {
  const pearl = load("data/profiles/culinary/pearl-oyster.json");
  const morel = applyTaxonCase(pearl, { field: "species", value: "Morchella esculenta" });
  morel.pack = "psilocybin";
  morel.restricted = true;
  morel.tags = ["psilocybin"];
  morel.legal_notice = PSILOCYBIN_LEGAL_NOTICE;
  const confirmed = applyPackRules(morel, { moderatorPack: "culinary" });
  assert.equal(confirmed.pack, "culinary");
  assert.equal(confirmed.restricted, false);
  assert.equal(confirmed.tags.includes("psilocybin"), false);
  assert.equal(confirmed.tags.includes("culinary"), true);
  assert.equal(confirmed.legal_notice, null);
  assert.equal(isPsilocybin(confirmed), false);
  const served = serveProfileDocument(confirmed);
  assert.equal(served.pack, "culinary");
  assert.equal(served.legal_notice, null);

  const cube = applyTaxonCase(pearl, { field: "species", value: "Psilocybe cubensis" });
  cube.pack = "psilocybin";
  cube.restricted = true;
  assert.throws(() => applyPackRules(cube, { moderatorPack: "culinary" }), /cannot be confirmed as culinary/);
  const heldOff = applyPackRules(morel);
  assert.equal(heldOff.pack, "culinary");
  assert.equal(heldOff.legal_notice, null);
  const sneak = applyTaxonCase(pearl, { field: "species", value: "Agaricus cubensis" });
  sneak.pack = "culinary";
  sneak.restricted = false;
  sneak.legal_notice = null;
  const servedSneak = serveProfileDocument(applyPackRules(sneak));
  assert.equal(servedSneak.pack, "psilocybin");
  assert.equal(servedSneak.legal_notice, PSILOCYBIN_LEGAL_NOTICE);
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
