import { test } from "node:test";
import assert from "node:assert/strict";
import { keyMode, paidProfiles, productFields, renderPricesModule, syncPrices } from "../scripts/stripe-sync-prices.mjs";
import seeds from "../src/seeds.json" with { type: "json" };
import { STRIPE_PROFILE_PRICES } from "../src/stripe-prices.js";

/** In-memory Stripe with just products and prices, paginated two at a time. */
function fakeStripe() {
  const products = [];
  const prices = [];
  const calls = [];
  let n = 0;
  const page = (rows, params) => {
    const after = params.get("starting_after");
    const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
    const data = rows.slice(start, start + 2);
    return { data, has_more: start + 2 < rows.length };
  };
  const meta = (form) => Object.fromEntries([...form].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
  const fetch = async (url, init) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body || "");
    calls.push({ method: init.method, path: u.pathname, headers: init.headers, form });
    const path = u.pathname.replace("/v1", "");
    if (init.method === "GET" && path === "/products") return Response.json(page(products, u.searchParams));
    if (init.method === "GET" && path === "/prices") {
      const rows = prices.filter((p) => p.product === u.searchParams.get("product") && (u.searchParams.get("active") !== "true" || p.active));
      return Response.json(page(rows, u.searchParams));
    }
    if (init.method === "POST" && path === "/products") {
      const p = { id: `prod_${++n}`, created: n, active: true, name: form.get("name"), description: form.get("description"), images: [form.get("images[0]")], metadata: meta(form) };
      products.push(p);
      return Response.json(p);
    }
    let m = path.match(/^\/products\/(.+)$/);
    if (init.method === "POST" && m) {
      const p = products.find((x) => x.id === m[1]);
      if (form.has("name")) Object.assign(p, { name: form.get("name"), description: form.get("description"), images: [form.get("images[0]")] });
      Object.assign(p.metadata, meta(form));
      if (form.has("default_price")) p.default_price = form.get("default_price");
      return Response.json(p);
    }
    if (init.method === "POST" && path === "/prices") {
      const p = { id: `price_${++n}`, product: form.get("product"), active: true, type: "one_time", currency: form.get("currency"), unit_amount: Number(form.get("unit_amount")), metadata: meta(form) };
      prices.push(p);
      return Response.json(p);
    }
    m = path.match(/^\/prices\/(.+)$/);
    if (init.method === "POST" && m) {
      const p = prices.find((x) => x.id === m[1]);
      p.active = form.get("active") === "true";
      return Response.json(p);
    }
    return Response.json({ error: { type: "invalid_request_error", message: "unknown" } }, { status: 404 });
  };
  return { fetch, products, prices, calls };
}

const KEY = "sk_test_fake_sync_key";
const sample = [
  { id: "a-paid", name: "A", summary: "Sum A", pack: "culinary", pricing: { kind: "paid", amount_cents: 299, creator_share_percent: 70 }, allowed_payment_providers: ["stripe"] },
  { id: "b-paid", name: "B", summary: "Sum B", pack: "culinary", pricing: { kind: "paid", amount_cents: 399, creator_share_percent: 70 }, allowed_payment_providers: ["stripe"] },
  { id: "c-paid", name: "C", summary: "Sum C", pack: "culinary", pricing: { kind: "paid", amount_cents: 299, creator_share_percent: 70 }, allowed_payment_providers: ["stripe"] },
];

test("key mode is read from the prefix and an unknown key is refused", () => {
  assert.equal(keyMode("sk_test_x"), "test");
  assert.equal(keyMode("rk_test_x"), "test");
  assert.equal(keyMode("sk_live_x"), "live");
  assert.equal(keyMode("pk_test_x"), "");
  assert.equal(keyMode(""), "");
});

test("every paid built-in syncs, Off-menu and free profiles never do", () => {
  const ids = paidProfiles(seeds).map((p) => p.id);
  assert.ok(ids.includes("king-oyster-thick-stem"));
  assert.ok(ids.length >= 12, String(ids.length));
  for (const p of seeds) if (p.pack === "psilocybin" || p.pricing?.kind !== "paid") assert.ok(!ids.includes(p.id), p.id);
});

test("product carries the profile name, summary, photo, and metadata", () => {
  const f = productFields(sample[0]);
  assert.equal(f.name, "A");
  assert.equal(f.description, "Sum A");
  assert.deepEqual(f.images, ["https://shroomlabs.io/og/a-paid.jpg"]);
  assert.deepEqual(f.metadata, { profile_id: "a-paid", pack: "culinary", creator_share_percent: "70" });
});

test("sync creates one product and one price per profile, then a second run changes nothing", async () => {
  const s = fakeStripe();
  const first = await syncPrices({ key: KEY, profiles: sample, fetch: s.fetch });
  assert.equal(s.products.length, 3);
  assert.equal(s.prices.length, 3);
  for (const p of sample) {
    const row = first.table[p.id];
    const product = s.products.find((x) => x.id === row.product);
    assert.equal(product.metadata.profile_id, p.id);
    assert.equal(product.default_price, row.price);
    assert.equal(s.prices.find((x) => x.id === row.price).unit_amount, p.pricing.amount_cents);
    assert.equal(row.amount_cents, p.pricing.amount_cents);
  }
  const creates = s.calls.filter((c) => c.method === "POST" && /\/(products|prices)$/.test(c.path));
  assert.ok(creates.every((c) => c.headers["idempotency-key"]), "creates carry an idempotency key");
  const before = s.calls.length;
  const second = await syncPrices({ key: KEY, profiles: sample, fetch: s.fetch });
  assert.deepEqual(second.actions, []);
  assert.deepEqual(second.table, first.table);
  assert.ok(s.calls.slice(before).every((c) => c.method === "GET"), "second run only reads");
});

test("a new amount gets a new price and archives the old one", async () => {
  const s = fakeStripe();
  const first = await syncPrices({ key: KEY, profiles: sample, fetch: s.fetch });
  const bumped = sample.map((p) => (p.id === "a-paid" ? { ...p, pricing: { ...p.pricing, amount_cents: 499 } } : p));
  const second = await syncPrices({ key: KEY, profiles: bumped, fetch: s.fetch });
  assert.equal(second.table["a-paid"].product, first.table["a-paid"].product);
  assert.notEqual(second.table["a-paid"].price, first.table["a-paid"].price);
  assert.equal(s.prices.find((p) => p.id === first.table["a-paid"].price).active, false);
  assert.equal(s.products.length, 3);
});

test("dry run writes nothing to Stripe", async () => {
  const s = fakeStripe();
  const { actions } = await syncPrices({ key: KEY, profiles: sample, fetch: s.fetch, dryRun: true });
  assert.ok(actions.length >= 6);
  assert.ok(s.calls.every((c) => c.method === "GET"));
});

test("the key never appears in a thrown error", async () => {
  const fetch = async () => Response.json({ error: { type: "authentication_error", message: "Invalid API Key provided" } }, { status: 401 });
  await assert.rejects(syncPrices({ key: KEY, profiles: sample, fetch }), (err) => !String(err.message).includes(KEY));
});

test("the checked-in price table covers every paid built-in in test mode at the current amount", () => {
  for (const p of paidProfiles(seeds)) {
    const row = STRIPE_PROFILE_PRICES.test[p.id];
    assert.ok(row, `${p.id} has no test price; run scripts/stripe-sync-prices.mjs`);
    assert.match(row.product, /^prod_/);
    assert.match(row.price, /^price_/);
    assert.equal(row.amount_cents, p.pricing.amount_cents, p.id);
  }
  assert.match(renderPricesModule(STRIPE_PROFILE_PRICES), /export const STRIPE_PROFILE_PRICES/);
});
