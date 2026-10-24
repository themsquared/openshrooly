import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { sha256Hex, totpAt } from "../src/crypto.js";
import { call, testEnv } from "./helpers.js";

function prodSchema() {
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  assert.match(sql, /totp_recovery_codes/, "schema.sql is missing recovery codes");
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function withProdD1(fn) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  try {
    const d1 = await mf.getD1Database("DB");
    for (const s of prodSchema()) await d1.prepare(s).run();
    await fn(d1, testEnv({ db: createD1Db(d1) }));
  } finally {
    await mf.dispose();
  }
}

let magicN = 0;

async function signIn(d1, ctx, email) {
  magicN += 1;
  const token = `tok-${email}-${magicN}`;
  const expires = new Date(Date.now() + 15 * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  await d1
    .prepare("INSERT INTO magic_links (email, token_hash, purpose, expires_at, created_at) VALUES (?, ?, 'login', ?, ?)")
    .bind(email, await sha256Hex(token), expires, "2026-01-01T00:00:00Z")
    .run();
  const res = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token } });
  if (res.data?.totp_required) return { ...res.data, status: res.status };
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { ...res.data, token: res.data.access_token, user: res.data.user, status: res.status };
}

async function enableTotp(ctx, token) {
  const begin = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  assert.equal(begin.status, 200, JSON.stringify(begin.data));
  const now = Number(ctx.NOW_MS) || Date.now();
  const code = await totpAt(begin.data.secret, Math.floor(now / 30_000));
  const ok = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return { secret: begin.data.secret, recovery: ok.data.recovery_codes };
}

test("D1 TOTP enable, verify, recovery single use, disable, and rate limit", async () => {
  await withProdD1(async (d1, ctx) => {
    const t0 = Date.now();
    ctx.NOW_MS = t0;
    const { token, user } = await signIn(d1, ctx, "d1-totp@example.com");
    const before = await call(ctx, "GET", "/api/me", { token });
    assert.equal(before.data.user.totp_enabled, false);
    assert.equal(before.data.user.totp_recovery_remaining, 0);

    const { secret, recovery } = await enableTotp(ctx, token);
    assert.equal(recovery.length, 10);
    const stored = await d1.prepare("SELECT totp_enabled, totp_secret_enc FROM users WHERE id=?").bind(user.id).first();
    assert.equal(Number(stored.totp_enabled), 1);
    assert.match(stored.totp_secret_enc, /^aesgcm\$/);
    const hashed = await d1.prepare("SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id=?").bind(user.id).first();
    assert.equal(Number(hashed.n), 10);

    ctx.NOW_MS = t0 + 30_000;
    const pending = await signIn(d1, ctx, "d1-totp@example.com");
    assert.equal(pending.totp_required, true);
    assert.ok(pending.totp_token);

    const code = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));
    const verified = await call(ctx, "POST", "/api/auth/totp/verify", {
      body: { totp_token: pending.totp_token, code },
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.ok(verified.data.access_token);

    const pending2 = await signIn(d1, ctx, "d1-totp@example.com");
    const recovered = await call(ctx, "POST", "/api/auth/totp/verify", {
      body: { totp_token: pending2.totp_token, code: recovery[0] },
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));

    const pending3 = await signIn(d1, ctx, "d1-totp@example.com");
    const reused = await call(ctx, "POST", "/api/auth/totp/verify", {
      body: { totp_token: pending3.totp_token, code: recovery[0] },
    });
    assert.equal(reused.status, 401);
    assert.equal(reused.data.error, "That code did not work.");

    const off = await call(ctx, "POST", "/api/auth/totp/disable", { token, body: { code: recovery[1] } });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    const leftover = await d1.prepare("SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id=?").bind(user.id).first();
    assert.equal(Number(leftover.n), 0);
    const me = await call(ctx, "GET", "/api/me", { token });
    assert.equal(me.data.user.totp_enabled, false);
  });
});

test("D1 TOTP verify is rate limited", async () => {
  await withProdD1(async (d1, ctx) => {
    const { token } = await signIn(d1, ctx, "d1-limit@example.com");
    await enableTotp(ctx, token);
    const pending = await signIn(d1, ctx, "d1-limit@example.com");
    assert.equal(pending.totp_required, true);
    let last;
    for (let i = 0; i < 9; i += 1) {
      last = await call(ctx, "POST", "/api/auth/totp/verify", {
        body: { totp_token: pending.totp_token, code: "000000" },
      });
    }
    assert.equal(last.status, 429);
    assert.equal(last.data.error, "Too many attempts. Try again later.");
  });
});
