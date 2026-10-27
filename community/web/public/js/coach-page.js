/** Grow Coach page for people who can use Coach: recommendations, the decision feed, and chamber status. */

import { chamberStatus, growDayLine, identityArt, MUSHROOM_ICON, phaseLine, readingWhenLine, renderChamberStatus } from "./device-ui.js";
import { escapeHtml } from "./safe-markdown.js";

const GLUED_UNITS = new Set(["%", ":00"]);

function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n * 10) / 10);
}

/** "17 °C", "90%", "8:00". */
export function withUnit(value, unit = "") {
  if (value == null || value === "") return "";
  const shown = typeof value === "number" || /^-?\d+(\.\d+)?$/.test(String(value)) ? round(value) : String(value);
  if (!unit) return shown;
  return GLUED_UNITS.has(unit) ? `${shown}${unit}` : `${shown} ${unit}`;
}

/** "Temperature 18 to 17 °C". A first value with no earlier one reads "set to". */
export function changeText(change) {
  const to = withUnit(change.to, change.unit);
  if (change.from == null || change.from === "") return / at$/.test(change.label) ? `${change.label} ${to}` : `${change.label} set to ${to}`;
  const from = change.unit && !GLUED_UNITS.has(change.unit) ? round(change.from) : withUnit(change.from, change.unit);
  return `${change.label} ${from} to ${to}`;
}

export function deciderText(decider) {
  if (!decider || decider.who !== "jev") return "Rules";
  const pct = Number.isFinite(Number(decider.confidence)) ? `, ${Math.round(Number(decider.confidence) * 100)}% sure` : "";
  return `Jev${pct}`;
}

const NOT_APPLIED_LABEL = {
  expired: "Expired before the chamber picked it up",
  failed: "The chamber could not apply it",
  refused: "The chamber turned it down",
};

export function outcomeText(entry) {
  if (entry.outcome === "undone") return "Undone";
  if (entry.outcome === "applied") return entry.action === "undo" ? "Put back on the chamber" : "Applied on the chamber";
  if (entry.outcome === "waiting") return "Waiting for the chamber to pick it up";
  if (entry.outcome === "not_applied") return NOT_APPLIED_LABEL[entry.apply_status] || NOT_APPLIED_LABEL[entry.action] || "Did not reach the chamber";
  return "";
}

/** Long change lists read as a wall, so the title names the first few. */
const MAX_TITLE_CHANGES = 4;

export function decisionTitle(entry) {
  const all = (entry.changes || []).map(changeText);
  const changes = all.length > MAX_TITLE_CHANGES ? `${all.slice(0, MAX_TITLE_CHANGES).join(", ")} and ${all.length - MAX_TITLE_CHANGES} more` : all.join(", ");
  if (entry.action === "pause") return "Coach stopped adjusting";
  if (entry.action === "undo") return changes ? `Put back: ${changes}` : "Put back the earlier settings";
  return changes || "No setting changed";
}

export function timeText(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${clock}` : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${clock}`;
}

export function renderDecision(entry, { now = Date.now() } = {}) {
  const meta = [entry.device_name, deciderText(entry.decider), timeText(entry.created_at, now)].filter(Boolean).join(" · ");
  const outcome = outcomeText(entry);
  const undo = entry.undoable ? `<button type="button" class="secondary small" data-undo="${Number(entry.id)}">Undo</button>` : "";
  return `<li class="coach-decision is-${escapeHtml(entry.outcome || entry.action)}" data-id="${Number(entry.id)}">
    <div>
      <strong>${escapeHtml(decisionTitle(entry))}</strong>
      <p class="muted">${escapeHtml(meta)}</p>
      ${entry.reason ? `<p>${escapeHtml(entry.reason)}</p>` : ""}
      ${outcome ? `<p class="coach-outcome">${escapeHtml(outcome)}</p>` : ""}
    </div>
    ${undo}
  </li>`;
}

export function renderDecisions(entries = [], opts = {}) {
  return entries.map((e) => renderDecision(e, opts)).join("");
}

export const NO_DECISIONS = "Coach has not changed anything yet. Changes show up here as Coach makes them.";

function clock(iso) {
  const at = Date.parse(iso || "");
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

/** "17 °C, 90% humidity, fan 25%". */
export function setpointText(s = {}) {
  return [
    s.temperature_c != null ? withUnit(s.temperature_c, "°C") : "",
    s.humidity_percent != null ? `${withUnit(s.humidity_percent, "%")} humidity` : "",
    s.fan_speed_percent != null ? `fan ${withUnit(s.fan_speed_percent, "%")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function suggestionLines(suggestion, current = {}) {
  const rows = [
    ["Temperature", suggestion.temperature_c, current.temperature_c, "°C"],
    ["Humidity", suggestion.humidity_percent, current.humidity_percent, "%"],
    ["Fan", suggestion.fan_speed_percent, current.fan_speed_percent, "%"],
  ].filter(([, to]) => to != null);
  return rows
    .map(([label, to, from, unit]) => {
      const now = from == null ? "" : ` <span class="muted">(now ${escapeHtml(withUnit(from, unit))})</span>`;
      return `<li>${escapeHtml(label)} <strong>${escapeHtml(withUnit(to, unit))}</strong>${now}</li>`;
    })
    .join("");
}

/** True when the Accept button makes sense: Coach is not adjusting it itself, the numbers differ, and the chamber takes commands. */
export function canAccept(chamber) {
  const rec = chamber.recommendation;
  if (!rec?.suggestion || !rec.differs || !rec.suggestion.within_bounds) return false;
  if (!chamber.device?.controllable || chamber.device?.controls?.temperature?.supported === false) return false;
  const auto = chamber.autopilot;
  return !(auto && auto.mode === "autopilot" && auto.status !== "paused");
}

export function renderRecommendation(chamber) {
  const { device, autopilot, recommendation: rec } = chamber;
  if (!rec) return "";
  const parts = [];
  const autoOn = autopilot?.mode === "autopilot" && autopilot?.status !== "paused";
  if (rec.todo?.length) {
    parts.push(`<ul class="coach-todo">${rec.todo.map((t) => `<li>${escapeHtml(t.message)}</li>`).join("")}</ul>`);
  }
  if (rec.pending) {
    const changes = (rec.pending.changes || []).map(changeText).join(", ") || "New settings";
    parts.push(`<div class="coach-pending">
      <p><strong>On its way:</strong> ${escapeHtml(changes)}. The chamber picks it up at its next check-in.</p>
      ${rec.pending.undoable ? `<button type="button" class="secondary small" data-undo="${Number(rec.pending.id)}">Undo</button>` : ""}
    </div>`);
  }
  if (rec.suggestion) {
    const reasons = (rec.suggestion.reasons || []).join(" ");
    if (autoOn) {
      const next = clock(autopilot.next_eligible_at);
      parts.push(`<p>Coach is steering toward <strong>${escapeHtml(setpointText(rec.suggestion))}</strong>.${
        next && Date.parse(autopilot.next_eligible_at) > Date.now() ? ` Next change no sooner than ${escapeHtml(next)}.` : ""
      }</p>`);
      if (reasons) parts.push(`<p class="muted">${escapeHtml(reasons)}</p>`);
    } else if (rec.differs) {
      parts.push(`<p>Coach suggests:</p><ul class="coach-suggest">${suggestionLines(rec.suggestion, rec.current)}</ul>`);
      if (reasons) parts.push(`<p class="muted">${escapeHtml(reasons)}</p>`);
      if (canAccept(chamber)) {
        parts.push(`<p class="row"><button type="button" data-accept="${escapeHtml(device.id)}">Accept and send to chamber</button></p>`);
      } else if (!rec.suggestion.within_bounds) {
        parts.push(`<p class="muted">This is outside the profile's safe range, so Coach won't send it.</p>`);
      } else if (!device.controllable) {
        parts.push(`<p class="muted">This chamber can't take changes from the site right now.</p>`);
      }
    } else {
      parts.push(`<p>Settings match what Coach would pick. Nothing to change.</p>`);
    }
  } else if (rec.note) {
    parts.push(`<p class="muted">${escapeHtml(rec.note)}</p>`);
  }
  if (!parts.length) parts.push(`<p>Nothing to do right now.</p>`);
  const stage = rec.stage?.name ? ` <span class="muted">· ${escapeHtml(rec.stage.name)}</span>` : "";
  return `<article class="card coach-rec" data-device-id="${escapeHtml(device.id)}">
    <h3>${escapeHtml(device.name || "Chamber")}${stage}</h3>
    ${parts.join("\n    ")}
    <p class="coach-msg muted" role="status"></p>
  </article>`;
}

export function renderRecommendations(chambers = []) {
  const cards = chambers.filter((c) => c.recommendation).map(renderRecommendation);
  if (!cards.length) {
    return chambers.length
      ? `<p class="muted">Coach works with culinary grows. Pick a culinary profile on a chamber to get suggestions.</p>`
      : `<p class="muted">Link a chamber to get suggestions. <a href="/devices">Your devices</a></p>`;
  }
  return cards.join("");
}

export function modeText(autopilot) {
  if (!autopilot) return "";
  if (autopilot.status === "paused") return `Paused. ${autopilot.pause_reason || "Coach stopped adjusting."}`;
  if (autopilot.mode === "autopilot") return "Autopilot. Coach adjusts it for you.";
  return "Advisor. Coach suggests, you approve.";
}

function lightText(light) {
  if (!light) return "";
  const hours = light.duration_hours;
  const lux = light.white_led_lux;
  const parts = [];
  if (hours != null) parts.push(`${round(hours)} h`);
  if (lux != null) parts.push(`${round(lux)} lux`);
  return parts.join(", ");
}

function rangeText(min, max, unit) {
  if (min == null && max == null) return null;
  if (min != null && max != null && Number(min) !== Number(max)) return `${round(min)} to ${withUnit(max, unit)}`;
  return withUnit(min ?? max, unit);
}

/** Gauges for temperature, humidity, fan, and light, each against the chamber's setpoint and the recipe target. */
export function renderCoachGauges(device) {
  const t = device.targets || {};
  const sp = device.setpoints || {};
  const target = (setpoint, band, unit) => {
    const bits = [];
    if (setpoint != null) bits.push(`set ${withUnit(setpoint, unit)}`);
    if (band) bits.push(`recipe ${band}`);
    return bits.join(", ");
  };
  const cell = (label, value, unit, note) => `<div class="device-gauge">
      <span class="gauge-label">${escapeHtml(label)}</span>
      <strong>${value == null || value === "" ? `<span class="gauge-missing">Not reported</span>` : escapeHtml(withUnit(value, unit))}</strong>
      ${note ? `<span class="gauge-target">${escapeHtml(note)}</span>` : ""}
    </div>`;
  const fanNow = device.reading?.fan_speed ?? device.chamber?.air_exchange_speed ?? sp.fan_speed_percent;
  const light = device.chamber_light;
  const lightNow = lightText(light);
  const lightGoal = lightText(device.light);
  return `<div class="device-gauges coach-gauges" aria-label="Live readings">
    ${cell("Temperature", device.reading?.temperature, "°C", target(sp.temperature_c, rangeText(t.temperature_min, t.temperature_max, "°C"), "°C"))}
    ${cell("Humidity", device.reading?.humidity, "%", target(sp.humidity_percent, rangeText(t.humidity_min, t.humidity_max, "%"), "%"))}
    ${cell("Fan", fanNow, "%", t.fan_speed_percent != null ? `recipe ${withUnit(t.fan_speed_percent, "%")}` : "")}
    <div class="device-gauge">
      <span class="gauge-label">Light</span>
      <strong>${lightNow ? escapeHtml(lightNow) : `<span class="gauge-missing">Not reported</span>`}</strong>
      ${light?.sunrise_hour != null ? `<span class="gauge-target">on at ${escapeHtml(withUnit(light.sunrise_hour, ":00"))}</span>` : ""}
      ${lightGoal ? `<span class="gauge-target">recipe ${escapeHtml(lightGoal)}</span>` : ""}
    </div>
  </div>`;
}

export function renderModeToggle(chamber) {
  const auto = chamber.autopilot;
  if (!auto) return "";
  const isAuto = auto.mode === "autopilot";
  const id = escapeHtml(chamber.device.id);
  return `<div class="mode-toggle" role="group" aria-label="Coach mode for ${escapeHtml(chamber.device.name || "this chamber")}">
    <button type="button" data-mode="advisor" data-device="${id}" aria-pressed="${isAuto ? "false" : "true"}">I approve changes</button>
    <button type="button" data-mode="autopilot" data-device="${id}" aria-pressed="${isAuto ? "true" : "false"}">Coach adjusts it</button>
  </div>`;
}

function readingWhen(device, now) {
  const at = Date.parse(device?.reading?.reading_at || "");
  if (!Number.isFinite(at)) return device?.reading ? "" : readingWhenLine(device, now);
  const mins = Math.max(0, Math.round((now - at) / 60000));
  const clock = new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Readings from ${clock}${mins >= 1 ? ` (${mins} min ago)` : " (just now)"}.`;
}

export function renderChamberCard(chamber, { now = Date.now() } = {}) {
  const { device } = chamber;
  const name = escapeHtml(device.name || "Chamber");
  const link = `/device?id=${encodeURIComponent(device.id)}`;
  if (device.off_menu) {
    return `<article class="card coach-chamber is-off-menu">
      <h3><a href="${link}">${name}</a></h3>
      ${renderChamberStatus(device, now)}
      <p class="muted">Coach works with culinary grows only, so it stays out of this chamber.</p>
    </article>`;
  }
  const st = chamberStatus(device, now);
  const art = identityArt(device);
  const phase = phaseLine(device);
  const growDay = growDayLine(device);
  const growing = device.profile
    ? `<div class="coach-growing">
        <div class="coach-growing-art">${art || MUSHROOM_ICON}</div>
        <div>
          <p class="device-card-kicker">What is growing</p>
          <p class="device-card-species">${escapeHtml(device.profile.name || device.profile.species || "")}</p>
          ${phase ? `<p class="muted">${escapeHtml(phase)}</p>` : ""}
          ${growDay ? `<p class="muted">${escapeHtml(growDay)}</p>` : ""}
        </div>
      </div>`
    : `<p class="muted">Nothing picked yet. <a href="${link}#grow">Pick what you're growing</a></p>`;
  // The status block above already says when it last checked in, or that it is waiting for the first one.
  const readings = device.reading ? renderCoachGauges(device) : "";
  const when = st.kind === "waiting" ? "" : readingWhen(device, now);
  return `<article class="card coach-chamber" data-device-id="${escapeHtml(device.id)}">
    <h3><a href="${link}">${name}</a></h3>
    ${renderChamberStatus(device, now)}
    ${growing}
    ${readings}
    ${device.reading ? `<div class="coach-chart" data-chart-device="${escapeHtml(device.id)}"></div>` : ""}
    ${when ? `<p class="muted device-reading-when">${escapeHtml(when)}</p>` : ""}
    ${chamber.autopilot ? `<p class="coach-mode-line"><strong>Mode:</strong> ${escapeHtml(modeText(chamber.autopilot))}</p>` : ""}
    ${renderModeToggle(chamber)}
    <p class="coach-msg muted" role="status"></p>
  </article>`;
}

export function renderChamberCards(chambers = [], opts = {}) {
  if (!chambers.length) return `<p class="muted">No chambers linked yet. <a href="/devices">Your devices</a></p>`;
  return chambers.map((c) => renderChamberCard(c, opts)).join("");
}

/* ---------- access and pricing copy ---------- */

function dollars(cents) {
  const n = Number(cents) / 100;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** "Grow Coach is $4.99 a month or $49 a year." from the catalog plans, with the launch prices as a fallback. */
export function priceText(product = {}) {
  const plans = Array.isArray(product.plans) ? product.plans : [];
  const monthly = plans.find((p) => p.period === "month")?.amount_cents ?? product.amount_cents ?? 499;
  const yearly = plans.find((p) => p.period === "year")?.amount_cents ?? 4900;
  return `Grow Coach is ${dollars(monthly)} a month or ${dollars(yearly)} a year.`;
}

export const BETA_FREE = "Free during the beta";

/** The line where the paywall would be, for someone who already has Coach. `until` is a formatted date. */
export function accessText(catalog = {}, until = "") {
  if (catalog.access === "beta") return `${BETA_FREE}. After the beta, ${priceText(catalog.product)}`;
  if (catalog.access === "comp") return "Free on this account. Culinary chambers only.";
  return until ? `Active through ${until}. Culinary chambers only.` : "Active. Culinary chambers only.";
}

/**
 * Which pre-dashboard view a visitor gets: "dashboard" (has access), "waitlist" (checkout not
 * open), "signin", "link" (signed in, no chamber linked yet) or "checkout".
 */
export function coachView(catalog = {}, signedIn = false) {
  if (signedIn && (catalog.entitled || catalog.autopilot)) return "dashboard";
  if (!signedIn) return catalog.waitlist ? "waitlist" : "signin";
  if (!Number(catalog.chambers)) return "link";
  return catalog.waitlist ? "waitlist" : "checkout";
}
