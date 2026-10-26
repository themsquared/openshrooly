import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { ADMIN_SQL } from "../src/admin-sql.js";
import { handleAdmin } from "../src/admin.js";
import { sha256Hex } from "../src/crypto.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const statements = (sql) => sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);

test("every admin statement runs on real D1 and the routes answer", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
  try {
    const d1 = await mf.getD1Database("DB");
    for (const s of statements(schema)) await d1.prepare(s).run();
    const raw = createD1Db(d1);
    const seen = new Set();
    const wrap = (fn) => async (sql, params) => {
      seen.add(sql);
      return fn(sql, params);
    };
    const db = { ...raw, all: wrap(raw.all), one: wrap(raw.one), run: wrap(raw.run) };
    const now = new Date().toISOString();
    await raw.run("INSERT INTO users (id, username, password_hash, email, created_at) VALUES (82, 'boss', 'x', 'b@example.com', ?)", [now]);
    await raw.run("INSERT INTO users (id, username, password_hash, email, created_at) VALUES (2, 'grower', 'x', 'g@example.com', ?)", [now]);
    await raw.run("INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, last_seen_at, created_at) VALUES ('d1', 'A1B2C3D4E5F6', '{}', 'Kitchen', 'active', 2, ?, ?)", [now, now]);
    await raw.run("INSERT INTO security_events (user_id, kind, detail, created_at) VALUES (2, 'device_claim', 'd1', ?)", [now]);
    await raw.run("INSERT INTO coach_cache (cache_key, value, expires_at) VALUES (?, ?, ?)", [`jev:device:d1:${now.slice(0, 10)}`, '{"calls":3,"tokens":0}', now]);
    await raw.run("INSERT INTO checkouts (id, user_id, item_id, provider, status, amount_cents, details, created_at) VALUES ('cs_test_x', 2, 'grow-coach', 'stripe', 'paid', 499, '{}', ?)", [now]);
    await raw.run("INSERT INTO alerts (user_id, device_id, rule, kind, episode_key, dedupe_key, title, detail, status, created_at) VALUES (2, 'd1', 'temp', 'open', 'e', 'k1', 't', 'd', 'sent', ?)", [now]);
    await raw.run("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 4, '0')", [`email-cap:all:${now.slice(0, 10)}`]);

    const cutoff = new Date(Date.now() - 31 * 86400000).toISOString();
    for (const [name, sql] of Object.entries(ADMIN_SQL)) {
      const rows = await db.all(sql, sql.includes("?") ? [name === "coachUsage" ? cutoff.slice(0, 10) : cutoff] : []);
      assert.ok(Array.isArray(rows), name);
    }

    // Drive the handlers with a bearer token for user 82, the default admin.
    await raw.run("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (82, 'test', ?, ?)", [await sha256Hex("tok"), now]);
    const env = { db };
    for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/devices", "/api/admin/activations", "/api/admin/spend"]) {
      const req = new Request(`http://test${path}`, { headers: { authorization: "Bearer tok" } });
      const res = await handleAdmin("GET", path, new URL(req.url), req, env);
      assert.equal(res.status, 200, path);
      const body = await res.json();
      if (path.endsWith("spend")) {
        assert.equal(body.users.find((u) => u.user_id === 2).jev_calls.today, 3);
        assert.equal(body.emails_sent_today_all, 4);
      }
      if (path.endsWith("overview")) assert.equal(body.chambers.linked, 1);
      const anon = new Request(`http://test${path}`);
      assert.equal((await handleAdmin("GET", path, new URL(anon.url), anon, env)).status, 404);
    }
    for (const sql of Object.values(ADMIN_SQL)) assert.ok(seen.has(sql), `not exercised: ${sql}`);
  } finally {
    await mf.dispose();
  }
});
