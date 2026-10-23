import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { affiliateLinksFor, isPsilocybin, validateProfile, ValidationError } from "../src/profile.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function load(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

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
