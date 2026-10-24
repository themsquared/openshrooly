import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, register, testEnv } from "./helpers.js";
import {
  applyPackRules,
  canConfirmCulinary,
  classifyTaxon,
  isPsilocybin,
  PSILOCYBIN_LEGAL_NOTICE,
  serveProfileDocument,
} from "../src/profile-schema.js";
import { RECLASS_STATE_KEY, reclassifyUnconfirmedLegacyBatch } from "../src/review.js";
import { handleRequest } from "../src/handlers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pearl = JSON.parse(readFileSync(join(root, "data/profiles/culinary/pearl-oyster.json"), "utf8"));
const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

function draftFrom(base, id) {
  const doc = structuredClone(base);
  doc.id = id;
  doc.name = `${base.name} ${id}`;
  doc.author = "grower";
  return doc;
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function makeModerator(ctx, email) {
  const session = await register(ctx, email);
  await ctx.db.run("UPDATE users SET role=? WHERE id=?", ["moderator", session.user.id]);
  return session;
}

async function queueProfile(ctx, { token, doc, title }) {
  const created = await call(ctx, "POST", "/api/profiles", { token, body: doc });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  await call(ctx, "POST", `/api/profiles/${doc.id}/photos`, {
    token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  return call(ctx, "POST", `/api/profiles/${doc.id}/publish`, {
    token,
    body: { title: title || doc.name, description: "Review copy" },
  });
}

const CONFIRM_REFUSE = [
  ["c-psi", "Psilocybe"],
  ["c-psp", "Psilocybe sp."],
  ["c-pan", "Panaeolus sp."],
  ["c-cope", "Copelandia"],
  ["c-ino", "Inocybe sp."],
  ["c-psylo", "Psylocybe"],
  ["c-cyr", "Псилоцибе кубенсис"],
  ["c-amuscaria", "Amanita muscaria"],
  ["c-agcub", "Agaricus cubensis"],
];

const IDENTITY_PSYCHO = [
  { id: "r6-name-psp", species: "Agaricus bisporus", name: "Psilocybe sp." },
  { id: "r6-strain-psi", species: "Agaricus bisporus", strain: "Psilocybe" },
  { id: "r6-magic", species: "Pleurotus ostreatus", name: "Magic mushrooms" },
  { id: "r6-cubes", species: "Agaricus bisporus", variety_group: "cubes" },
  { id: "r6-title", species: "Agaricus bisporus", title: "Psilocybin tek" },
  { id: "r6-ag-psi", species: "Agaricus psilocybe" },
  { id: "r6-amanita", species: "Agaricus bisporus", strain: "Amanita" },
  { id: "r6-galerina", species: "Pleurotus galerina" },
];

const IDENTITY_HOLD = [
  { id: "i-strain", species: "Agaricus bisporus", strain: "cubensis" },
  { id: "i-vg", species: "Agaricus bisporus", variety_group: "cubensis" },
  { id: "i-name", species: "Agaricus bisporus", name: "Agaricus cubensis" },
  { id: "i-cyan", species: "Agaricus bisporus", strain: "Pleurotus cyanescens" },
  { id: "i-id", species: "Agaricus bisporus", profileId: "agaricus-cubensis" },
  { id: "i-hyphen", species: "Agaricus cuben-sis" },
  { id: "i-space", species: "Agaricus cuben sis" },
  { id: "i-z", species: "Agaricus cubenzis" },
  { id: "i-cyan-hyphen", species: "Pleurotus cyan-escens" },
  { id: "i-semi", species: "Pleurotus semilanceatus" },
];

test("M1 live5-confirm taxa cannot be confirmed culinary", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "m1-alice@example.com");
  const mod = await makeModerator(ctx, "m1-mod@example.com");
  for (const [id, species] of CONFIRM_REFUSE) {
    const doc = draftFrom(pearl, id);
    doc.species = species;
    doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
    doc.allowed_payment_providers = ["stripe"];
    const classified = classifyTaxon(doc);
    assert.equal(classified.culinary, false, species);
    assert.equal(canConfirmCulinary(doc), false, species);
    assert.throws(() => applyPackRules(doc, { moderatorPack: "culinary" }), /cannot be confirmed as culinary/, species);
    await queueProfile(ctx, { token: alice.token, doc, title: species });
    const refused = await call(ctx, "POST", `/api/moderation/${id}/approve`, {
      token: mod.token,
      body: { pack: "culinary" },
    });
    assert.equal(refused.status, 400, `${species} ${JSON.stringify(refused.data)}`);
    await call(ctx, "POST", `/api/moderation/${id}/approve`, { token: mod.token, body: {} });
    const live = await call(ctx, "GET", `/api/profiles/${id}`);
    assert.equal(live.data.profile.pack, "psilocybin", species);
    assert.ok(live.data.profile.legal_notice, species);
    assert.equal(isPsilocybin(live.data.profile), true, species);
    const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
    assert.equal(culinary.data.some((p) => p.id === id), false, species);
    const hidden = testEnv({ SHOW_PSILOCYBIN: "0", db: ctx.db, storage: ctx.storage, _seeded: true });
    const listed = await call(hidden, "GET", "/api/profiles?pack=culinary");
    assert.equal(listed.data.some((p) => p.id === id), false, `nopsi ${species}`);
    const shown = await call(hidden, "GET", `/api/profiles/${id}`);
    assert.equal(shown.status, 404, `nopsi show ${species}`);
  }
});

test("R6 identity fields classify off-menu even when species is on the allowlist", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "r6-alice@example.com");
  const mod = await makeModerator(ctx, "r6-mod@example.com");
  for (const row of IDENTITY_PSYCHO) {
    const extra = row.title ? { title: row.title } : {};
    const doc = draftFrom(pearl, row.id);
    doc.species = row.species;
    if (row.strain) doc.strain = row.strain;
    if (row.variety_group) doc.variety_group = row.variety_group;
    if (row.name) doc.name = row.name;
    doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
    doc.allowed_payment_providers = ["stripe"];
    const classified = classifyTaxon(doc, extra);
    assert.equal(classified.culinary, false, JSON.stringify(row));
    assert.equal(classified.hold || classified.force, true, JSON.stringify(row));
    assert.equal(canConfirmCulinary(doc, extra), false, JSON.stringify(row));
    const normalized = applyPackRules(doc, extra);
    assert.equal(normalized.pack, "psilocybin", JSON.stringify(row));
    await queueProfile(ctx, { token: alice.token, doc, title: row.title || doc.name });
    const approved = await call(ctx, "POST", `/api/moderation/${row.id}/approve`, { token: mod.token, body: {} });
    assert.equal(approved.status, 200, JSON.stringify({ row, data: approved.data }));
    const live = await call(ctx, "GET", `/api/profiles/${row.id}`);
    assert.equal(live.data.profile.pack, "psilocybin", row.id);
    const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
    assert.equal(culinary.data.some((p) => p.id === row.id), false, row.id);
  }
});

test("M2 restricted names outside species hold and never publish as culinary", () => {
  for (const row of IDENTITY_HOLD) {
    const doc = draftFrom(pearl, row.profileId || row.id);
    doc.species = row.species;
    if (row.strain) doc.strain = row.strain;
    if (row.variety_group) doc.variety_group = row.variety_group;
    if (row.name) doc.name = row.name;
    doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
    doc.allowed_payment_providers = ["stripe"];
    const classified = classifyTaxon(doc);
    assert.equal(classified.culinary, false, JSON.stringify(row));
    assert.equal(classified.hold || classified.force, true, JSON.stringify(row));
    const normalized = applyPackRules(doc);
    assert.equal(normalized.pack, "psilocybin", JSON.stringify(row));
    assert.equal(normalized.legal_notice, PSILOCYBIN_LEGAL_NOTICE, JSON.stringify(row));
    const served = serveProfileDocument(doc);
    assert.equal(served.pack, "psilocybin", JSON.stringify(row));
    assert.equal(canConfirmCulinary(doc), false, JSON.stringify(row));
  }
});

test("S1 vetted edibles stay culinary and keep pricing; confirmable holds keep price", () => {
  for (const species of [
    "Morchella esculenta",
    "Tremella fuciformis",
    "Volvariella volvacea",
    "Coprinus comatus",
    "Laetiporus sulphureus",
    "Sparassis crispa",
  ]) {
    const doc = draftFrom(pearl, `s1-${species.split(" ")[0].toLowerCase()}`);
    doc.species = species;
    doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
    doc.allowed_payment_providers = ["stripe"];
    const classified = classifyTaxon(doc);
    assert.equal(classified.culinary, true, species);
    const normalized = applyPackRules(doc);
    assert.equal(normalized.pack, "culinary", species);
    assert.equal(normalized.pricing.kind, "paid", species);
  }
  const held = draftFrom(pearl, "s1-agaricus-sp");
  held.species = "Agaricus sp.";
  held.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  held.allowed_payment_providers = ["stripe"];
  assert.equal(classifyTaxon(held).hold, true);
  assert.equal(canConfirmCulinary(held), true);
  const waiting = applyPackRules(held);
  assert.equal(waiting.pack, "psilocybin");
  assert.equal(waiting.pricing.kind, "free");
  assert.equal(waiting.pricing_before_hold.kind, "paid");
  const confirmed = applyPackRules(waiting, { moderatorPack: "culinary" });
  assert.equal(confirmed.pack, "culinary");
  assert.equal(confirmed.pricing.kind, "paid");
});

test("S2 system tags do not raise a restricted-name reason", () => {
  const held = draftFrom(pearl, "s2-morel");
  held.species = "Agaricus sp.";
  const tagged = applyPackRules(held);
  const classified = classifyTaxon(tagged);
  assert.equal(classified.proseFlag, false);
  assert.equal(classified.reasons.some((reason) => /mention a restricted name/i.test(reason)), false);
});

test("M3 legacy rows without a confirm marker are reclassified; confirmed rows stay", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "m3-alice@example.com");
  for (const [id, species] of [
    ["lg-psp", "Psilocybe sp."],
    ["lg-agcub", "Agaricus cubensis"],
    ["lg-amuscaria", "Amanita muscaria"],
  ]) {
    const doc = draftFrom(pearl, id);
    doc.species = species;
    doc.pack = "culinary";
    doc.restricted = false;
    doc.legal_notice = null;
    await ctx.db.run(
      "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, JSON.stringify(doc), alice.user.id, 1, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
    );
    const served = await call(ctx, "GET", `/api/profiles/${id}`);
    assert.equal(served.data.profile.pack, "psilocybin", id);
    assert.ok(served.data.profile.legal_notice, id);
  }
  const batch = await reclassifyUnconfirmedLegacyBatch(ctx.db, { limit: 25 });
  assert.equal(batch.done, true);
  assert.ok(batch.rewritten >= 3);
  for (const id of ["lg-psp", "lg-agcub", "lg-amuscaria"]) {
    const row = await ctx.db.one("SELECT * FROM profiles WHERE id=?", [id]);
    const stored = JSON.parse(row.document);
    assert.equal(stored.pack, "psilocybin", id);
    const review = await ctx.db.one("SELECT * FROM profile_review WHERE profile_id=?", [id]);
    assert.equal(review.confirmed_culinary_at, null);
  }
  const again = await reclassifyUnconfirmedLegacyBatch(ctx.db, { limit: 25 });
  assert.equal(again.done, true);
  assert.equal(again.scanned, 0);
});

test("M3 confirm writes the marker and owner edits keep culinary unless the taxon changes", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "m3c-alice@example.com");
  const mod = await makeModerator(ctx, "m3c-mod@example.com");
  const doc = draftFrom(pearl, "m3-agaricus-sp");
  doc.species = "Agaricus sp.";
  doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  doc.allowed_payment_providers = ["stripe"];
  await queueProfile(ctx, { token: alice.token, doc, title: "Agaricus" });
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.id === "m3-agaricus-sp");
  assert.equal(item.review.can_confirm_culinary, true);
  const confirmed = await call(ctx, "POST", "/api/moderation/m3-agaricus-sp/approve", {
    token: mod.token,
    body: { pack: "culinary" },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const review = await ctx.db.one("SELECT * FROM profile_review WHERE profile_id=?", ["m3-agaricus-sp"]);
  assert.ok(review.confirmed_culinary_at);
  assert.equal(Number(review.confirmed_by), Number(mod.user.id));
  const live = await call(ctx, "GET", "/api/profiles/m3-agaricus-sp");
  assert.equal(live.data.profile.pack, "culinary");
  assert.equal(live.data.profile.pricing.kind, "paid");
  const edited = structuredClone(doc);
  edited.notes = "Owner tweak";
  const put = await call(ctx, "PUT", "/api/profiles/m3-agaricus-sp", { token: alice.token, body: edited });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.profile.pack, "culinary");
  const flipped = structuredClone(edited);
  flipped.species = "Agaricus cubensis";
  const put2 = await call(ctx, "PUT", "/api/profiles/m3-agaricus-sp", { token: alice.token, body: flipped });
  assert.equal(put2.status, 200, JSON.stringify(put2.data));
  assert.equal(put2.data.profile.pack, "psilocybin");
});

test("R6 reclass cursor version reruns after a v1 done marker", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "r6-reclass@example.com");
  const doc = draftFrom(pearl, "r6-magic-legacy");
  doc.species = "Pleurotus ostreatus";
  doc.name = "Magic mushrooms";
  doc.pack = "culinary";
  doc.restricted = false;
  const stamped = "2024-01-01T00:00:00.000Z";
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["r6-magic-legacy", JSON.stringify(doc), alice.user.id, 1, stamped, stamped]
  );
  await ctx.db.run("INSERT INTO maintenance_state (key, value, updated_at) VALUES (?, ?, ?)", [
    "legacy_reclassify",
    "done",
    stamped,
  ]);
  const clean = draftFrom(pearl, "r6-clean-oyster");
  clean.species = "Pleurotus ostreatus";
  clean.name = "Pearl Oyster";
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["r6-clean-oyster", JSON.stringify(clean), alice.user.id, 1, stamped, stamped]
  );
  const batch = await reclassifyUnconfirmedLegacyBatch(ctx.db, { limit: 10 });
  assert.equal(batch.done, true);
  const rewritten = JSON.parse((await ctx.db.one("SELECT * FROM profiles WHERE id=?", ["r6-magic-legacy"])).document);
  assert.equal(rewritten.pack, "psilocybin");
  const cleanRow = await ctx.db.one("SELECT * FROM profiles WHERE id=?", ["r6-clean-oyster"]);
  assert.equal(JSON.parse(cleanRow.document).pack, "culinary");
  assert.equal(cleanRow.updated_at, stamped);
  const state = await ctx.db.one("SELECT * FROM maintenance_state WHERE key=?", [RECLASS_STATE_KEY]);
  assert.equal(state.value, "done");
});

test("M4 request path does not run legacy reclassification", async () => {
  const src = readFileSync(new URL("../src/handlers.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /backfillLegacyReviews|reclassifyUnconfirmedLegacyBatch/);
  assert.match(worker, /legacy_reclass_failed/);
  assert.doesNotMatch(worker, /limit:\s*25/);
  const ctx = testEnv();
  const alice = await register(ctx, "m4-alice@example.com");
  const doc = draftFrom(pearl, "lg-norev");
  doc.species = "Psilocybe cubensis";
  doc.pack = "culinary";
  doc.restricted = false;
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["lg-norev", JSON.stringify(doc), alice.user.id, 1, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
  );
  let queries = 0;
  const orig = { all: ctx.db.all.bind(ctx.db), one: ctx.db.one.bind(ctx.db), run: ctx.db.run.bind(ctx.db) };
  ctx.db.all = (...args) => {
    queries += 1;
    return orig.all(...args);
  };
  ctx.db.one = (...args) => {
    queries += 1;
    return orig.one(...args);
  };
  ctx.db.run = (...args) => {
    queries += 1;
    return orig.run(...args);
  };
  ctx._seeded = true;
  await handleRequest(new Request("http://test/api/profiles?pack=culinary"), ctx);
  const stored = JSON.parse((await orig.one("SELECT * FROM profiles WHERE id=?", ["lg-norev"])).document);
  assert.equal(stored.pack, "culinary");
  assert.ok(queries > 0);
});

test("S4 malformed profile JSON is skipped instead of 500", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "s4-alice@example.com");
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["bad-json", "{not-json", alice.user.id, 1, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
  );
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.some((p) => p.id === "bad-json"), false);
});

test("S5 confirm button is only in the can_confirm_culinary branch", () => {
  const queue = readFileSync(join(root, "community/web/public/js/moderate-queue.js"), "utf8");
  assert.match(queue, /can_confirm_culinary \? `[\s\S]*Confirm culinary/);
});
