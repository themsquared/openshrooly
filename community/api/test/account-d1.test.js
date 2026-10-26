import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { ACCOUNT_SQL } from "../src/account-sql.js";
import { buildExport, deleteAccount } from "../src/account.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const statements = (sql) => sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);

test("account export and delete run on real D1 with foreign keys", async () => {
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
    const add = (sql, params) => raw.run(sql, params);
    await add("INSERT INTO users (id, username, password_hash, email, created_at) VALUES (1, 'gone', 'x', 'g@example.com', ?)", [now]);
    await add("INSERT INTO users (id, username, password_hash, email, created_at) VALUES (2, 'stays', 'x', 's@example.com', ?)", [now]);
    await add("INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, created_at) VALUES ('d1', 'hw1#abc', '{}', 'Kitchen', 'active', 1, ?)", [now]);
    await add("INSERT INTO device_telemetry (device_id, document, created_at) VALUES ('d1', '{}', ?)", [now]);
    await add("INSERT INTO alerts (user_id, device_id, rule, kind, episode_key, dedupe_key, title, detail, status, created_at) VALUES (1, 'd1', 'temp', 'open', 'e', 'k1', 't', 'd', 'sent', ?)", [now]);
    await add("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES ('mine', '{\"id\":\"mine\"}', 1, 1, ?, ?)", [now, now]);
    await add("INSERT INTO ratings (user_id, profile_id, stars, created_at) VALUES (2, 'mine', 5, ?)", [now]);
    await add("INSERT INTO profile_review (profile_id, status, created_at, updated_at) VALUES ('mine', 'published', ?, ?)", [now, now]);
    await add("INSERT INTO sessions (user_id, session_hash, expires_at, created_at) VALUES (1, 'h1', ?, ?)", [now, now]);
    await add("INSERT INTO device_groups (id, owner_id, name, created_at, updated_at) VALUES (7, 1, 'Shelf', ?, ?)", [now, now]);
    await add("INSERT INTO device_group_members (group_id, device_id, added_at) VALUES (7, 'd1', ?)", [now]);

    const user = await raw.one("SELECT * FROM users WHERE id=1");
    const exported = await buildExport(db, user);
    assert.equal(exported.chambers[0].hardware_id, "hw1");
    assert.equal(exported.profiles[0].id, "mine");
    assert.deepEqual(exported.chamber_groups[0].devices, ["d1"]);

    assert.equal(await db.one(ACCOUNT_SQL.tokenByHash, ["nope"]), null);
    await deleteAccount({ db, storage: null }, db, user);
    assert.equal(await raw.one("SELECT * FROM users WHERE id=1"), null);
    assert.ok(await raw.one("SELECT * FROM users WHERE id=2"));
    const device = await raw.one("SELECT * FROM cloud_devices WHERE id='d1'");
    assert.equal(device.status, "revoked");
    assert.equal(device.owner_id, null);
    for (const table of ["device_telemetry", "alerts", "profiles", "ratings", "profile_review", "sessions", "device_groups", "device_group_members"]) {
      const { n } = await raw.one(`SELECT COUNT(*) AS n FROM ${table}`);
      assert.equal(n, 0, table);
    }
    const unused = Object.values(ACCOUNT_SQL).filter((sql) => !seen.has(sql));
    assert.deepEqual(unused, [], "every account statement ran on D1");
  } finally {
    await mf.dispose();
  }
});
