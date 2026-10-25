/** Portable SQL access: D1 on Cloudflare, in-memory SQLite-shaped store for tests/local. */

import { nowIso } from "./crypto.js";
import { dispatchAlerts } from "./alerts/memory.js";
import { dispatchReview } from "./review-memory.js";

export function createMemoryDb() {
  const tables = {
    users: [],
    api_tokens: [],
    profiles: [],
    ratings: [],
    grow_reports: [],
    uploaded_media: [],
    entitlements: [],
    checkouts: [],
    affiliate_clicks: [],
    guides: [],
    auth_identities: [],
    sessions: [],
    refresh_tokens: [],
    magic_links: [],
    webauthn_credentials: [],
    webauthn_challenges: [],
    oauth_states: [],
    security_events: [],
    rate_limits: [],
    cloud_devices: [],
    device_certs: [],
    device_commands: [],
    device_telemetry: [],
    device_nonces: [],
    coach_subs: [],
    coach_usage: [],
    coach_cache: [],
    coach_device_mode: [],
    coach_autopilot_log: [],
    device_groups: [],
    device_group_members: [],
    fleet_audit: [],
    totp_pending: [],
    payment_events: [],
    profile_review: [],
    profile_photos: [],
    moderation_log: [],
    profile_reports: [],
    maintenance_state: [],
  };
  let ids = {
    users: 1,
    api_tokens: 1,
    grow_reports: 1,
    affiliate_clicks: 1,
    auth_identities: 1,
    sessions: 1,
    refresh_tokens: 1,
    magic_links: 1,
    webauthn_credentials: 1,
    webauthn_challenges: 1,
    oauth_states: 1,
    security_events: 1,
    device_certs: 1,
    device_commands: 1,
    device_telemetry: 1,
    coach_autopilot_log: 1,
    device_groups: 1,
    fleet_audit: 1,
    profile_photos: 1,
    moderation_log: 1,
    profile_reports: 1,
  };

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
    async batch(statements = []) {
      const results = [];
      for (const statement of statements) {
        results.push(await dispatch("run", tables, ids, statement.sql, statement.params || []));
      }
      return results;
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
    async batch(statements = []) {
      const prepared = statements.map((statement) =>
        statement.params?.length ? d1.prepare(statement.sql).bind(...statement.params) : d1.prepare(statement.sql)
      );
      return d1.batch(prepared);
    },
  };
}

function dispatch(mode, tables, ids, sql, params) {
  const q = sql.replace(/\s+/g, " ").trim();
  const alertResult = dispatchAlerts(tables, ids, q, params);
  if (alertResult !== undefined) return alertResult;
  const reviewResult = dispatchReview(tables, ids, q, params);
  if (reviewResult !== undefined) return reviewResult;
  if (q.startsWith("INSERT INTO users")) {
    const row =
      params.length >= 7
        ? {
            id: ids.users++,
            username: params[0],
            password_hash: params[1],
            email: params[2],
            email_verified: params[3],
            display_name: params[4],
            role: params[5],
            totp_secret_enc: null,
            totp_enabled: 0,
            totp_last_step: null,
            created_at: params[6],
          }
        : {
            id: ids.users++,
            username: params[0],
            password_hash: params[1],
            email: null,
            email_verified: 0,
            display_name: params[0],
            role: "user",
            totp_secret_enc: null,
            totp_enabled: 0,
            totp_last_step: null,
            created_at: params[2],
          };
    if (tables.users.some((u) => u.username === row.username)) throw new Error("UNIQUE");
    tables.users.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM users WHERE username=")) {
    return tables.users.filter((u) => u.username === params[0]);
  }
  if (q.startsWith("SELECT * FROM users WHERE email=")) {
    return tables.users.filter((u) => u.email === params[0]);
  }
  if (q.startsWith("SELECT * FROM users WHERE id=")) {
    return tables.users.filter((u) => u.id === Number(params[0]));
  }
  if (q.startsWith("UPDATE users SET role=")) {
    const row = tables.users.find((u) => Number(u.id) === Number(params[1]));
    if (row) row.role = params[0];
    return {};
  }
  if (q.startsWith("UPDATE users SET email_verified=")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    if (row) row.email_verified = params[0];
    return {};
  }
  if (q.startsWith("UPDATE users SET password_hash=")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    if (row) row.password_hash = params[0];
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_secret_enc=?, totp_enabled=?, totp_last_step=")) {
    const row = tables.users.find((u) => u.id === Number(params[3]));
    if (row) {
      row.totp_secret_enc = params[0];
      row.totp_enabled = params[1];
      row.totp_last_step = params[2];
    }
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_secret_enc=?, totp_enabled=")) {
    const row = tables.users.find((u) => u.id === Number(params[2]));
    if (row) {
      row.totp_secret_enc = params[0];
      row.totp_enabled = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_secret_enc=")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    if (row) row.totp_secret_enc = params[0];
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_enabled=?, totp_last_step=")) {
    const row = tables.users.find((u) => u.id === Number(params[2]));
    if (row) {
      row.totp_enabled = params[0];
      row.totp_last_step = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_enabled=")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    if (row) row.totp_enabled = params[0];
    return {};
  }
  if (q.startsWith("UPDATE users SET totp_last_step=? WHERE id=? AND")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    const next = Number(params[0]);
    const last = row?.totp_last_step;
    if (!row || (last != null && last !== "" && Number(last) >= next)) return { changes: 0, meta: { changes: 0 } };
    row.totp_last_step = next;
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("UPDATE users SET totp_last_step=")) {
    const row = tables.users.find((u) => u.id === Number(params[1]));
    if (row) row.totp_last_step = params[0];
    return { changes: 1 };
  }
  if (q.includes("FROM users JOIN sessions")) {
    const session = tables.sessions.find((s) => s.session_hash === params[0] && !s.revoked_at);
    if (!session) return [];
    return tables.users.filter((u) => u.id === session.user_id);
  }
  if (q.includes("FROM users JOIN refresh_tokens")) {
    const tok = tables.refresh_tokens.find((s) => s.token_hash === params[0] && !s.revoked_at);
    if (!tok) return [];
    return tables.users.filter((u) => u.id === tok.user_id);
  }
  if (q.startsWith("SELECT * FROM sessions WHERE session_hash=")) {
    return tables.sessions.filter((s) => s.session_hash === params[0]);
  }
  if (q.startsWith("SELECT id, created_at, expires_at, revoked_at, user_agent FROM sessions")) {
    return tables.sessions.filter((s) => s.user_id === Number(params[0]));
  }
  if (q.startsWith("INSERT INTO sessions")) {
    tables.sessions.push({
      id: ids.sessions++,
      user_id: params[0],
      session_hash: params[1],
      user_agent: params[2],
      ip: params[3],
      expires_at: params[4],
      revoked_at: null,
      created_at: params[5],
    });
    return {};
  }
  if (q.startsWith("INSERT INTO refresh_tokens")) {
    tables.refresh_tokens.push({
      id: ids.refresh_tokens++,
      user_id: params[0],
      token_hash: params[1],
      family: params[2],
      expires_at: params[3],
      revoked_at: null,
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM refresh_tokens WHERE token_hash=")) {
    return tables.refresh_tokens.filter((s) => s.token_hash === params[0]);
  }
  if (q.startsWith("INSERT INTO magic_links")) {
    tables.magic_links.push({
      id: ids.magic_links++,
      email: params[0],
      token_hash: params[1],
      purpose: params[2],
      expires_at: params[3],
      used_at: null,
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM magic_links WHERE token_hash=")) {
    return tables.magic_links.filter((s) => s.token_hash === params[0]);
  }
  if (q.startsWith("UPDATE magic_links SET used_at=")) {
    // used_at=?, token_hash=?, expires_at > ?, purpose=? (purpose optional)
    const row = tables.magic_links.find(
      (s) => s.token_hash === params[1] && !s.used_at && s.expires_at > params[2] && (params[3] === undefined || s.purpose === params[3])
    );
    if (row) row.used_at = params[0];
    return { meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("INSERT INTO webauthn_challenges")) {
    tables.webauthn_challenges.push({
      id: ids.webauthn_challenges++,
      challenge: params[0],
      user_id: params[1],
      purpose: params[2],
      expires_at: params[3],
      used_at: null,
    });
    return {};
  }
  if (q.startsWith("UPDATE webauthn_challenges SET used_at=? WHERE challenge=? AND used_at IS NULL AND expires_at > ?")) {
    const row = tables.webauthn_challenges.find(
      (s) => s.challenge === params[1] && !s.used_at && s.expires_at > params[2]
    );
    if (!row) return { changes: 0, meta: { changes: 0 } };
    row.used_at = params[0];
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("UPDATE webauthn_challenges SET used_at=")) {
    const row = tables.webauthn_challenges.find((s) => s.challenge === params[1] && !s.used_at);
    if (!row) return { changes: 0, meta: { changes: 0 } };
    row.used_at = params[0];
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("DELETE FROM webauthn_challenges WHERE expires_at <")) {
    tables.webauthn_challenges = tables.webauthn_challenges.filter((s) => s.expires_at >= params[0]);
    return { changes: 0, meta: { changes: 0 } };
  }
  if (q.startsWith("DELETE FROM webauthn_challenges WHERE challenge=")) {
    const before = tables.webauthn_challenges.length;
    tables.webauthn_challenges = tables.webauthn_challenges.filter((s) => s.challenge !== params[0]);
    const changes = before - tables.webauthn_challenges.length;
    return { changes, meta: { changes } };
  }
  if (q.startsWith("UPDATE webauthn_credentials SET sign_count=")) {
    const row = tables.webauthn_credentials.find((s) => s.credential_id === params[1]);
    if (row) row.sign_count = params[0];
    return {};
  }
  if (q.startsWith("INSERT INTO totp_pending")) {
    tables.totp_pending.push({
      token_hash: params[0],
      user_id: params[1],
      expires_at: params[2],
      created_at: params[3],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM totp_pending WHERE token_hash=")) {
    return tables.totp_pending.filter((s) => s.token_hash === params[0]);
  }
  if (q.startsWith("DELETE FROM totp_pending WHERE token_hash=")) {
    tables.totp_pending = tables.totp_pending.filter((s) => s.token_hash !== params[0]);
    return {};
  }
  if (q.startsWith("INSERT OR IGNORE INTO payment_events") || q.startsWith("INSERT INTO payment_events")) {
    if (!tables.payment_events.some((e) => e.event_id === params[0])) {
      tables.payment_events.push({
        event_id: params[0],
        checkout_id: params[1],
        type: params[2],
        created_at: params[3],
      });
    }
    return {};
  }
  if (q.startsWith("SELECT * FROM payment_events WHERE event_id=")) {
    return tables.payment_events.filter((e) => e.event_id === params[0]);
  }
  if (q.startsWith("SELECT * FROM webauthn_challenges WHERE challenge=? AND user_id=")) {
    return tables.webauthn_challenges.filter((s) => s.challenge === params[0] && s.user_id === Number(params[1]));
  }
  if (q.startsWith("SELECT * FROM webauthn_challenges WHERE challenge=")) {
    return tables.webauthn_challenges.filter((s) => s.challenge === params[0]);
  }
  if (q.startsWith("INSERT INTO webauthn_credentials")) {
    tables.webauthn_credentials.push({
      id: ids.webauthn_credentials++,
      user_id: params[0],
      credential_id: params[1],
      public_key: params[2],
      sign_count: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM webauthn_credentials WHERE credential_id=")) {
    return tables.webauthn_credentials.filter((s) => s.credential_id === params[0]);
  }
  if (q.startsWith("INSERT INTO oauth_states")) {
    tables.oauth_states.push({
      id: ids.oauth_states++,
      state: params[0],
      nonce: params[1],
      code_verifier: params[2],
      provider: params[3],
      redirect_to: params[4],
      expires_at: params[5],
    });
    return {};
  }
  if (q.startsWith("DELETE FROM oauth_states WHERE state=")) {
    const before = tables.oauth_states.length;
    tables.oauth_states = tables.oauth_states.filter((s) => s.state !== params[0]);
    const changes = before - tables.oauth_states.length;
    return { changes, meta: { changes } };
  }
  if (q.startsWith("DELETE FROM oauth_states WHERE expires_at <")) {
    tables.oauth_states = tables.oauth_states.filter((s) => s.expires_at >= params[0]);
    return { changes: 0, meta: { changes: 0 } };
  }
  if (q.startsWith("SELECT * FROM auth_identities WHERE provider=? AND subject=")) {
    return tables.auth_identities.filter((s) => s.provider === params[0] && s.subject === params[1]);
  }
  if (q.startsWith("SELECT * FROM auth_identities WHERE user_id=? AND provider=")) {
    return tables.auth_identities.filter((s) => Number(s.user_id) === Number(params[0]) && s.provider === params[1]);
  }
  if (q.startsWith("SELECT * FROM oauth_states WHERE state=")) {
    return tables.oauth_states.filter((s) => s.state === params[0]);
  }
  if (q.startsWith("INSERT INTO auth_identities")) {
    if (tables.auth_identities.some((s) => s.provider === params[1] && s.subject === params[2])) {
      throw new Error("UNIQUE constraint failed: auth_identities.provider, auth_identities.subject");
    }
    tables.auth_identities.push({
      id: ids.auth_identities++,
      user_id: params[0],
      provider: params[1],
      subject: params[2],
      created_at: params[3],
    });
    return {};
  }
  if (q.startsWith("INSERT INTO security_events")) {
    tables.security_events.push({
      id: ids.security_events++,
      user_id: params[0],
      kind: params[1],
      detail: params[2],
      ip: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM security_events WHERE kind=")) {
    return tables.security_events.filter((e) => e.kind === params[0]);
  }
  if (q.startsWith("SELECT * FROM security_events")) {
    return tables.security_events.slice();
  }
  if (q.startsWith("SELECT * FROM rate_limits WHERE key=")) {
    return tables.rate_limits.filter((s) => s.key === params[0]);
  }
  if (q.startsWith("INSERT INTO rate_limits") && q.includes("ON CONFLICT")) {
    const key = params[0];
    const now = Number(params[2]);
    const windowMs = Number(params[3]);
    const limit = Number(params[7]);
    const row = tables.rate_limits.find((s) => s.key === key);
    if (!row) {
      tables.rate_limits.push({ key, count: 1, window_start: String(now) });
      return { changes: 1, meta: { changes: 1 } };
    }
    const expired = now - Number(row.window_start) > windowMs;
    if (expired) {
      row.count = 1;
      row.window_start = String(now);
      return { changes: 1, meta: { changes: 1 } };
    }
    if (Number(row.count) >= limit) return { changes: 0, meta: { changes: 0 } };
    row.count = Number(row.count) + 1;
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("INSERT INTO rate_limits")) {
    tables.rate_limits.push({ key: params[0], count: params[1], window_start: params[2] });
    return {};
  }
  if (q.startsWith("UPDATE rate_limits SET count=?, window_start=")) {
    const row = tables.rate_limits.find((s) => s.key === params[2]);
    if (row) {
      row.count = params[0];
      row.window_start = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE rate_limits SET count=?")) {
    const row = tables.rate_limits.find((s) => s.key === params[1]);
    if (row) row.count = params[0];
    return {};
  }
  if (q.startsWith("UPDATE sessions SET revoked_at=? WHERE session_hash=")) {
    const row = tables.sessions.find((s) => s.session_hash === params[1]);
    if (row) row.revoked_at = params[0];
    return {};
  }
  if (q.startsWith("UPDATE sessions SET revoked_at=? WHERE user_id=")) {
    for (const row of tables.sessions.filter((s) => s.user_id === Number(params[1]))) row.revoked_at = params[0];
    return {};
  }
  if (q.startsWith("UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=")) {
    const row = tables.refresh_tokens.find((s) => s.token_hash === params[1]);
    if (row) row.revoked_at = params[0];
    return {};
  }
  if (q.startsWith("UPDATE refresh_tokens SET revoked_at=? WHERE user_id=")) {
    for (const row of tables.refresh_tokens.filter((s) => s.user_id === Number(params[1]))) row.revoked_at = params[0];
    return {};
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
  if (q.startsWith("INSERT OR IGNORE INTO profiles")) {
    if (tables.profiles.some((p) => p.id === params[0])) return {};
    tables.profiles.push({
      id: params[0],
      document: params[1],
      author_id: params[2],
      published: 1,
      created_at: params[3],
      updated_at: params[4],
      downloads: 0,
    });
    return {};
  }
  if (q.startsWith("INSERT INTO profiles") || q.startsWith("INSERT OR REPLACE INTO profiles")) {
    const publishedLiteral = /VALUES \(\?, \?, \?, 1,/.test(q);
    const row = {
      id: params[0],
      document: params[1],
      author_id: params[2],
      published: publishedLiteral ? 1 : Number(params[3] ?? 1),
      created_at: publishedLiteral ? params[3] : params[4],
      updated_at: publishedLiteral ? params[4] : params[5],
      downloads: 0,
    };
    const idx = tables.profiles.findIndex((p) => p.id === row.id);
    if (idx >= 0) {
      tables.profiles[idx] = {
        ...tables.profiles[idx],
        document: row.document,
        updated_at: row.updated_at,
        published: Number.isFinite(row.published) ? row.published : tables.profiles[idx].published,
        author_id: row.author_id ?? tables.profiles[idx].author_id,
      };
    } else {
      tables.profiles.push(row);
    }
    return {};
  }
  if (q.startsWith("SELECT * FROM profiles WHERE id=")) {
    return tables.profiles.filter((p) => p.id === params[0]);
  }
  if (q.startsWith("SELECT * FROM profiles WHERE author_id=")) {
    return tables.profiles.filter((p) => Number(p.author_id) === Number(params[0]));
  }
  if (q === "SELECT * FROM profiles" || q.startsWith("SELECT * FROM profiles ORDER")) {
    return tables.profiles;
  }
  if (q.startsWith("SELECT document FROM profiles") || q.startsWith("SELECT * FROM profiles WHERE published")) {
    let rows = tables.profiles.filter((p) => p.published);
    if (q.includes("author_id IS NOT NULL")) rows = rows.filter((p) => p.author_id != null);
    if (q.includes("id > ?")) rows = rows.filter((p) => String(p.id) > String(params[0] ?? ""));
    if (q.includes("ORDER BY id")) rows = rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (q.includes("LIMIT ?")) rows = rows.slice(0, Number(params[params.length - 1]) || rows.length);
    return rows;
  }
  if (q.startsWith("SELECT * FROM maintenance_state WHERE key=")) {
    return (tables.maintenance_state || []).filter((r) => r.key === params[0]);
  }
  if (q.startsWith("INSERT INTO maintenance_state")) {
    tables.maintenance_state ||= [];
    tables.maintenance_state.push({ key: params[0], value: params[1], updated_at: params[2] });
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("UPDATE maintenance_state SET value=")) {
    const row = (tables.maintenance_state || []).find((r) => r.key === params[2]);
    if (row) {
      row.value = params[0];
      row.updated_at = params[1];
    }
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("UPDATE profiles SET published=?, document=?")) {
    const row = tables.profiles.find((p) => p.id === params[3]);
    if (row) {
      row.published = Number(params[0]);
      row.document = params[1];
      row.updated_at = params[2];
    }
    return {};
  }
  if (q.startsWith("UPDATE profiles SET document=?")) {
    const row = tables.profiles.find((p) => p.id === params[2]);
    if (row) {
      row.document = params[0];
      row.updated_at = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE profiles SET published=")) {
    const row = tables.profiles.find((p) => p.id === params[1]);
    if (row) {
      row.published = String(q).includes("published=1") ? 1 : 0;
      row.updated_at = params[0];
    }
    return {};
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
    const hasStatus = q.includes("photo_status");
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
      photo_status: hasStatus ? params[8] : "approved",
      created_at: hasStatus ? params[9] : params[8],
    };
    tables.grow_reports.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM grow_reports WHERE author_id=")) {
    return tables.grow_reports.filter((r) => Number(r.author_id) === Number(params[0]));
  }
  if (q.startsWith("SELECT * FROM grow_reports WHERE photo_key=")) {
    return tables.grow_reports.filter((r) => r.photo_key === params[0]);
  }
  if (q.startsWith("SELECT * FROM grow_reports WHERE id=")) {
    return tables.grow_reports.filter((r) => Number(r.id) === Number(params[0]));
  }
  if (q.startsWith("SELECT * FROM grow_reports WHERE photo_status=")) {
    return tables.grow_reports.filter((r) => (r.photo_status || "approved") === params[0]).sort((a, b) => b.id - a.id);
  }
  if (q.startsWith("UPDATE grow_reports SET photo_key=")) {
    const row = tables.grow_reports.find((r) => Number(r.id) === Number(params[2]));
    if (row) {
      row.photo_key = params[0];
      row.photo_status = params[1];
    }
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("UPDATE grow_reports SET photo_status=")) {
    const row = tables.grow_reports.find((r) => Number(r.id) === Number(params[1]));
    if (row) row.photo_status = params[0];
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("INSERT INTO uploaded_media")) {
    tables.uploaded_media.push({
      photo_key: params[0],
      owner_id: params[1],
      status: params[2],
      kind: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM uploaded_media WHERE photo_key=")) {
    return tables.uploaded_media.filter((r) => r.photo_key === params[0]);
  }
  if (q.startsWith("UPDATE uploaded_media SET status=")) {
    const row = tables.uploaded_media.find((r) => r.photo_key === params[1]);
    if (row) row.status = params[0];
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("DELETE FROM uploaded_media WHERE photo_key=")) {
    const before = tables.uploaded_media.length;
    tables.uploaded_media = tables.uploaded_media.filter((r) => r.photo_key !== params[0]);
    const changes = before - tables.uploaded_media.length;
    return { changes, meta: { changes } };
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
  if (q.startsWith("INSERT OR IGNORE INTO guides")) {
    if (tables.guides.some((g) => g.id === params[0])) return {};
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
  if (q.startsWith("SELECT * FROM guides WHERE id=")) {
    return tables.guides.filter((g) => g.id === params[0]);
  }
  if (q.startsWith("SELECT * FROM guides")) {
    return tables.guides;
  }
  if (q.startsWith("INSERT INTO cloud_devices")) {
    tables.cloud_devices.push({
      id: params[0],
      hardware_id: params[1],
      public_jwk: params[2],
      name: params[3],
      status: params[4],
      owner_id: params[5],
      enroll_hash: params[6],
      claim_code_hash: params[7],
      claim_expires_at: params[8],
      cloud_enabled: params[9],
      last_seen_at: params[10],
      created_at: params[11],
      device_type: params[12] || "shrooly_chamber",
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM cloud_devices WHERE id=")) {
    return tables.cloud_devices.filter((d) => d.id === params[0]);
  }
  if (q.startsWith("SELECT * FROM cloud_devices WHERE hardware_id=")) {
    return tables.cloud_devices.filter((d) => d.hardware_id === params[0]);
  }
  if (q.startsWith("SELECT * FROM cloud_devices WHERE claim_code_hash=")) {
    return tables.cloud_devices.filter((d) => d.claim_code_hash === params[0]);
  }
  if (q.startsWith("SELECT * FROM cloud_devices WHERE owner_id=")) {
    return tables.cloud_devices.filter((d) => Number(d.owner_id) === Number(params[0]));
  }
  if (q === "UPDATE cloud_devices SET public_jwk=? WHERE id=?") {
    const row = tables.cloud_devices.find((d) => d.id === params[1]);
    if (row) row.public_jwk = params[0];
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("UPDATE cloud_devices SET enroll_hash=?, claim_code_hash=?, claim_expires_at=?, status=?")) {
    const row = tables.cloud_devices.find((d) => d.id === params[4]);
    if (row) {
      row.enroll_hash = params[0];
      row.claim_code_hash = params[1];
      row.claim_expires_at = params[2];
      row.status = params[3];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET public_jwk=")) {
    const row = tables.cloud_devices.find((d) => d.id === params[7]);
    if (row) {
      row.public_jwk = params[0];
      row.name = params[1];
      row.status = params[2];
      row.owner_id = params[3];
      row.enroll_hash = params[4];
      row.claim_code_hash = params[5];
      row.claim_expires_at = params[6];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET owner_id=?, status=?, claim_code_hash=?")) {
    const row = tables.cloud_devices.find((d) => d.id === params[3]);
    if (row) {
      row.owner_id = params[0];
      row.status = params[1];
      row.claim_code_hash = params[2];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET status=?, cloud_enabled=?, claim_code_hash=?, enroll_hash=?")) {
    const row = tables.cloud_devices.find((d) => d.id === params[4]);
    if (row) {
      row.status = params[0];
      row.cloud_enabled = params[1];
      row.claim_code_hash = params[2];
      row.enroll_hash = params[3];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET status=?, owner_id=?, cloud_enabled=?, public_jwk=?")) {
    const row = tables.cloud_devices.find((d) => d.id === params[7]);
    if (row) {
      row.status = params[0];
      row.owner_id = params[1];
      row.cloud_enabled = params[2];
      row.public_jwk = params[3];
      row.enroll_hash = params[4];
      row.claim_code_hash = params[5];
      row.claim_expires_at = params[6];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET status=?, cloud_enabled=?, enroll_hash=?")) {
    const row = tables.cloud_devices.find((d) => d.id === params[3]);
    if (row) {
      row.status = params[0];
      row.cloud_enabled = params[1];
      row.enroll_hash = params[2];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET status=?, cloud_enabled=? WHERE id=")) {
    const row = tables.cloud_devices.find((d) => d.id === params[2]);
    if (row) {
      row.status = params[0];
      row.cloud_enabled = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE cloud_devices SET name=? WHERE id=")) {
    const row = tables.cloud_devices.find((d) => d.id === params[1]);
    if (row) row.name = params[0];
    return { changes: row ? 1 : 0 };
  }
  if (q.startsWith("UPDATE cloud_devices SET last_seen_at=")) {
    const row = tables.cloud_devices.find((d) => d.id === params[1]);
    if (row) row.last_seen_at = params[0];
    return {};
  }
  if (q.startsWith("INSERT INTO device_certs")) {
    const row = {
      id: ids.device_certs++,
      device_id: params[0],
      serial: params[1],
      fingerprint: params[2],
      pem: params[3],
      issuer: params[4],
      status: params[5],
      cf_id: params[6],
      not_before: params[7],
      not_after: params[8],
      created_at: params[9],
    };
    tables.device_certs.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM device_certs WHERE serial=")) {
    return tables.device_certs.filter((c) => c.serial === params[0]);
  }
  if (q.startsWith("SELECT * FROM device_certs WHERE fingerprint=")) {
    return tables.device_certs.filter((c) => c.fingerprint === params[0]);
  }
  if (q.startsWith("SELECT * FROM device_certs WHERE device_id=")) {
    return tables.device_certs.filter((c) => c.device_id === params[0]);
  }
  if (q.startsWith("SELECT * FROM device_certs WHERE issuer=? AND status=")) {
    return tables.device_certs.filter((c) => c.issuer === params[0] && c.status === params[1]);
  }
  if (q.startsWith("UPDATE device_certs SET status=? WHERE id=")) {
    const row = tables.device_certs.find((c) => c.id === params[1]);
    if (row) row.status = params[0];
    return {};
  }
  if (q.startsWith("INSERT INTO device_commands")) {
    const row = {
      id: ids.device_commands++,
      device_id: params[0],
      kind: params[1],
      payload: params[2],
      issued_at: params[3],
      consumed_at: params[4],
    };
    tables.device_commands.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL")) {
    let rows = tables.device_commands.filter((c) => c.device_id === params[0] && !c.consumed_at);
    if (q.includes("ORDER BY id ASC")) rows = rows.slice().sort((a, b) => Number(a.id) - Number(b.id));
    if (q.includes("ORDER BY id DESC")) rows = rows.slice().sort((a, b) => Number(b.id) - Number(a.id));
    if (q.includes("LIMIT")) {
      const limit = Number(params[1] ?? params[params.length - 1]);
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    }
    return rows;
  }
  if (q.startsWith("SELECT * FROM device_commands WHERE device_id=")) {
    return tables.device_commands.filter((c) => c.device_id === params[0]);
  }
  if (q.startsWith("UPDATE device_commands SET consumed_at=?, payload=?")) {
    const row = tables.device_commands.find((c) => Number(c.id) === Number(params[2]) && c.device_id === params[3]);
    if (row) {
      row.consumed_at = params[0];
      row.payload = params[1];
    }
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("UPDATE device_commands SET consumed_at=? WHERE id=? AND device_id=?")) {
    const row = tables.device_commands.find((c) => Number(c.id) === Number(params[1]) && c.device_id === params[2]);
    if (row) row.consumed_at = params[0];
    return { changes: row ? 1 : 0, meta: { changes: row ? 1 : 0 } };
  }
  if (q.startsWith("DELETE FROM device_nonces WHERE expires_at<?")) {
    const before = tables.device_nonces.length;
    tables.device_nonces = tables.device_nonces.filter((n) => !(Number(n.expires_at) < Number(params[0])));
    const changes = before - tables.device_nonces.length;
    return { changes, meta: { changes } };
  }
  if (q.startsWith("SELECT nonce_hash FROM device_nonces WHERE device_id=? AND expires_at>?")) {
    return tables.device_nonces.filter((n) => n.device_id === params[0] && Number(n.expires_at) > Number(params[1]));
  }
  if (q.startsWith("INSERT INTO device_nonces")) {
    if (tables.device_nonces.some((n) => n.nonce_hash === params[0])) throw new Error("UNIQUE");
    tables.device_nonces.push({ nonce_hash: params[0], device_id: params[1], expires_at: params[2], created_at: params[3] });
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("DELETE FROM device_nonces WHERE nonce_hash=? AND device_id=? AND expires_at>?")) {
    const idx = tables.device_nonces.findIndex(
      (n) => n.nonce_hash === params[0] && n.device_id === params[1] && Number(n.expires_at) > Number(params[2])
    );
    if (idx < 0) return { changes: 0, meta: { changes: 0 } };
    tables.device_nonces.splice(idx, 1);
    return { changes: 1, meta: { changes: 1 } };
  }
  if (q.startsWith("DELETE FROM device_telemetry WHERE device_id=? AND created_at<?")) {
    const before = tables.device_telemetry.length;
    tables.device_telemetry = tables.device_telemetry.filter(
      (t) => !(t.device_id === params[0] && String(t.created_at) < String(params[1]))
    );
    return { changes: before - tables.device_telemetry.length, meta: { changes: before - tables.device_telemetry.length } };
  }
  if (q.startsWith("DELETE FROM device_telemetry WHERE device_id=")) {
    const before = tables.device_telemetry.length;
    tables.device_telemetry = tables.device_telemetry.filter((t) => t.device_id !== params[0]);
    return { changes: before - tables.device_telemetry.length };
  }
  if (q.startsWith("DELETE FROM device_commands WHERE device_id=")) {
    const before = tables.device_commands.length;
    tables.device_commands = tables.device_commands.filter((c) => c.device_id !== params[0]);
    return { changes: before - tables.device_commands.length };
  }
  if (q.startsWith("DELETE FROM device_nonces WHERE device_id=")) {
    const before = tables.device_nonces.length;
    tables.device_nonces = tables.device_nonces.filter((n) => n.device_id !== params[0]);
    return { changes: before - tables.device_nonces.length };
  }
  if (q.startsWith("DELETE FROM device_certs WHERE device_id=")) {
    const before = tables.device_certs.length;
    tables.device_certs = tables.device_certs.filter((c) => c.device_id !== params[0]);
    return { changes: before - tables.device_certs.length };
  }
  if (q.startsWith("DELETE FROM cloud_devices WHERE id=")) {
    const before = tables.cloud_devices.length;
    tables.cloud_devices = tables.cloud_devices.filter((d) => d.id !== params[0]);
    return { changes: before - tables.cloud_devices.length };
  }
  if (q.startsWith("SELECT * FROM device_telemetry WHERE device_id=? AND created_at>=")) {
    let rows = tables.device_telemetry.filter(
      (t) => t.device_id === params[0] && String(t.created_at) >= String(params[1])
    );
    if (q.includes("ORDER BY created_at DESC")) {
      rows = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    } else if (q.includes("ORDER BY created_at")) {
      rows = rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    if (q.includes("LIMIT")) {
      const limit = Number(params[2] ?? params[params.length - 1]);
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    }
    return rows;
  }
  if (q.startsWith("SELECT * FROM device_telemetry WHERE device_id=")) {
    return tables.device_telemetry.filter((t) => t.device_id === params[0]);
  }
  if (q.startsWith("INSERT INTO coach_subs")) {
    tables.coach_subs.push({
      user_id: params[0],
      status: params[1],
      period_end: params[2],
      auto_tune: params[3],
      created_at: params[4],
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM coach_subs WHERE user_id=")) {
    return tables.coach_subs.filter((s) => Number(s.user_id) === Number(params[0]));
  }
  if (q.startsWith("UPDATE coach_subs SET status=?, period_end=")) {
    const row = tables.coach_subs.find((s) => Number(s.user_id) === Number(params[2]));
    if (row) {
      row.status = params[0];
      row.period_end = params[1];
    }
    return {};
  }
  if (q.startsWith("UPDATE coach_subs SET auto_tune=")) {
    const row = tables.coach_subs.find((s) => Number(s.user_id) === Number(params[1]));
    if (row) row.auto_tune = params[0];
    return {};
  }
  if (q.startsWith("INSERT INTO coach_usage")) {
    tables.coach_usage.push({
      user_id: params[0],
      day: params[1],
      chats: params[2] ?? 0,
      photos: params[3] ?? 0,
      neurons: params[4] ?? 0,
    });
    return {};
  }
  if (q.startsWith("SELECT * FROM coach_usage WHERE user_id=? AND day=")) {
    return tables.coach_usage.filter((u) => Number(u.user_id) === Number(params[0]) && u.day === params[1]);
  }
  if (q.startsWith("UPDATE coach_usage SET chats=?")) {
    const row = tables.coach_usage.find((u) => Number(u.user_id) === Number(params[3]) && u.day === params[4]);
    if (row) {
      row.chats = params[0];
      row.photos = params[1];
      row.neurons = params[2];
    }
    return {};
  }
  if (q.startsWith("INSERT OR REPLACE INTO coach_cache") || q.startsWith("INSERT INTO coach_cache")) {
    tables.coach_cache = tables.coach_cache.filter((c) => c.cache_key !== params[0]);
    tables.coach_cache.push({ cache_key: params[0], value: params[1], expires_at: params[2] });
    return {};
  }
  if (q.startsWith("SELECT * FROM coach_cache WHERE cache_key=")) {
    return tables.coach_cache.filter((c) => c.cache_key === params[0]);
  }
  if (q.startsWith("SELECT * FROM coach_device_mode WHERE device_id=")) {
    return tables.coach_device_mode.filter((r) => r.device_id === params[0]);
  }
  if (q.startsWith("SELECT * FROM coach_device_mode WHERE mode=")) {
    return tables.coach_device_mode.filter((r) => r.mode === params[0]);
  }
  if (q.startsWith("SELECT * FROM coach_device_mode WHERE user_id=")) {
    return tables.coach_device_mode.filter((r) => Number(r.user_id) === Number(params[0]));
  }
  if (q.startsWith("INSERT INTO coach_device_mode")) {
    tables.coach_device_mode.push({
      device_id: params[0],
      user_id: params[1],
      mode: params[2],
      paused: params[3],
      pause_reason: params[4],
      pause_until: params[5],
      profile_id: params[6],
      last_change_at: params[7],
      changes_day: params[8],
      changes_count: params[9],
      last_setpoints: params[10],
      last_manual_at: params[11],
      updated_at: params[12],
    });
    return {};
  }
  if (q.startsWith("UPDATE coach_device_mode SET")) {
    const row = tables.coach_device_mode.find((r) => r.device_id === params[11]);
    if (row) {
      row.mode = params[0];
      row.paused = params[1];
      row.pause_reason = params[2];
      row.pause_until = params[3];
      row.profile_id = params[4];
      row.last_change_at = params[5];
      row.changes_day = params[6];
      row.changes_count = params[7];
      row.last_setpoints = params[8];
      row.last_manual_at = params[9];
      row.updated_at = params[10];
    }
    return {};
  }
  if (q.startsWith("INSERT INTO coach_autopilot_log")) {
    const row = {
      id: ids.coach_autopilot_log++,
      device_id: params[0],
      user_id: params[1],
      action: params[2],
      old_value: params[3],
      new_value: params[4],
      reason: params[5],
      readings: params[6],
      undone_at: params[7],
      created_at: params[8],
    };
    tables.coach_autopilot_log.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM coach_autopilot_log WHERE device_id=")) {
    let rows = tables.coach_autopilot_log.filter((r) => r.device_id === params[0]);
    if (q.includes("ORDER BY id DESC")) rows = rows.slice().sort((a, b) => Number(b.id) - Number(a.id));
    if (q.includes("LIMIT")) {
      const limit = Number(params[1] ?? params[params.length - 1]);
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    }
    return rows;
  }
  if (q.startsWith("SELECT * FROM coach_autopilot_log WHERE id=")) {
    return tables.coach_autopilot_log.filter((r) => Number(r.id) === Number(params[0]));
  }
  if (q.startsWith("UPDATE coach_autopilot_log SET undone_at=")) {
    const row = tables.coach_autopilot_log.find((r) => Number(r.id) === Number(params[1]));
    if (row) row.undone_at = params[0];
    return {};
  }
  if (q.startsWith("SELECT * FROM device_groups WHERE id=")) {
    return tables.device_groups.filter((g) => Number(g.id) === Number(params[0]));
  }
  if (q.startsWith("SELECT * FROM device_groups WHERE owner_id=")) {
    return tables.device_groups.filter((g) => Number(g.owner_id) === Number(params[0]));
  }
  if (q.startsWith("INSERT INTO device_groups")) {
    const row = {
      id: ids.device_groups++,
      owner_id: params[0],
      name: params[1],
      created_at: params[2],
      updated_at: params[3],
    };
    tables.device_groups.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("UPDATE device_groups SET name=?")) {
    const row = tables.device_groups.find((g) => Number(g.id) === Number(params[2]));
    if (row) {
      row.name = params[0];
      row.updated_at = params[1];
    }
    return {};
  }
  if (q.startsWith("DELETE FROM device_groups WHERE id=")) {
    const before = tables.device_groups.length;
    tables.device_groups = tables.device_groups.filter((g) => Number(g.id) !== Number(params[0]));
    return { changes: before - tables.device_groups.length };
  }
  if (q.startsWith("SELECT * FROM device_group_members WHERE group_id=")) {
    return tables.device_group_members.filter((m) => Number(m.group_id) === Number(params[0]));
  }
  if (q.startsWith("SELECT * FROM device_group_members WHERE device_id=")) {
    return tables.device_group_members.filter((m) => m.device_id === params[0]);
  }
  if (q.startsWith("INSERT INTO device_group_members")) {
    tables.device_group_members.push({ group_id: params[0], device_id: params[1], added_at: params[2] });
    return {};
  }
  if (q.startsWith("DELETE FROM device_group_members WHERE group_id=")) {
    const before = tables.device_group_members.length;
    tables.device_group_members = tables.device_group_members.filter((m) => Number(m.group_id) !== Number(params[0]));
    return { changes: before - tables.device_group_members.length };
  }
  if (q.startsWith("INSERT INTO fleet_audit")) {
    const row = {
      id: ids.fleet_audit++,
      owner_id: params[0],
      actor_id: params[1],
      action: params[2],
      scope: params[3],
      target: params[4],
      preview: params[5],
      results: params[6],
      created_at: params[7],
    };
    tables.fleet_audit.push(row);
    return { lastRowId: row.id };
  }
  if (q.startsWith("SELECT * FROM fleet_audit WHERE owner_id=")) {
    let rows = tables.fleet_audit.filter((r) => Number(r.owner_id) === Number(params[0]));
    if (q.includes("ORDER BY id DESC")) rows = rows.slice().sort((a, b) => Number(b.id) - Number(a.id));
    if (q.includes("LIMIT")) {
      const limit = Number(params[1] ?? params[params.length - 1]);
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    }
    return rows;
  }
  if (q.startsWith("INSERT INTO device_telemetry")) {
    tables.device_telemetry.push({
      id: ids.device_telemetry++,
      device_id: params[0],
      document: params[1],
      created_at: params[2],
    });
    return {};
  }
  if (mode === "run") return {};
  return [];
}

export { seedMissing as seedIfEmpty } from "./seed.js";
