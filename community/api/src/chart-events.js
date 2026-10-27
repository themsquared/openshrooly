/**
 * Events for the device readings chart, built only from records we already keep:
 * coach_autopilot_log (Autopilot decisions), device_commands (applied Coach suggestions,
 * profile, stage, setpoint and light changes sent from the site) and the telemetry itself
 * (firmware version, chamber phase and setpoint changes made on the chamber, offline gaps).
 * Read only. No new tables.
 */
function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const CHART_EVENT_LIMIT = 400;
/** A gap is longer than this many usual check-in intervals, and never shorter than the floor. */
export const GAP_FACTOR = 2.5;
export const GAP_FLOOR_MS = 20 * 60 * 1000;
const NEAR_COMMAND_MS = 45 * 60 * 1000;

const LOG_SQL = "SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?";
const COMMANDS_SQL = "SELECT * FROM device_commands WHERE device_id=? ORDER BY id DESC LIMIT ?";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ms(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
}

function iso(t) {
  return new Date(t).toISOString().replace(/\.\d+Z$/, "Z");
}

function clip(text, n = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s;
}

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

/** "Temperature 18 °C, humidity 90%" from a setpoint payload. Only the parts that are there. */
export function setpointText(p = {}, from = null) {
  const parts = [];
  const t = num(p.temperature_c ?? p.temperature_target);
  const h = num(p.humidity_percent ?? p.target_humidity);
  const f = num(p.fan_speed_percent ?? p.air_exchange_speed);
  const changed = (key, alt) => !from || num(from[key] ?? from[alt]) !== num(p[key] ?? p[alt]);
  if (t != null && changed("temperature_c", "temperature_target")) parts.push(`temperature ${round1(t)} °C`);
  if (h != null && changed("humidity_percent", "target_humidity")) parts.push(`humidity ${round1(h)}%`);
  if (f != null && changed("fan_speed_percent", "air_exchange_speed")) parts.push(`fan ${round1(f)}%`);
  if (p.grow_phase && (!from || from.grow_phase !== p.grow_phase)) parts.push(`phase ${p.grow_phase}`);
  if (!parts.length) return "";
  const s = parts.join(", ");
  return s[0].toUpperCase() + s.slice(1);
}

function humanId(id) {
  const s = String(id || "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

function ackNote(payload) {
  const status = payload?._ack?.status;
  if (status === "refused") return "The chamber refused it.";
  if (status === "expired") return payload._ack.via === "superseded" ? "Replaced by a newer change." : "Not delivered in time.";
  return "";
}

function autopilotEvent(row) {
  const at = row.created_at;
  const reason = clip(row.reason);
  const oldV = parseJson(row.old_value, null);
  const newV = parseJson(row.new_value, null);
  if (row.action === "apply") {
    const what = newV ? setpointText(newV, oldV) : "";
    const status = row.undone_at ? " (undone)" : row.apply_status === "expired" ? " (not delivered)" : row.apply_status === "refused" ? " (refused)" : "";
    return { at, type: "autopilot", title: `Autopilot change${status}`, detail: [what, reason].filter(Boolean).join(". ") };
  }
  if (row.action === "undo") return { at, type: "autopilot", title: "Autopilot change undone", detail: reason };
  if (row.action === "pause") return { at, type: "autopilot", title: "Autopilot paused", detail: reason };
  if (row.action === "resume") return { at, type: "autopilot", title: "Autopilot resumed", detail: reason };
  // "expired" rows repeat the apply row they belong to.
  return null;
}

function commandEvent(row, names) {
  const payload = parseJson(row.payload, {}) || {};
  const source = String(payload.source || "");
  if (source.startsWith("grow-coach-autopilot")) return null; // the Autopilot log already has these
  const at = row.issued_at;
  const note = ackNote(payload);
  const withNote = (s) => [s, note].filter(Boolean).join(". ");
  if (row.kind === "apply_profile" || payload.translated_from === "apply_profile") {
    const name = names.get(payload.profile_id) || humanId(payload.profile_id) || "a profile";
    const stage = payload.stage ? `, ${humanId(payload.stage).toLowerCase()} stage` : "";
    return { at, type: "profile", title: "Profile changed", detail: withNote(`${name}${stage}`) };
  }
  if (row.kind === "schedule") return { at, type: "setpoint", title: "Light schedule changed", detail: withNote("Sent from the site") };
  if (row.kind !== "setpoints") return null;
  if (source === "grow-coach") return { at, type: "coach", title: "Coach suggestion applied", detail: withNote(setpointText(payload)) };
  if (payload.stage || (payload.grow_phase && num(payload.temperature_c) == null && num(payload.humidity_percent) == null)) {
    return { at, type: "stage", title: "Stage changed", detail: withNote(humanId(payload.stage) || payload.grow_phase || "") };
  }
  return { at, type: "setpoint", title: "Setpoints changed", detail: withNote(setpointText(payload) || "Sent from the site") };
}

function docOf(row) {
  return typeof row.document === "string" ? parseJson(row.document, {}) || {} : row.document || {};
}

function median(list) {
  if (!list.length) return null;
  const s = list.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** How long between readings counts as the chamber being offline. */
export function gapThresholdMs(times = []) {
  const steps = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 30 * 1000) steps.push(d);
  }
  const usual = median(steps) || 15 * 60 * 1000;
  return Math.max(GAP_FLOOR_MS, usual * GAP_FACTOR);
}

/** Events read from the telemetry rows themselves (sorted oldest first). */
export function telemetryEvents(samples = [], { now = Date.now(), commandTimes = [] } = {}) {
  const rows = samples
    .map((r) => ({ t: ms(r.created_at), doc: docOf(r) }))
    .filter((r) => r.t != null)
    .sort((a, b) => a.t - b.t);
  const events = [];
  const times = rows.map((r) => r.t);
  const gapMs = gapThresholdMs(times);
  const sentNear = (t) => commandTimes.some((c) => c <= t && t - c <= NEAR_COMMAND_MS);
  let prev = null;
  for (const r of rows) {
    const d = r.doc;
    if (prev) {
      const p = prev.doc;
      if (r.t - prev.t > gapMs) {
        events.push({ at: iso(prev.t), end: iso(r.t), type: "offline", title: "No readings", detail: `Nothing for ${durationText(r.t - prev.t)}` });
      }
      const fwA = p.firmware_version;
      const fwB = d.firmware_version;
      if (fwA && fwB && fwA !== fwB) events.push({ at: iso(r.t), type: "firmware", title: "Firmware updated", detail: `${fwA} to ${fwB}` });
      const phA = p.grow_phase;
      const phB = d.grow_phase;
      if (phA && phB && phA !== phB && !sentNear(r.t)) events.push({ at: iso(r.t), type: "stage", title: "Chamber phase changed", detail: `${phA} to ${phB}` });
      const tA = num(p.temperature_setpoint ?? p.temperature_target);
      const tB = num(d.temperature_setpoint ?? d.temperature_target);
      const hA = num(p.humidity_setpoint ?? p.target_humidity);
      const hB = num(d.humidity_setpoint ?? d.target_humidity);
      const parts = [];
      if (tA != null && tB != null && tA !== tB) parts.push(`temperature ${round1(tA)} to ${round1(tB)} °C`);
      if (hA != null && hB != null && hA !== hB) parts.push(`humidity ${round1(hA)} to ${round1(hB)}%`);
      if (parts.length && !sentNear(r.t)) {
        const s = parts.join(", ");
        events.push({ at: iso(r.t), type: "setpoint", title: "Setpoints changed on the chamber", detail: s[0].toUpperCase() + s.slice(1) });
      }
    }
    prev = r;
  }
  if (prev && now - prev.t > gapMs) {
    events.push({ at: iso(prev.t), end: iso(now), type: "offline", title: "No readings since", detail: `Nothing for ${durationText(now - prev.t)}`, ongoing: true });
  }
  return events;
}

export function durationText(d) {
  const mins = Math.round(d / 60000);
  if (mins < 90) return `${mins} min`;
  const h = Math.round(mins / 6) / 10;
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** All chart events between since and now, oldest first. */
export function buildChartEvents({ samples = [], log = [], commands = [], names = new Map(), since, now = Date.now() } = {}) {
  const from = ms(since) ?? now - 24 * 3600 * 1000;
  const inWindow = (e) => {
    const t = ms(e?.at);
    const end = ms(e?.end) ?? t;
    return t != null && end >= from && t <= now;
  };
  const commandTimes = (commands || []).map((c) => ms(c.issued_at)).filter((t) => t != null);
  const events = [
    ...(log || []).map(autopilotEvent),
    ...(commands || []).map((c) => commandEvent(c, names)),
    ...telemetryEvents(samples, { now, commandTimes }),
  ].filter(inWindow);
  events.sort((a, b) => ms(a.at) - ms(b.at));
  return events.slice(-CHART_EVENT_LIMIT);
}

/** Load the records and build the events. Never throws: a chart without events is still a chart. */
export async function loadChartEvents(db, device, { samples = [], since, now = Date.now() } = {}) {
  try {
    const [log, commands] = await Promise.all([
      db.all(LOG_SQL, [device.id, CHART_EVENT_LIMIT]).catch(() => []),
      db.all(COMMANDS_SQL, [device.id, CHART_EVENT_LIMIT]).catch(() => []),
    ]);
    const names = new Map();
    const ids = new Set();
    for (const c of commands || []) {
      const payload = parseJson(c.payload, {}) || {};
      if (c.kind !== "apply_profile" && payload.translated_from !== "apply_profile") continue;
      const id = payload.profile_id;
      if (id) ids.add(id);
    }
    for (const id of [...ids].slice(0, 10)) {
      const row = await db.one("SELECT * FROM profiles WHERE id=?", [id]).catch(() => null);
      const doc = row ? parseJson(row.document, {}) : null;
      if (doc?.name) names.set(id, doc.name);
    }
    return buildChartEvents({ samples, log, commands, names, since, now });
  } catch {
    return [];
  }
}
