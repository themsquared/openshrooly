/** Catalog seeds: insert-if-missing, batched. Do not row-loop on a Worker request. */

import { nowIso } from "./crypto.js";

export const GUIDE_SEED = {
  id: "block-prep-101",
  title: "Hardwood block prep (premium guide stub)",
  body: "Stub grow guide. $3.99 demo item routed through the Stripe stub.",
  pricing: { kind: "paid", amount_cents: 399, currency: "USD", creator_share_percent: 70 },
  allowed_payment_providers: ["stripe"],
};

export function seedStatements(profiles, ts = nowIso()) {
  const rows = (profiles || []).map((profile) => ({
    sql: "INSERT OR IGNORE INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    params: [profile.id, JSON.stringify(profile), null, ts, ts],
  }));
  rows.push({
    sql: "INSERT OR IGNORE INTO guides (id, title, body, pricing, allowed_payment_providers, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    params: [
      GUIDE_SEED.id,
      GUIDE_SEED.title,
      GUIDE_SEED.body,
      JSON.stringify(GUIDE_SEED.pricing),
      JSON.stringify(GUIDE_SEED.allowed_payment_providers),
      ts,
    ],
  });
  return rows;
}

/** Idempotent. Uses one D1 batch when available so a Worker request stays under the subrequest cap. */
export async function seedMissing(db, profiles) {
  const statements = seedStatements(profiles);
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) {
      await db.run(statement.sql, statement.params);
    }
  }
  for (const profile of profiles || []) {
    const row = await db.one("SELECT * FROM profiles WHERE id=?", [profile.id]);
    if (row && row.author_id != null) {
      console.error(JSON.stringify({ level: "error", event: "seed_id_conflict", id: profile.id, author_id: row.author_id }));
    }
  }
}

export function sqlQuote(value) {
  if (value == null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function seedSql(profiles, ts = nowIso()) {
  return (
    seedStatements(profiles, ts)
      .map((statement) => {
        const bound = statement.sql;
        let i = 0;
        return bound.replaceAll("?", () => sqlQuote(statement.params[i++]));
      })
      .join(";\n") + ";\n"
  );
}
