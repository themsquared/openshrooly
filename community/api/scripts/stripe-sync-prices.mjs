#!/usr/bin/env node
/**
 * Sync every paid built-in profile to its own Stripe Product with one active one-time USD Price,
 * then write the ids to src/stripe-prices.js.
 *
 * Idempotent: products are found by metadata.profile_id, prices by amount. Running it twice
 * changes nothing. A changed amount gets a new Price and the old one is archived (never deleted).
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-sync-prices.mjs            # test mode
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-sync-prices.mjs --live     # live mode
 *   add --dry-run to print the plan without writing anything to Stripe or disk
 *
 * The key is read from the environment and is never printed or logged.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRICES_FILE = join(HERE, "..", "src", "stripe-prices.js");
const SEEDS_FILE = join(HERE, "..", "src", "seeds.json");
const STRIPE_API = "https://api.stripe.com/v1";
const SITE = "https://shroomlabs.io";

export function keyMode(key) {
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "";
}

/** Paid, sellable built-ins. Off-menu profiles never take payments. */
export function paidProfiles(seeds) {
  return seeds
    .filter((p) => p?.pricing?.kind === "paid" && Number(p.pricing.amount_cents) > 0)
    .filter((p) => p.pack !== "psilocybin" && (p.allowed_payment_providers || []).includes("stripe"))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function productFields(profile, site = SITE) {
  return {
    name: profile.name,
    description: String(profile.summary || "").slice(0, 300) || profile.name,
    images: [`${site}/og/${profile.id}.jpg`],
    metadata: {
      profile_id: profile.id,
      pack: profile.pack || "culinary",
      creator_share_percent: String(profile.pricing.creator_share_percent ?? 70),
    },
  };
}

function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((v, i) => out.append(`${name}[${i}]`, String(v)));
    else if (typeof value === "object") form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export function stripeClient(key, fetchImpl = globalThis.fetch) {
  async function send(method, path, params, idempotencyKey) {
    const headers = { authorization: `Bearer ${key}`, "stripe-version": "2024-06-20" };
    let url = `${STRIPE_API}${path}`;
    let body;
    if (method === "GET") {
      if (params) url += `?${form(params).toString()}`;
    } else {
      headers["content-type"] = "application/x-www-form-urlencoded";
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      body = form(params || {}).toString();
    }
    const res = await fetchImpl(url, { method, headers, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Error type and message only. Never the request, which carries the key.
      throw new Error(`Stripe ${method} ${path} failed (${res.status} ${data?.error?.type || ""}): ${data?.error?.message || ""}`);
    }
    return data;
  }
  async function listAll(path, params) {
    const out = [];
    let starting_after;
    for (;;) {
      const page = await send("GET", path, { limit: 100, ...params, starting_after });
      out.push(...(page.data || []));
      if (!page.has_more || !page.data?.length) return out;
      starting_after = page.data[page.data.length - 1].id;
    }
  }
  return { send, listAll };
}

function sameProduct(product, want) {
  if (product.name !== want.name || (product.description || "") !== want.description) return false;
  if ((product.images || []).join("|") !== want.images.join("|")) return false;
  return Object.entries(want.metadata).every(([k, v]) => String(product.metadata?.[k] ?? "") === v);
}

const isMatchingPrice = (price, cents) =>
  price.active && price.type === "one_time" && price.currency === "usd" && Number(price.unit_amount) === cents && !price.recurring;

/**
 * Returns { table, actions }. table is { profile_id: { product, price, amount_cents } }.
 * With dryRun, nothing is written to Stripe; new ids show as "(new)".
 */
export async function syncPrices({ key, profiles, fetch: fetchImpl, dryRun = false, site = SITE, log = () => {} }) {
  const stripe = stripeClient(key, fetchImpl);
  const actions = [];
  const products = (await stripe.listAll("/products", {})).filter((p) => p.metadata?.profile_id);
  const table = {};
  for (const profile of profiles) {
    const want = productFields(profile, site);
    const cents = Number(profile.pricing.amount_cents);
    const matches = products.filter((p) => p.metadata.profile_id === profile.id);
    if (matches.length > 1) log(`warn ${profile.id}: ${matches.length} products carry this profile_id; using the oldest`);
    let product = matches.sort((a, b) => (a.created || 0) - (b.created || 0))[0];
    if (!product) {
      actions.push(`create product ${profile.id}`);
      product = dryRun
        ? { id: "(new)", ...want, active: true }
        : await stripe.send("POST", "/products", want, `shroomlabs-product-${profile.id}`);
    } else if (!sameProduct(product, want) || !product.active) {
      actions.push(`update product ${profile.id} ${product.id}`);
      if (!dryRun) product = await stripe.send("POST", `/products/${product.id}`, { ...want, active: true });
    }
    const prices = product.id === "(new)" ? [] : await stripe.listAll("/prices", { product: product.id, active: true });
    let price = prices.find((p) => isMatchingPrice(p, cents));
    if (!price) {
      actions.push(`create price ${profile.id} ${cents}`);
      price = dryRun
        ? { id: "(new)" }
        : await stripe.send(
            "POST",
            "/prices",
            { product: product.id, currency: "usd", unit_amount: cents, metadata: { profile_id: profile.id } },
            `shroomlabs-price-${profile.id}-${cents}`
          );
    }
    if (product.default_price !== price.id) {
      actions.push(`set default price ${profile.id}`);
      if (!dryRun) await stripe.send("POST", `/products/${product.id}`, { default_price: price.id });
    }
    for (const old of prices) {
      if (old.id === price.id || old.type !== "one_time") continue;
      actions.push(`archive price ${profile.id} ${old.id}`);
      if (!dryRun) await stripe.send("POST", `/prices/${old.id}`, { active: false });
    }
    table[profile.id] = { product: product.id, price: price.id, amount_cents: cents };
    log(`${profile.id}\t${product.id}\t${price.id}\t${cents}`);
  }
  return { table, actions };
}

export function renderPricesModule(all) {
  const sorted = (rows) => Object.fromEntries(Object.keys(rows || {}).sort().map((k) => [k, rows[k]]));
  const body = JSON.stringify({ test: sorted(all.test), live: sorted(all.live) }, null, 2);
  return `/**
 * Stripe Product and one-time Price per paid profile. Written by scripts/stripe-sync-prices.mjs.
 * Ids are not secrets. A missing entry, or an entry whose amount no longer matches the profile,
 * means checkout says the profile is not available yet.
 */
export const STRIPE_PROFILE_PRICES = ${body};
`;
}

export async function loadPricesModule() {
  const mod = await import(`${new URL("../src/stripe-prices.js", import.meta.url).href}?t=${Date.now()}`);
  return structuredClone(mod.STRIPE_PROFILE_PRICES);
}

async function main(argv) {
  const live = argv.includes("--live");
  const dryRun = argv.includes("--dry-run");
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  const mode = keyMode(key);
  if (!mode) throw new Error("STRIPE_SECRET_KEY is missing or not a Stripe secret or restricted key.");
  if (mode === "live" && !live) throw new Error("That is a live key. Pass --live to sync live mode on purpose.");
  if (mode === "test" && live) throw new Error("--live was passed with a test key. Use the live key for live mode.");
  const profiles = paidProfiles(JSON.parse(readFileSync(SEEDS_FILE, "utf8")));
  console.log(`mode ${mode}${dryRun ? " (dry run)" : ""}, ${profiles.length} paid profiles`);
  const { table, actions } = await syncPrices({ key, profiles, dryRun, log: (line) => console.log(line) });
  console.log(actions.length ? actions.join("\n") : "no changes in Stripe");
  if (dryRun) return;
  const all = await loadPricesModule();
  all[mode] = table;
  writeFileSync(PRICES_FILE, renderPricesModule(all));
  console.log(`wrote ${PRICES_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err?.message || err));
    process.exit(1);
  });
}
