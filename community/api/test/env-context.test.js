import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { envContext } from "../src/env.js";
import { paymentsConfigured } from "../src/providers.js";
import { coachPriceId } from "../src/stripe.js";

const fakeD1 = { prepare: () => ({ bind: () => ({}) }), exec: async () => {}, batch: async () => [] };

test("the Worker context passes Stripe secrets and price ids through", async () => {
  const ctx = await envContext({
    DB: fakeD1,
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_MONTHLY: "price_m",
    STRIPE_PRICE_YEARLY: "price_y",
  });
  assert.equal(paymentsConfigured(ctx), true);
  assert.equal(coachPriceId(ctx, "monthly"), "price_m");
  assert.equal(coachPriceId(ctx, "yearly"), "price_y");
  const legacy = await envContext({ DB: fakeD1, STRIPE_PRICE_COACH: "price_old" });
  assert.equal(coachPriceId(legacy, "monthly"), "price_old");
});

test("every STRIPE_ setting the payment code reads is passed by envContext", () => {
  const src = ["stripe.js", "payments.js", "coach.js", "providers.js", "security.js"].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
  const env = readFileSync(new URL("../src/env.js", import.meta.url), "utf8");
  const keys = [...new Set([...src.matchAll(/env\??\.(STRIPE_[A-Z_]+|PAYMENTS_[A-Z_]+)/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 5);
  for (const key of keys) assert.match(env, new RegExp(`\\b${key}: env\\.${key}\\b`), `${key} is missing from envContext`);
});
