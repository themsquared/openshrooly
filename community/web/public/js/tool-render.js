/**
 * Result blocks for the two free tools. Shared by the build (scripts/tools/index.js renders the example)
 * and the browser (js/tools.js renders what the visitor enters), so both read the same.
 */
import { compareAch, fanLine, lightLine, REFERENCE_ACH, round, shortDay, tempText } from "./tool-math.js";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const table = (caption, heads, rows) =>
  `<div class="table-wrap"><table class="conditions-table tool-table"><caption>${caption}</caption><thead><tr>${heads
    .map((h) => `<th scope="col">${h}</th>`)
    .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

/** Result block for the timeline. Without a start date it shows day numbers. Shared with the browser. */
export function timelineResult(species, plan, { fromKit = false } = {}) {
  const dates = plan.rows[0]?.start !== undefined;
  const span = (r) => `${shortDay(r.start)} to ${shortDay(r.end)}`;
  const fmt = (r) => (dates ? span(r) : `Day ${r.from} to ${r.to}`);
  const rows = plan.rows.map(
    (r) =>
      `<tr><th scope="row">${esc(r.name)}</th><td>${fmt(r)}</td><td>${r.days}</td><td>${tempText(r.c)}</td><td>${r.rh}%</td><td>${fanLine(r)}</td><td>${lightLine(r)}</td></tr>`
  );
  const h = plan.harvest;
  const when = dates ? span(h) : `day ${h.from} to day ${h.to}`;
  return `<p class="tool-summary"><strong>${esc(species.name)}: about ${plan.total} days${fromKit ? " from a colonized kit" : ""}.</strong> First harvest window: ${when}.</p>
${table(`${esc(species.name)} grow timeline`, ["Stage", dates ? "Dates" : "Days", "Length (days)", "Temperature", "Humidity", "Fresh air", "Light"], rows)}
<p class="muted">Numbers from the free <a href="/profiles/${species.id}">${esc(species.name)} grow profile</a>. Mushrooms run on their own clock, so move to the next stage when you see the signs, not only when the date comes.</p>`;
}

const SAYS = {
  below: `below the ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} air changes an hour that oyster growing rooms are run at`,
  within: `within the ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} air changes an hour that oyster growing rooms are run at`,
  above: `above the ${REFERENCE_ACH.low} to ${REFERENCE_ACH.high} air changes an hour that oyster growing rooms are run at`,
};

/** Result block for the planner. Shared with the browser. */
export function airResult(species, stage, liters, air) {
  if (!air) return `<p class="tool-summary">Enter your chamber size and fan flow to see your air changes.</p>`;
  const growing = stage.id === "pinning" || stage.id === "fruiting";
  const verdict = compareAch(air.perHour);
  const advice = !growing
    ? `<p>During ${esc(stage.name.toLowerCase())} the block needs little fresh air, so a low number is fine here.</p>`
    : verdict === "below"
      ? `<p>To reach ${REFERENCE_ACH.low} an hour with this fan and cycle, run it about ${air.runFor(REFERENCE_ACH.low)} s each time, or run it more often. Watch for long stems and small caps.</p>`
      : verdict === "above"
        ? `<p>More air than that dries the surface faster. Watch for dry or cracked caps, and raise misting or humidity before cutting the air.</p>`
        : `<p>That is a good starting point. Let the mushrooms tell you the rest: long stems mean more air, dry caps mean more humidity.</p>`;
  return `<dl class="tool-stats">
<div><dt>Chamber volume</dt><dd>${round(liters, 1)} L</dd></div>
<div><dt>Air changes per hour</dt><dd>${round(air.perHour, 1)}</dd></div>
<div><dt>Air changes per fan run</dt><dd>${round(air.perRun, 2)}</dd></div>
<div><dt>Fan on</dt><dd>${round(air.dutyPercent, 1)}% of the time</dd></div>
<div><dt>Humidity target</dt><dd>${stage.rh}%</dd></div>
<div><dt>Profile fan cycle</dt><dd>${stage.fan.run} s every ${stage.fan.every} min</dd></div>
</dl>
<p class="tool-summary"><strong>${round(air.perHour, 1)} air changes an hour</strong>${growing ? `, ${SAYS[compareAch(air.perHour)]}` : ""}. ${esc(species.name)} ${esc(stage.name.toLowerCase())} runs at ${stage.rh}% humidity and ${tempText(stage.c)} in its <a href="/profiles/${species.id}">profile</a>.</p>
${advice}`;
}

