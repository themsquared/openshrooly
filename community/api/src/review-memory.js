/** In-memory profile review tables for tests and the local server. */

const ok = (n) => ({ changes: n, meta: { changes: n } });

export const REVIEW_TABLES = ["profile_review", "profile_photos", "moderation_log", "profile_reports"];

export function dispatchReview(tables, ids, q, params) {
  for (const t of REVIEW_TABLES) tables[t] ||= [];
  ids.profile_photos ||= 1;
  ids.moderation_log ||= 1;
  ids.profile_reports ||= 1;
  const p = params;

  if (q.startsWith("SELECT * FROM profile_review WHERE profile_id=")) {
    return tables.profile_review.filter((r) => r.profile_id === p[0]);
  }
  if (q.startsWith("SELECT * FROM profile_review WHERE status")) {
    const wanted = ["pending", "reported"];
    return tables.profile_review.filter((r) => wanted.includes(r.status) || r.status === "pending").sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  if (q.startsWith("SELECT * FROM profile_review")) {
    return tables.profile_review;
  }
  if (q.startsWith("INSERT INTO profile_review")) {
    const row = {
      profile_id: p[0],
      status: p[1],
      reason: p[2],
      title: p[3],
      description: p[4],
      live_document: p[5],
      blocklist_hit: p[6],
      offmenu_flag: p[7],
      published_live: p[8],
      created_at: p[9],
      updated_at: p[10],
      confirmed_culinary_at: p[11] ?? null,
      confirmed_by: p[12] ?? null,
    };
    const idx = tables.profile_review.findIndex((r) => r.profile_id === row.profile_id);
    if (idx >= 0) tables.profile_review[idx] = { ...tables.profile_review[idx], ...row };
    else tables.profile_review.push(row);
    return ok(1);
  }
  if (q.startsWith("SELECT * FROM profile_photos WHERE profile_id=")) {
    return tables.profile_photos.filter((r) => r.profile_id === p[0] && (q.includes("withdrawn=0") ? Number(r.withdrawn) === 0 : true));
  }
  if (q.startsWith("SELECT * FROM profile_photos WHERE object_key=")) {
    return tables.profile_photos.filter((r) => r.object_key === p[0]);
  }
  if (q.startsWith("SELECT * FROM profile_photos WHERE id=")) {
    return tables.profile_photos.filter(
      (r) => Number(r.id) === Number(p[0]) && (p[1] == null || r.profile_id === p[1])
    );
  }
  if (q.startsWith("INSERT INTO profile_photos")) {
    const literalWithdrawn = /VALUES \(.*, 0, \?, \?\)$/.test(q) || q.includes(", 0, ?, ?)");
    tables.profile_photos.push({
      id: ids.profile_photos++,
      profile_id: p[0],
      object_key: p[1],
      content_type: p[2],
      width: p[3],
      height: p[4],
      status: p[5],
      prescreen: p[6],
      withdrawn: literalWithdrawn ? 0 : p[7],
      created_at: literalWithdrawn ? p[7] : p[8],
      updated_at: literalWithdrawn ? p[8] : p[9],
    });
    return ok(1);
  }
  if (q.includes("SET status='pending', withdrawn=1")) {
    for (const row of tables.profile_photos.filter((r) => r.profile_id === p[1])) {
      row.status = "pending";
      row.withdrawn = 1;
      row.updated_at = p[0];
    }
    return ok(1);
  }
  if (q.startsWith("UPDATE profile_photos SET status=")) {
    for (const row of tables.profile_photos.filter((r) => r.profile_id === p[1] && Number(r.withdrawn) === 0)) {
      row.status = "approved";
      row.updated_at = p[0];
    }
    return ok(1);
  }
  if (q.startsWith("UPDATE profile_photos SET withdrawn=")) {
    const row = tables.profile_photos.find(
      (r) => Number(r.id) === Number(p[1]) && (p[2] == null || r.profile_id === p[2])
    );
    if (row) {
      row.withdrawn = 1;
      row.updated_at = p[0];
    }
    return ok(1);
  }
  if (q.startsWith("INSERT INTO moderation_log")) {
    tables.moderation_log.push({
      id: ids.moderation_log++,
      profile_id: p[0],
      actor_id: p[1],
      action: p[2],
      reason: p[3],
      created_at: p[4],
    });
    return ok(1);
  }
  if (q.startsWith("SELECT * FROM moderation_log")) {
    return tables.moderation_log.filter((r) => r.profile_id === p[0]).sort((a, b) => b.id - a.id);
  }
  if (q.startsWith("INSERT INTO profile_reports")) {
    tables.profile_reports.push({
      id: ids.profile_reports++,
      profile_id: p[0],
      reporter_id: p[1],
      reason: p[2],
      created_at: p[3],
    });
    return ok(1);
  }
  return undefined;
}
