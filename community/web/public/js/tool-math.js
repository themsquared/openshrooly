/**
 * Math for the two free tools: the grow timeline calculator and the fresh air planner.
 * Pure functions, shared by the page script (js/tools.js) and the build (scripts/tools/index.js),
 * so the numbers a crawler sees match the numbers a visitor gets.
 */

const DAY = 86400000;

export const cToF = (c) => Math.round((Number(c) * 9) / 5 + 32);
export const tempText = (c) => `${c} °C (${cToF(c)} °F)`;

/** "2026-10-27" to a UTC day number, or NaN. */
export function parseDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCMonth() === Number(m[2]) - 1 ? t : NaN;
}

export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export const icsDay = (t) => isoDay(t).replaceAll("-", "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue, Oct 27" */
export function shortDay(t) {
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function fanLine(stage) {
  const f = stage.fan || {};
  return f.run && f.every ? `fan ${f.run} s every ${f.every} min` : "fan off";
}

export function lightLine(stage) {
  return stage.light ? `${stage.light} h light a day` : "dark";
}

/**
 * Stage by stage plan. `fromKit` skips colonization, for a kit or block that is already fully colonized.
 * Returns rows with day numbers, and dates too when `start` is a valid day.
 */
export function timeline(species, { start, fromKit = false } = {}) {
  const t0 = parseDay(start);
  let stages = species.stages;
  if (fromKit) stages = stages.filter((s) => s.id !== "colonization" && s.id !== "browning");
  let day = 1;
  const rows = stages.map((s) => {
    const row = { ...s, from: day, to: day + s.days - 1 };
    if (!Number.isNaN(t0)) {
      row.start = t0 + (row.from - 1) * DAY;
      row.end = t0 + (row.to - 1) * DAY;
    }
    day += s.days;
    return row;
  });
  const total = day - 1;
  const harvest = rows.find((r) => r.id === "fruiting") || rows[rows.length - 1];
  return { rows, total, harvest };
}

const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** RFC 5545 lines are at most 75 octets. Longer lines continue on the next line after a space. */
export function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (size + n > limit) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** An .ics calendar with one all-day event per stage. `now` is injectable for tests. */
export function buildIcs(species, plan, { site = "https://shroomlabs.io", now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = `${site}/profiles/${species.id}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Shroom Labs//Grow timeline//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const r of plan.rows) {
    if (r.start === undefined) continue;
    const what = r.id === plan.harvest.id ? `${r.name} and first harvest` : r.name;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${species.id}-${r.id}-${icsDay(plan.rows[0].start)}@shroomlabs.io`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDay(r.start)}`,
      `DTEND;VALUE=DATE:${icsDay(r.end + DAY)}`,
      `SUMMARY:${icsText(`${species.name}: ${what}`)}`,
      `DESCRIPTION:${icsText(`Day ${r.from} to ${r.to}. ${tempText(r.c)}, ${r.rh}% humidity, ${fanLine(r)}, ${lightLine(r)}. ${url}`)}`,
      `URL:${url}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/* ---------- fresh air ---------- */

const LITERS_PER = { cm: 0.001, in: 0.016387064 };
const LPM_PER = { cfm: 28.316846592, m3h: 1000 / 60, lpm: 1 };

/** Inside volume in liters from length, width, and height in cm or inches. */
export function chamberLiters(l, w, h, unit = "cm") {
  const v = Number(l) * Number(w) * Number(h) * (LITERS_PER[unit] || LITERS_PER.cm);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

export function flowLpm(value, unit = "cfm") {
  const v = Number(value) * (LPM_PER[unit] || LPM_PER.cfm);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

/**
 * Air changes for a fan that runs `runS` seconds every `everyMin` minutes.
 * One air change moves as much air as the chamber holds. Real mixing is less than perfect,
 * so treat the result as an upper bound on how much stale air leaves.
 */
export function airChanges({ liters, lpm, runS, everyMin }) {
  if (!(liters > 0) || !(lpm > 0) || !(runS > 0) || !(everyMin > 0)) return null;
  const perRun = (lpm * runS) / 60;
  const runsPerHour = 60 / everyMin;
  const perHour = (perRun * runsPerHour) / liters;
  return {
    perRunLiters: perRun,
    perRun: perRun / liters,
    perHour,
    continuous: (lpm * 60) / liters,
    dutyPercent: (runS / (everyMin * 60)) * 100,
    // Fan run time that would reach the reference range at the same cycle.
    runFor: (target) => Math.ceil((target * liters * 60) / (lpm * runsPerHour)),
  };
}

/** Oyster growing rooms in UC ANR's grower guide: 4 per hour while pins form, 4 to 6 while cropping. */
export const REFERENCE_ACH = { low: 4, high: 6 };

export function compareAch(perHour) {
  if (perHour < REFERENCE_ACH.low) return "below";
  if (perHour > REFERENCE_ACH.high) return "above";
  return "within";
}

export const round = (n, places = 1) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
