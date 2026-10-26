/** In-memory versions of the statements in feed-sql.js, for tests and the local server. */

import { FEED_SQL } from "./feed-sql.js";

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const BY_SQL = new Map(Object.entries(FEED_SQL).map(([name, sql]) => [norm(sql), name]));
const ok = (n) => ({ changes: n, meta: { changes: n } });

/** Returns undefined when the statement is not a feed statement. */
export function dispatchFeed(tables, ids, q, p) {
  const name = BY_SQL.get(q);
  if (!name) return undefined;
  tables.grow_posts ||= [];
  tables.grow_post_reports ||= [];
  ids.grow_posts ||= 1;
  ids.grow_post_reports ||= 1;
  const withAuthor = (row) => ({ ...row, author: tables.users.find((u) => Number(u.id) === Number(row.user_id))?.username ?? null });
  const newest = (rows) => rows.sort((a, b) => b.id - a.id);
  const now = new Date().toISOString();
  switch (name) {
    case "insertPost": {
      const row = {
        id: ids.grow_posts++,
        user_id: p[0],
        profile_id: p[1],
        device_id: p[2],
        grow_day: p[3],
        note: p[4],
        photo_key: p[5],
        content_type: p[6],
        width: p[7],
        height: p[8],
        status: "visible",
        report_count: 0,
        created_at: p[9],
        updated_at: p[10],
      };
      tables.grow_posts.push(row);
      return { ...ok(1), meta: { changes: 1, last_row_id: row.id } };
    }
    case "postByKey":
      return tables.grow_posts.filter((r) => r.photo_key === p[0]);
    case "postById":
      return tables.grow_posts.filter((r) => Number(r.id) === Number(p[0])).map(withAuthor);
    case "feedPage":
      return newest(tables.grow_posts.filter((r) => r.status === "visible" && r.id < Number(p[0]))).slice(0, Number(p[1])).map(withAuthor);
    case "profilePage":
      return newest(tables.grow_posts.filter((r) => r.status === "visible" && r.profile_id === p[0] && r.id < Number(p[1])))
        .slice(0, Number(p[2]))
        .map(withAuthor);
    case "moderationQueue":
      return newest(tables.grow_posts.filter((r) => r.status === "hidden" || (r.status === "visible" && r.report_count > 0)))
        .slice(0, 100)
        .map(withAuthor);
    case "insertReport": {
      if (tables.grow_post_reports.some((r) => Number(r.post_id) === Number(p[0]) && Number(r.reporter_id) === Number(p[1]))) return ok(0);
      tables.grow_post_reports.push({ id: ids.grow_post_reports++, post_id: p[0], reporter_id: p[1], reason: p[2], created_at: p[3] });
      return ok(1);
    }
    case "bumpReports": {
      const row = tables.grow_posts.find((r) => Number(r.id) === Number(p[1]));
      if (!row) return ok(0);
      row.report_count += 1;
      row.updated_at = p[0];
      return ok(1);
    }
    case "setStatus": {
      const row = tables.grow_posts.find((r) => Number(r.id) === Number(p[2]));
      if (!row) return ok(0);
      row.status = p[0];
      row.updated_at = p[1];
      return ok(1);
    }
    case "restore": {
      const row = tables.grow_posts.find((r) => Number(r.id) === Number(p[1]));
      if (!row) return ok(0);
      row.status = "visible";
      row.report_count = 0;
      row.updated_at = p[0] || now;
      return ok(1);
    }
    default:
      return undefined;
  }
}
