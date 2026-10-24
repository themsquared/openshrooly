/** In-memory implementations of the statements in store.js, for tests and the local server. */

import { SQL } from "./store.js";

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const N = Object.fromEntries(Object.entries(SQL).map(([k, v]) => [norm(v), k]));
const ok = (n) => ({ changes: n, meta: { changes: n } });
const desc = (a, b) => b.id - a.id;

export const ALERT_TABLES = ["alert_prefs", "alert_rules", "alert_state", "alerts", "alert_cron"];

/** Returns undefined when the statement is not an alerts statement. */
export function dispatchAlerts(tables, ids, q, params) {
  const name = N[q];
  if (!name) return undefined;
  for (const t of ALERT_TABLES) tables[t] ||= [];
  ids.alerts ||= 1;
  const p = params;
  switch (name) {
    case "prefsGet":
      return tables.alert_prefs.filter((r) => Number(r.user_id) === Number(p[0]));
    case "prefsPut": {
      const row = tables.alert_prefs.find((r) => Number(r.user_id) === Number(p[0]));
      if (row) Object.assign(row, { document: p[1], updated_at: p[2] });
      else tables.alert_prefs.push({ user_id: Number(p[0]), document: p[1], updated_at: p[2] });
      return ok(1);
    }
    case "rulesGet":
      return tables.alert_rules.filter((r) => r.device_id === p[0]);
    case "rulesPut": {
      const row = tables.alert_rules.find((r) => r.device_id === p[0]);
      if (row) Object.assign(row, { user_id: Number(p[1]), document: p[2], updated_at: p[3] });
      else tables.alert_rules.push({ device_id: p[0], user_id: Number(p[1]), document: p[2], updated_at: p[3] });
      return ok(1);
    }
    case "stateAll":
      return tables.alert_state.filter((r) => r.device_id === p[0]);
    case "stateInit": {
      if (tables.alert_state.some((r) => r.device_id === p[0] && r.rule === p[1])) return ok(0);
      tables.alert_state.push({
        device_id: p[0],
        rule: p[1],
        status: "ok",
        episode_key: null,
        opened_at: null,
        last_open_notice_at: null,
        open_notified: 0,
        rev: 0,
        updated_at: p[2],
      });
      return ok(1);
    }
    case "stateCas": {
      const row = tables.alert_state.find((r) => r.device_id === p[6] && r.rule === p[7] && Number(r.rev) === Number(p[8]));
      if (!row) return ok(0);
      Object.assign(row, {
        status: p[0],
        episode_key: p[1],
        opened_at: p[2],
        last_open_notice_at: p[3],
        open_notified: p[4],
        rev: Number(row.rev) + 1,
        updated_at: p[5],
      });
      return ok(1);
    }
    case "alertInsert": {
      if (tables.alerts.some((r) => r.dedupe_key === p[5])) return ok(0);
      const keys = ["user_id", "device_id", "rule", "kind", "episode_key", "dedupe_key", "title", "detail", "status", "channel", "created_at"];
      const row = { id: ids.alerts++, delivered_at: null };
      keys.forEach((k, i) => (row[k] = p[i]));
      row.user_id = Number(row.user_id);
      tables.alerts.push(row);
      return { ...ok(1), lastRowId: row.id };
    }
    case "alertByDedupe":
      return tables.alerts.filter((r) => r.dedupe_key === p[0]);
    case "alertGet":
      return tables.alerts.filter((r) => r.id === Number(p[0]) && r.user_id === Number(p[1]));
    case "alertClaim": {
      const row = tables.alerts.find((r) => r.id === Number(p[0]) && r.status === p[1]);
      if (!row) return ok(0);
      row.status = "sending";
      return ok(1);
    }
    case "alertFinish": {
      const row = tables.alerts.find((r) => r.id === Number(p[2]) && r.status === "sending");
      if (!row) return ok(0);
      Object.assign(row, { status: p[0], delivered_at: p[1] });
      return ok(1);
    }
    case "alertsForUser":
      return tables.alerts.filter((r) => r.user_id === Number(p[0])).sort(desc).slice(0, Number(p[1]));
    case "alertsForDevice":
      return tables.alerts
        .filter((r) => r.user_id === Number(p[0]) && r.device_id === p[1])
        .sort(desc)
        .slice(0, Number(p[2]));
    case "alertsHeld":
      return tables.alerts.filter((r) => r.status === "held").sort((a, b) => a.id - b.id).slice(0, Number(p[0]));
    case "sentSince":
      return [
        {
          n: tables.alerts.filter(
            (r) => r.user_id === Number(p[0]) && ["sent", "stub"].includes(r.status) && r.delivered_at && r.delivered_at >= p[1]
          ).length,
        },
      ];
    case "cronInit":
      if (tables.alert_cron.some((r) => r.name === p[0])) return ok(0);
      tables.alert_cron.push({ name: p[0], lease_until: 0, cursor: "", runs: 0, last_run_at: null });
      return ok(1);
    case "cronLease": {
      const row = tables.alert_cron.find((r) => r.name === p[2] && Number(r.lease_until) < Number(p[3]));
      if (!row) return ok(0);
      Object.assign(row, { lease_until: Number(p[0]), runs: row.runs + 1, last_run_at: p[1] });
      return ok(1);
    }
    case "cronGet":
      return tables.alert_cron.filter((r) => r.name === p[0]);
    case "cronRelease": {
      const row = tables.alert_cron.find((r) => r.name === p[1] && Number(r.lease_until) === Number(p[2]));
      if (!row) return ok(0);
      Object.assign(row, { lease_until: 0, cursor: p[0] });
      return ok(1);
    }
    case "devicesPage":
      return tables.cloud_devices
        .filter((d) => d.status === "active" && d.owner_id != null && d.id > p[0])
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, Number(p[1]))
        .map((d) => {
          const r = tables.alert_rules.find((x) => x.device_id === d.id);
          return {
            id: d.id,
            name: d.name,
            owner_id: d.owner_id,
            last_seen_at: d.last_seen_at ?? null,
            rules: r?.document ?? null,
            rules_user_id: r?.user_id ?? null,
          };
        });
    case "telemetryWindow":
      return tables.device_telemetry
        .filter((t) => t.device_id === p[0] && t.created_at >= p[1])
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, Number(p[2]))
        .map((t) => ({ document: t.document, created_at: t.created_at }));
    default:
      return undefined;
  }
}
