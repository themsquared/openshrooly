/** In-memory versions of the statements in account.js, for tests and the local server. */

import { ACCOUNT_SQL } from "./account-sql.js";

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const KNOWN = new Set(Object.values(ACCOUNT_SQL).map(norm));
const same = (a, b) => a !== null && a !== undefined && String(a) === String(b);

/** Returns undefined when the statement is not an account statement. */
export function dispatchAccount(tables, q, params) {
  if (!KNOWN.has(q)) return undefined;
  let m = q.match(/^SELECT \* FROM (\w+) WHERE (\w+)=\?$/);
  if (m) return (tables[m[1]] ||= []).filter((r) => same(r[m[2]], params[0]));
  m = q.match(/^DELETE FROM (\w+) WHERE (\w+)=\?$/);
  if (m) {
    const rows = (tables[m[1]] ||= []);
    const before = rows.length;
    tables[m[1]] = rows.filter((r) => !same(r[m[2]], params[0]));
    return { changes: before - tables[m[1]].length };
  }
  m = q.match(/^UPDATE (\w+) SET (\w+)=NULL WHERE (\w+)=\?$/);
  if (m) {
    const hit = (tables[m[1]] ||= []).filter((r) => same(r[m[3]], params[0]));
    for (const r of hit) r[m[2]] = null;
    return { changes: hit.length };
  }
  if (q === norm(ACCOUNT_SQL.releaseDevice)) {
    const row = tables.cloud_devices.find((r) => r.id === params[0]);
    if (row) Object.assign(row, { status: "revoked", owner_id: null, cloud_enabled: 0, claim_code_hash: null, enroll_hash: null, name: "Chamber" });
    return { changes: row ? 1 : 0 };
  }
  throw new Error(`account-memory: unhandled ${q}`);
}
