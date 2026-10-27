/**
 * Readings chart for a chamber: stacked SVG panels on one time axis, a legend that doubles as
 * the hover readout, the current stage's target bands, setpoint lines, offline gaps and event
 * markers. No chart library. Pure helpers are exported for tests.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const HOUR = 3600 * 1000;
export const RANGES = [
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
];
const UNIT_KEY = "sl-temp-unit";
const GAP_FLOOR_MS = 20 * 60 * 1000;

/** Series the chart knows. A series shows only when the chamber reported it in the range. */
export const SERIES = [
  { key: "temperature", setpoint: "temperature_setpoint", name: "Temperature", color: "#ff8a6a", main: true, band: ["temperature_min", "temperature_max"] },
  { key: "humidity", setpoint: "humidity_setpoint", name: "Humidity", unit: "%", color: "#5ee4ff", main: true, band: ["humidity_min", "humidity_max"], clamp: [0, 100] },
  { key: "fan_speed", name: "Fan setting", unit: "%", color: "#c9a7ff", step: true, clamp: [0, 100] },
  { key: "water_level", name: "Water", unit: "%", color: "#8fb8ff", clamp: [0, 100] },
  { key: "co2", name: "CO2", unit: "ppm", color: "#f5d76e" },
];

export const EVENT_KINDS = {
  autopilot: { letter: "A", name: "Autopilot", color: "#7dffb3" },
  coach: { letter: "C", name: "Coach suggestion", color: "#c9a45c" },
  profile: { letter: "P", name: "Profile or stage", color: "#d4784a" },
  stage: { letter: "P", name: "Profile or stage", color: "#d4784a" },
  setpoint: { letter: "S", name: "Setpoint change", color: "#5ee4ff" },
  firmware: { letter: "F", name: "Firmware", color: "#c9a7ff" },
  offline: { letter: "!", name: "No readings", color: "#ff6b6b" },
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ts = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
};

export function tempUnit() {
  try {
    return globalThis.localStorage?.getItem(UNIT_KEY) === "F" ? "F" : "C";
  } catch {
    return "C";
  }
}

export function toUnit(c, unit) {
  const v = num(c);
  if (v == null) return null;
  return unit === "F" ? (v * 9) / 5 + 32 : v;
}

/** Value text with its unit: "20.4 °C", "88%". */
export function valueText(series, v, unit = "C") {
  if (v == null) return "no reading";
  if (series.key === "temperature") return `${toUnit(v, unit).toFixed(1)} °${unit}`;
  if (series.unit === "ppm") return `${Math.round(v)} ppm`;
  return `${Math.round(v)}${series.unit}`;
}

/** About n round tick values that cover [min, max]. */
export function niceTicks(min, max, n = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / Math.max(1, n - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: lo, max: hi, ticks };
}

/** Local time ticks between t0 and t1 with at least minPx between labels. */
export function timeTicks(t0, t1, width, { minPx = 40 } = {}) {
  const span = t1 - t0;
  const steps = [1, 2, 3, 4, 6, 12, 24, 48, 72].map((h) => h * HOUR);
  const step = steps.find((s) => (s / span) * width >= minPx) || steps[steps.length - 1];
  const start = new Date(t0);
  start.setMinutes(0, 0, 0);
  if (step >= 24 * HOUR) start.setHours(0);
  else start.setHours(Math.floor(start.getHours() / (step / HOUR)) * (step / HOUR));
  const ticks = [];
  const d = new Date(start);
  while (d.getTime() <= t1 && ticks.length < 200) {
    if (d.getTime() >= t0) ticks.push({ t: d.getTime(), day: step >= 24 * HOUR, midnight: d.getHours() === 0 });
    if (step >= 24 * HOUR) d.setDate(d.getDate() + step / (24 * HOUR));
    else d.setHours(d.getHours() + step / HOUR);
  }
  return ticks;
}

export function tickLabel(tick) {
  const d = new Date(tick.t);
  if (tick.day) return `${d.toLocaleDateString([], { weekday: "short" })} ${d.getDate()}`;
  if (tick.midnight) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleTimeString([], { hour: "numeric" });
}

export function timeText(t, { range = 24 } = {}) {
  const d = new Date(t);
  const opts = { hour: "numeric", minute: "2-digit" };
  const sameDay = new Date().toDateString() === d.toDateString();
  if (range > 24 || !sameDay) opts.weekday = "short";
  return d.toLocaleString([], opts);
}

/** Readings with a time, oldest first. */
export function chartPoints(history = []) {
  return (history || [])
    .map((p) => ({ ...p, t: ts(p.at) }))
    .filter((p) => p.t != null)
    .sort((a, b) => a.t - b.t);
}

/** Gap length that breaks a line: 2.5 usual steps, never under 20 minutes. */
export function gapMs(points) {
  const steps = [];
  for (let i = 1; i < points.length; i++) steps.push(points[i].t - points[i - 1].t);
  steps.sort((a, b) => a - b);
  const usual = steps.length ? steps[Math.floor(steps.length / 2)] : 15 * 60 * 1000;
  return Math.max(GAP_FLOOR_MS, usual * 2.5);
}

/** Runs of consecutive readings with a value, split at gaps and offline spans. */
export function segments(points, key, { gap = gapMs(points), offline = [] } = {}) {
  const out = [];
  let run = [];
  let prev = null;
  for (const p of points) {
    const v = num(p[key]);
    if (v == null) {
      if (run.length) out.push(run);
      run = [];
      prev = null;
      continue;
    }
    const broken =
      prev &&
      (p.t - prev.t > gap || offline.some((o) => o.start >= prev.t - 1000 && o.end <= p.t + 1000 && o.end - o.start > 0));
    if (broken) {
      out.push(run);
      run = [];
    }
    run.push({ t: p.t, v });
    prev = p;
  }
  if (run.length) out.push(run);
  return out;
}

/** Index of the reading closest in time to t. */
export function nearestIndex(points, t) {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? lo : hi;
}

/** Point events grouped when their markers would overlap. */
export function clusterEvents(events, xOf, { minPx = 20 } = {}) {
  const groups = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const x = xOf(e.t);
    const last = groups[groups.length - 1];
    // Icons sit at each group's middle, so merge until no two middles are closer than one icon.
    if (last && x - last.x < minPx) {
      last.events.push(e);
      last.x1 = x;
      last.x = (last.x0 + last.x1) / 2;
      while (groups.length > 1 && groups[groups.length - 1].x - groups[groups.length - 2].x < minPx) {
        const top = groups.pop();
        const prev = groups[groups.length - 1];
        prev.events.push(...top.events);
        prev.x1 = top.x1;
        prev.x = (prev.x0 + prev.x1) / 2;
      }
    } else groups.push({ x0: x, x1: x, x, events: [e] });
  }
  return groups;
}

/** Which series to draw: the main two always, the others only when reported. */
export function visibleSeries(points) {
  return SERIES.filter((s) => s.main || points.some((p) => num(p[s.key]) != null));
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}

function pathFor(run, xOf, yOf, step) {
  let d = "";
  run.forEach((p, i) => {
    const x = xOf(p.t).toFixed(1);
    const y = yOf(p.v).toFixed(1);
    if (i === 0) d += `M${x} ${y}`;
    else if (step) d += `H${x}V${y}`;
    else d += `L${x} ${y}`;
  });
  return d;
}

/**
 * Mount the chart in root. opts.loadRange(hours) returns {history, events, range} for ranges
 * the base data does not cover (7 days). opts.title names the figure.
 */
export function mountReadingChart(root, opts = {}) {
  const state = {
    base: null,
    long: null,
    hours: opts.hours || 24,
    unit: tempUnit(),
    cursor: null,
    pinned: false,
    loading: false,
    error: "",
  };
  const id = `rc${Math.random().toString(36).slice(2, 8)}`;
  root.classList.add("rc");
  root.innerHTML = `
    <div class="rc-head">
      <h3 class="rc-title">${esc(opts.title || "Readings")}</h3>
      <div class="rc-tools">
        <div class="rc-seg" role="group" aria-label="Time range">
          ${RANGES.map((r) => `<button type="button" data-hours="${r.hours}" aria-pressed="false">${r.label}</button>`).join("")}
        </div>
        <div class="rc-seg" role="group" aria-label="Temperature unit">
          <button type="button" data-unit="C" aria-pressed="false">°C</button><button type="button" data-unit="F" aria-pressed="false">°F</button>
        </div>
      </div>
    </div>
    <div class="rc-readout">
      <p class="rc-when"></p>
      <ul class="rc-legend"></ul>
      <p class="rc-event"></p>
    </div>
    <div class="rc-plot"><svg class="rc-svg" tabindex="0" role="img" aria-labelledby="${id}-sum" focusable="true"></svg></div>
    <p class="rc-key muted"><span class="rc-key-band"></span> Stage target <span class="rc-key-dash"></span> Setpoint <span class="rc-key-off"></span> No readings</p>
    <p class="rc-sum visually-hidden" id="${id}-sum"></p>
    <p class="rc-msg muted" role="status"></p>
    <details class="rc-events"><summary>Events in this range</summary><ol></ol></details>`;
  const $ = (s) => root.querySelector(s);
  const svg = $(".rc-svg");
  let layout = null;

  function current() {
    if (state.hours > 24 && state.long) return state.long;
    return state.base;
  }

  function view() {
    const data = current() || {};
    const until = ts(data.range?.until) ?? Date.now();
    const t1 = Math.max(until, ...chartPoints(data.history).map((p) => p.t));
    const t0 = t1 - state.hours * HOUR;
    const points = chartPoints(data.history).filter((p) => p.t >= t0 && p.t <= t1);
    const events = (data.events || [])
      .map((e) => ({ ...e, t: ts(e.at), tEnd: ts(e.end) }))
      .filter((e) => e.t != null && (e.tEnd ?? e.t) >= t0 && e.t <= t1);
    return { data, t0, t1, points, events, device: data.device || opts.device || null };
  }

  function draw() {
    const v = view();
    for (const b of root.querySelectorAll("[data-hours]")) b.setAttribute("aria-pressed", String(Number(b.dataset.hours) === state.hours));
    for (const b of root.querySelectorAll("[data-unit]")) b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit));
    $(".rc-msg").textContent = state.loading ? "Loading 7 days of readings..." : state.error;
    const width = Math.max(280, Math.round($(".rc-plot").clientWidth || 360));
    const wide = width >= 560;
    const series = visibleSeries(v.points);
    const pad = { l: wide ? 44 : 36, r: 10 };
    const strip = 26;
    const panels = [];
    let y = strip;
    for (const s of series) {
      const h = s.main ? (wide ? 150 : 112) : wide ? 64 : 52;
      panels.push({ s, top: y + 16, h });
      y += 16 + h + 10;
    }
    const height = y + 14;
    const xOf = (t) => pad.l + ((t - v.t0) / (v.t1 - v.t0)) * (width - pad.l - pad.r);
    const tOf = (x) => v.t0 + ((x - pad.l) / (width - pad.l - pad.r)) * (v.t1 - v.t0);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.replaceChildren();
    const defs = el("defs");
    const pat = el("pattern", { id: `${id}-hatch`, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.append(el("rect", { width: 6, height: 6, fill: "rgba(255,107,107,0.07)" }), el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "rgba(255,107,107,0.35)", "stroke-width": 1.2 }));
    defs.append(pat);
    svg.append(defs);

    const plotTop = strip;
    const plotBottom = height - 14;
    const offline = v.events.filter((e) => e.type === "offline" && e.tEnd != null).map((e) => ({ ...e, start: e.t, end: e.tEnd }));
    const gap = gapMs(v.points);
    const unitT = state.unit;
    const targets = v.device?.targets || null;

    // Time grid and labels.
    const ticks = timeTicks(v.t0, v.t1, width - pad.l - pad.r);
    const grid = el("g", { class: "rc-grid" });
    for (const tick of ticks) {
      const x = xOf(tick.t);
      grid.append(el("line", { x1: x, x2: x, y1: plotTop, y2: plotBottom - 4, class: tick.midnight || tick.day ? "rc-gl rc-gl-day" : "rc-gl" }));
      const label = el("text", { x, y: height - 2, "text-anchor": "middle", class: "rc-tl" });
      label.textContent = tickLabel(tick);
      grid.append(label);
    }
    svg.append(grid);

    // Offline spans across every panel.
    for (const o of offline) {
      const x0 = Math.max(pad.l, xOf(o.start));
      const x1 = Math.min(width - pad.r, xOf(o.end));
      if (x1 - x0 < 0.5) continue;
      svg.append(el("rect", { x: x0, y: plotTop, width: Math.max(1.5, x1 - x0), height: plotBottom - 4 - plotTop, fill: `url(#${id}-hatch)`, class: "rc-off" }));
    }

    layout = { panels: [], xOf, tOf, width, height, pad, points: v.points, events: v.events, series, clusters: [] };
    for (const p of panels) {
      const s = p.s;
      const conv = s.key === "temperature" ? (c) => toUnit(c, unitT) : (c) => num(c);
      const values = [];
      for (const pt of v.points) {
        const a = conv(pt[s.key]);
        if (a != null) values.push(a);
        if (s.setpoint) {
          const b = conv(pt[s.setpoint]);
          if (b != null) values.push(b);
        }
      }
      const band = s.band && targets ? [conv(targets[s.band[0]]), conv(targets[s.band[1]])] : null;
      const hasBand = band && band[0] != null && band[1] != null && band[1] > band[0];
      if (hasBand && values.length) values.push(band[0], band[1]);
      let lo = values.length ? Math.min(...values) : s.key === "temperature" ? conv(15) : 60;
      let hi = values.length ? Math.max(...values) : s.key === "temperature" ? conv(25) : 100;
      const padV = Math.max((hi - lo) * 0.12, s.key === "temperature" ? 0.5 : 2);
      lo -= padV;
      hi += padV;
      if (s.clamp) {
        lo = Math.max(s.clamp[0], lo);
        hi = Math.min(s.clamp[1], hi);
      }
      const scale = niceTicks(lo, hi, s.main ? 5 : 3);
      if (s.clamp) {
        scale.min = Math.max(s.clamp[0], scale.min);
        scale.max = Math.min(s.clamp[1], scale.max);
        scale.ticks = scale.ticks.filter((t) => t >= scale.min && t <= scale.max);
      }
      const yOf = (val) => p.top + p.h - ((val - scale.min) / (scale.max - scale.min || 1)) * p.h;
      const g = el("g", { class: "rc-panel" });
      const unitLabel = s.key === "temperature" ? `°${unitT}` : s.unit;
      const title = el("text", { x: pad.l, y: p.top - 5, class: "rc-pt" });
      title.textContent = `${s.name} (${unitLabel})`;
      g.append(title);
      g.append(el("rect", { x: pad.l, y: p.top, width: width - pad.l - pad.r, height: p.h, class: "rc-frame" }));
      if (hasBand) {
        const yb0 = yOf(Math.min(scale.max, band[1]));
        const yb1 = yOf(Math.max(scale.min, band[0]));
        g.append(el("rect", { x: pad.l, y: yb0, width: width - pad.l - pad.r, height: Math.max(1, yb1 - yb0), fill: s.color, "fill-opacity": 0.11, class: "rc-band" }));
      }
      for (const tick of scale.ticks) {
        const yy = yOf(tick);
        g.append(el("line", { x1: pad.l, x2: width - pad.r, y1: yy, y2: yy, class: "rc-gl" }));
        const label = el("text", { x: pad.l - 5, y: yy + 3.5, "text-anchor": "end", class: "rc-yl" });
        label.textContent = String(Math.round(tick * 10) / 10);
        g.append(label);
      }
      if (s.setpoint) {
        for (const run of segments(v.points.map((pt) => ({ t: pt.t, v: conv(pt[s.setpoint]) })), "v", { gap, offline })) {
          g.append(el("path", { d: pathFor(run, xOf, yOf, true), class: "rc-sp", stroke: s.color }));
        }
      }
      for (const run of segments(v.points.map((pt) => ({ t: pt.t, v: conv(pt[s.key]) })), "v", { gap, offline })) {
        if (run.length === 1) g.append(el("circle", { cx: xOf(run[0].t), cy: yOf(run[0].v), r: 2, fill: s.color }));
        else g.append(el("path", { d: pathFor(run, xOf, yOf, s.step), class: "rc-line", stroke: s.color }));
      }
      svg.append(g);
      layout.panels.push({ ...p, yOf, conv, scale });
    }

    // Event markers: a line through the panels and an icon in the top strip.
    const pointEvents = v.events.filter((e) => e.type !== "offline");
    const offlineMarks = v.events.filter((e) => e.type === "offline");
    const marks = [...pointEvents, ...offlineMarks.map((e) => ({ ...e, t: Math.max(e.t, v.t0) }))].sort((a, b) => a.t - b.t);
    layout.clusters = clusterEvents(marks, xOf);
    const eg = el("g", { class: "rc-events-g" });
    for (const c of layout.clusters) {
      for (const e of c.events) {
        if (e.type === "offline") continue;
        eg.append(el("line", { x1: xOf(e.t), x2: xOf(e.t), y1: strip - 4, y2: plotBottom - 4, class: "rc-ev-line", stroke: EVENT_KINDS[e.type]?.color || "#8aa396" }));
      }
      const kind = EVENT_KINDS[c.events[0].type] || EVENT_KINDS.setpoint;
      const mixed = c.events.some((e) => (EVENT_KINDS[e.type]?.letter || "") !== kind.letter);
      const cx = Math.min(width - pad.r - 9, Math.max(pad.l + 9, c.x));
      const icon = el("g", { class: "rc-ev", transform: `translate(${cx.toFixed(1)} ${strip / 2 - 1})` });
      icon.append(el("circle", { r: 9, fill: "#07110e", stroke: mixed ? "#e8f3ea" : kind.color, "stroke-width": 1.5 }));
      const txt = el("text", { y: 3.8, "text-anchor": "middle", fill: mixed ? "#e8f3ea" : kind.color, class: "rc-ev-t" });
      txt.textContent = c.events.length > 1 ? String(c.events.length) : kind.letter;
      icon.append(txt);
      eg.append(icon);
      c.cx = cx;
    }
    svg.append(eg);

    // Crosshair layer, drawn on demand.
    layout.cross = el("g", { class: "rc-cross", visibility: "hidden" });
    svg.append(layout.cross);

    renderEventList(v);
    summary(v);
    readout();
  }

  function summary(v) {
    const last = v.points[v.points.length - 1];
    const parts = layout.series.map((s) => `${s.name} ${valueText(s, num(last?.[s.key]), state.unit)}`);
    const range = RANGES.find((r) => r.hours === state.hours)?.label || `${state.hours}h`;
    $(".rc-sum").textContent = last
      ? `Chart of the last ${range}. Latest at ${timeText(last.t)}: ${parts.join(", ")}. ${v.events.length} events in this range, listed below the chart.`
      : `No readings in the last ${range}.`;
  }

  function renderEventList(v) {
    const list = $(".rc-events ol");
    const items = v.events.slice().reverse();
    $(".rc-events summary").textContent = items.length ? `Events in this range (${items.length})` : "No events in this range";
    $(".rc-events").classList.toggle("rc-empty", !items.length);
    list.innerHTML = items
      .map((e, i) => {
        const k = EVENT_KINDS[e.type] || EVENT_KINDS.setpoint;
        return `<li><button type="button" class="rc-ev-item" data-i="${v.events.length - 1 - i}">
          <span class="rc-ev-badge" style="--c:${k.color}" aria-hidden="true">${esc(k.letter)}</span>
          <span><strong>${esc(e.title)}</strong> <time datetime="${esc(e.at)}">${esc(timeText(e.t, { range: 168 }))}</time>
          ${e.detail ? `<br><span class="muted">${esc(e.detail)}</span>` : ""}</span></button></li>`;
      })
      .join("");
  }

  function readout() {
    if (!layout) return;
    const pts = layout.points;
    const idx = state.cursor != null ? nearestIndex(pts, state.cursor) : pts.length - 1;
    const pt = pts[idx];
    const cross = layout.cross;
    cross.replaceChildren();
    if (state.cursor != null && pt) {
      const x = layout.xOf(pt.t);
      cross.append(el("line", { x1: x, x2: x, y1: 22, y2: layout.height - 18, class: "rc-cross-line" }));
      for (const p of layout.panels) {
        const val = p.conv(pt[p.s.key]);
        if (val == null) continue;
        cross.append(el("circle", { cx: x, cy: p.yOf(Math.min(p.scale.max, Math.max(p.scale.min, val))), r: 3.5, fill: p.s.color, stroke: "#07110e", "stroke-width": 1.5 }));
      }
      cross.setAttribute("visibility", "visible");
    } else cross.setAttribute("visibility", "hidden");
    $(".rc-when").textContent = pt ? `${state.cursor != null ? "At" : "Latest"} ${timeText(pt.t, { range: state.hours })}` : "No readings in this range yet";
    $(".rc-legend").innerHTML = layout.series
      .map((s) => {
        const val = num(pt?.[s.key]);
        const sp = s.setpoint ? num(pt?.[s.setpoint]) : null;
        const spText = sp != null ? ` <span class="muted">set ${esc(valueText(s, sp, state.unit))}</span>` : "";
        return `<li><span class="rc-sw" style="--c:${s.color}" aria-hidden="true"></span><span class="rc-ln">${esc(s.name)}</span> <strong>${esc(valueText(s, val, state.unit))}</strong>${spText}</li>`;
      })
      .join("");
    const evBox = $(".rc-event");
    const near = state.cursor != null ? nearEvents(state.cursor) : [];
    evBox.classList.toggle("is-hint", !near.length);
    evBox.innerHTML = !near.length
      ? `<span>Hover or tap the chart to read any time. Lettered markers show changes.</span>`
      : near
      .slice(0, 2)
      .map((e) => {
        const k = EVENT_KINDS[e.type] || EVENT_KINDS.setpoint;
        return `<span class="rc-ev-row"><span class="rc-ev-badge" style="--c:${k.color}" aria-hidden="true">${esc(k.letter)}</span><span><strong>${esc(e.title)}</strong> ${esc(timeText(e.t, { range: 168 }))}${e.detail ? `. ${esc(e.detail)}` : ""}</span></span>`;
      })
      .join("") + (near.length > 2 ? `<span class="muted">And ${near.length - 2} more in the list below.</span>` : "");
  }

  /** Events under the cursor: the marker cluster within reach, or an offline span it is inside. */
  function nearEvents(t) {
    const x = layout.xOf(t);
    const hit = layout.clusters.find((c) => Math.abs((c.cx ?? c.x) - x) <= 12);
    const inside = layout.events.filter((e) => e.type === "offline" && e.tEnd != null && t >= e.t && t <= e.tEnd);
    const list = [...(hit ? hit.events : []), ...inside];
    return [...new Set(list)];
  }

  function pointerTime(ev) {
    const rect = svg.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * layout.width;
    const clamped = Math.min(layout.width - layout.pad.r, Math.max(layout.pad.l, x));
    const hit = layout.clusters.find((c) => Math.abs((c.cx ?? c.x) - x) <= 12);
    return hit && hit.events.length ? hit.events[0].t : layout.tOf(clamped);
  }

  svg.addEventListener("pointermove", (ev) => {
    if (!layout || (ev.pointerType !== "mouse" && !state.pinned)) return;
    state.cursor = pointerTime(ev);
    readout();
  });
  svg.addEventListener("pointerdown", (ev) => {
    if (!layout) return;
    state.cursor = pointerTime(ev);
    state.pinned = ev.pointerType !== "mouse";
    readout();
  });
  svg.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType === "mouse") {
      state.cursor = null;
      readout();
    }
  });
  svg.addEventListener("pointerup", () => {
    state.pinned = false;
  });
  svg.addEventListener("keydown", (ev) => {
    if (!layout?.points.length) return;
    const pts = layout.points;
    let i = state.cursor != null ? nearestIndex(pts, state.cursor) : pts.length - 1;
    if (ev.key === "ArrowLeft") i = Math.max(0, i - 1);
    else if (ev.key === "ArrowRight") i = Math.min(pts.length - 1, i + 1);
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = pts.length - 1;
    else if (ev.key === "Escape") {
      state.cursor = null;
      readout();
      return;
    } else return;
    ev.preventDefault();
    state.cursor = pts[i].t;
    readout();
  });
  svg.addEventListener("blur", () => {
    state.cursor = null;
    readout();
  });
  document.addEventListener("pointerdown", (ev) => {
    if (state.cursor != null && !root.contains(ev.target)) {
      state.cursor = null;
      readout();
    }
  });
  root.addEventListener("click", async (ev) => {
    const item = ev.target.closest(".rc-ev-item");
    if (item) {
      const e = view().events[Number(item.dataset.i)];
      if (e) {
        state.cursor = e.t;
        readout();
        svg.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      }
      return;
    }
    const unitBtn = ev.target.closest("[data-unit]");
    if (unitBtn) {
      state.unit = unitBtn.dataset.unit === "F" ? "F" : "C";
      try {
        localStorage.setItem(UNIT_KEY, state.unit);
      } catch {}
      draw();
      return;
    }
    const rangeBtn = ev.target.closest("[data-hours]");
    if (!rangeBtn) return;
    state.hours = Number(rangeBtn.dataset.hours);
    state.cursor = null;
    state.error = "";
    if (state.hours > 24 && opts.loadRange && (!state.long || Date.now() - state.long._at > 5 * 60 * 1000)) {
      state.loading = true;
      draw();
      try {
        const data = await opts.loadRange(state.hours);
        state.long = { ...data, _at: Date.now() };
      } catch {
        state.error = "Could not load 7 days of readings. Showing what is loaded.";
      }
      state.loading = false;
    }
    draw();
  });

  if (typeof ResizeObserver === "function") {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = Math.round($(".rc-plot").clientWidth);
      if (w && Math.abs(w - lastW) > 2 && state.base) {
        lastW = w;
        draw();
      }
    }).observe($(".rc-plot"));
  }

  return {
    update(data) {
      state.base = data;
      draw();
    },
    get hours() {
      return state.hours;
    },
  };
}
