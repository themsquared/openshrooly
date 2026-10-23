/** Portable SQL access: D1 on Cloudflare, in-memory SQLite-shaped store for tests/local. */

import { nowIso } from "./crypto.js";

export function createMemoryDb() {
  const tables = {
    users: [],
    api_tokens: [],
    profiles: [],
    ratings: [],
    grow_reports: [],
    entitlements: [],
    checkouts: [],
    affiliate_clicks: [],
    guides: [],
  };
  let ids = { users: 1, api_tokens: 1, grow_reports: 1, affiliate_clicks: 1 };

  return {
    driver: "memory",
    async exec() {
      return;
    },
    async all(sql, params = []) {
      return dispatch("all", tables, ids, sql, params);
    },
    async one(sql, params = []) {
      const rows = await dispatch("all", tables, ids, sql, params);
      return rows[0] || null;
    },
    async run(sql, params = []) {
      return dispatch("run", tables, ids, sql, params);
    },
  };
}

export function createD1Db(d1) {
  return {
    driver: "d1",
    async exec(sql) {
      await d1.exec(sql);
    },
    async all(sql, params = []) {
      const stmt = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const result = await stmt.all();
      return result.results || [];
    },
    async one(sql, params = []) {
      const stmt = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      return (await stmt.first()) || null;
    },
    async run(sql, params = []) {
      const stmt = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      return stmt.run();
    },
  };
}

function dispatch(mode, tables, ids, sql, params) {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q.startsWith("INSERT INTO users")) {
    const row = { id: ids.users++, username: params[0], password_hash: params[1], created_at: params[2] };
    if (tables.users.some((u) => u.username === row.username)) throw new Error("UNIQUE");
    tables.users.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM users WHERE username=")) {
    return tables.users.filter((u) => u.username === params[0]);
  }
  if (q.startsWith("SELECT * FROM users WHERE id=")) {
    return tables.users.filter((u) => u.id === Number(params[0]));
  }
  if (q.startsWith("INSERT INTO api_tokens")) {
    const row = {
      id: ids.api_tokens++,
      user_id: params[0],
      name: params[1],
      token_hash: params[2],
      created_at: params[3],
    };
    tables.api_tokens.push(row);
    return { lastRowId: row.id };
  }
  if (q.includes("FROM users JOIN api_tokens")) {
    const token = tables.api_tokens.find((t) => t.token_hash === params[0]);
    if (!token) return [];
    return tables.users.filter((u) => u.id === token.user_id);
  }
  if (q.startsWith("SELECT id, name, created_at FROM api_tokens")) {
    return tables.api_tokens.filter((t) => t.user_id === Number(params[0])).map(({ token_hash, ...rest }) => rest);
  }
  if (q.startsWith("INSERT INTO profiles") || q.startsWith("INSERT OR REPLACE INTO profiles")) {
    const row = {
      id: params[0],
      document: params[1],
      author_id: params[2],
      published: 1,
      created_at: params[3],
      updated_at: params[4],
      downloads: 0,
    };
    const idx = tables.profiles.findIndex((p) => p.id === row.id);
    if (idx >= 0) {
      tables.profiles[idx] = { ...tables.profiles[idx], document: row.document, updated_at: row.updated_at };
    } else {
      tables.profiles.push(row);
    }
    return {};
  }
  if (q.startsWith("SELECT * FROM profiles WHERE id=")) {
    return tables.profiles.filter((p) => p.id === params[0]);
  }
  if (q.startsWith("SELECT document FROM profiles") || q.startsWith("SELECT * FROM profiles WHERE published")) {
    return tables.profiles.filter((p) => p.published);
  }
  if (q.startsWith("UPDATE profiles SET downloads")) {
    const row = tables.profiles.find((p) => p.id === params[0]);
    if (row) row.downloads += 1;
    return {};
  }
  if (q.startsWith("INSERT INTO ratings") || q.startsWith("INSERT OR REPLACE INTO ratings")) {
    tables.ratings = tables.ratings.filter((r) => !(r.user_id === params[0] && r.profile_id === params[1]));
    tables.ratings.push({
      user_id: params[0],
      profile_id: params[1],
      stars: params[2],
      comment: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.includes("FROM ratings") && q.includes("JOIN users")) {
    return tables.ratings
      .filter((r) => r.profile_id === params[0])
      .map((r) => ({ ...r, username: tables.users.find((u) => u.id === r.user_id)?.username || "user" }));
  }
  if (q.startsWith("SELECT AVG(stars)")) {
    const rows = tables.ratings.filter((r) => r.profile_id === params[0]);
    if (!rows.length) return [{ a: null }];
    return [{ a: rows.reduce((s, r) => s + r.stars, 0) / rows.length }];
  }
  if (q.startsWith("INSERT INTO grow_reports")) {
    const row = {
      id: ids.grow_reports++,
      profile_id: params[0],
      author_id: params[1],
      outcome: params[2],
      notes: params[3],
      days: params[4],
      flushes: params[5],
      device_name: params[6],
      photo_key: params[7],
      created_at: params[8],
    };
    tables.grow_reports.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM grow_reports")) {
    return tables.grow_reports.filter((r) => r.profile_id === params[0]).reverse();
  }
  if (q.startsWith("INSERT OR IGNORE INTO entitlements") || q.startsWith("INSERT INTO entitlements")) {
    if (!tables.entitlements.some((e) => e.user_id === params[0] && e.item_id === params[1])) {
      tables.entitlements.push({
        user_id: params[0],
        item_id: params[1],
        item_type: params[2],
        granted_at: params[3] || nowIso(),
      });
    }
    return {};
  }
  if (q.startsWith("SELECT 1 FROM entitlements") || q.startsWith("SELECT * FROM entitlements WHERE user_id=? AND item_id=")) {
    return tables.entitlements.filter((e) => e.user_id === Number(params[0]) && e.item_id === params[1]);
  }
  if (q.startsWith("SELECT * FROM entitlements WHERE user_id=")) {
    return tables.entitlements.filter((e) => e.user_id === Number(params[0]));
  }
  if (q.startsWith("INSERT INTO checkouts")) {
    tables.checkouts.push({
      id: params[0],
      user_id: params[1],
      item_id: params[2],
      provider: params[3],
      status: params[4],
      amount_cents: params[5],
      details: params[6],
      created_at: params[7],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM checkouts WHERE id=")) {
    return tables.checkouts.filter((c) => c.id === params[0]);
  }
  if (q.startsWith("UPDATE checkouts SET status=")) {
    const row = tables.checkouts.find((c) => c.id === params[1]);
    if (row) row.status = params[0];
    return {};
  }
  if (q.startsWith("INSERT INTO affiliate_clicks")) {
    tables.affiliate_clicks.push({
      id: ids.affiliate_clicks++,
      link_id: params[0],
      profile_id: params[1],
      user_id: params[2],
      destination: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("INSERT INTO guides")) {
    tables.guides.push({
      id: params[0],
      title: params[1],
      body: params[2],
      pricing: params[3],
      allowed_payment_providers: params[4],
      created_at: params[5],
    });
    return {};
  }
  if (q.startsWith("SELECT COUNT(*) AS n FROM guides") || q.startsWith("SELECT COUNT(*) as n FROM guides")) {
    return [{ n: tables.guides.length }];
  }
  if (q.startsWith("SELECT * FROM guides")) {
    return tables.guides;
  }
  if (mode === "run") return {};
  return [];
}

export async function seedIfEmpty(db, profiles) {
  const existing = await db.one("SELECT * FROM profiles WHERE published=1");
  if (existing) return;
  const ts = nowIso();
  for (const profile of profiles) {
    await db.run(
      "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      [profile.id, JSON.stringify(profile), null, ts, ts]
    );
  }
  const guides = await db.one("SELECT COUNT(*) AS n FROM guides");
  if (!guides || !guides.n) {
    await db.run(
      "INSERT INTO guides (id, title, body, pricing, allowed_payment_providers, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "block-prep-101",
        "Hardwood block prep (premium guide stub)",
        "Stub grow guide. $3.99 demo item routed through the Stripe stub.",
        JSON.stringify({ kind: "paid", amount_cents: 399, currency: "USD", creator_share_percent: 70 }),
        JSON.stringify(["stripe"]),
        ts,
      ]
    );
  }
}
