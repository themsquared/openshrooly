/** Free tool pages: the grow timeline calculator and the fresh air planner. Runs on /tools/* only. */
import "./lite.js";
import { SPECIES } from "./tool-species.js";
import { airChanges, buildIcs, chamberLiters, flowLpm, isoDay, timeline } from "./tool-math.js";
import { airResult, timelineResult } from "./tool-render.js";

const form = document.getElementById("tool-form");
const out = document.getElementById("tool-result");
const byId = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];
const params = new URLSearchParams(location.search);

/** One tool_use hit per page view, on the first real interaction. */
let used = false;
function track(name, itemId) {
  if (typeof globalThis.slTrack !== "function") return;
  if (name === "tool_use") {
    if (used) return;
    used = true;
  }
  globalThis.slTrack(name, { type: form.dataset.tool.replace(/-/g, "_"), item_id: itemId });
}

function presetSpecies(select) {
  const want = params.get("species");
  if (want && SPECIES.some((s) => s.id === want)) select.value = want;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function growTimeline() {
  const species = form.elements.species;
  const start = form.elements.start;
  const icsButton = document.getElementById("tl-ics");
  presetSpecies(species);
  start.value = params.get("start") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("start")) ? params.get("start") : localToday();
  if (params.get("from") === "kit") form.querySelector('input[name="from"][value="kit"]').checked = true;
  let current = null;

  function render(interacted) {
    const s = byId(species.value);
    const fromKit = form.querySelector('input[name="from"]:checked')?.value === "kit";
    const plan = timeline(s, { start: start.value, fromKit });
    current = { s, plan };
    out.innerHTML = timelineResult(s, plan, { fromKit });
    icsButton.disabled = plan.rows[0]?.start === undefined;
    if (interacted) track("tool_use", s.id);
  }

  form.addEventListener("change", () => render(true));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    render(true);
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  icsButton.addEventListener("click", () => {
    if (!current || current.plan.rows[0]?.start === undefined) return;
    const blob = new Blob([buildIcs(current.s, current.plan, { site: location.origin })], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${current.s.id}-grow-${isoDay(current.plan.rows[0].start)}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    track("tool_use", current.s.id);
    track("ics_download", current.s.id);
  });
  render(false);
}

function freshAirPlanner() {
  const el = form.elements;
  presetSpecies(el.species);

  function fillStages(keep) {
    const s = byId(el.species.value);
    const prev = keep || el.stage.value;
    el.stage.innerHTML = s.stages.map((st) => `<option value="${st.id}">${st.name}</option>`).join("");
    el.stage.value = s.stages.some((st) => st.id === prev) ? prev : "fruiting";
    if (!el.stage.value) el.stage.value = s.stages[s.stages.length - 1].id;
  }
  function fillFan() {
    const st = byId(el.species.value).stages.find((x) => x.id === el.stage.value);
    el.run.value = st.fan.run;
    el.every.value = st.fan.every;
  }
  function render(interacted) {
    const s = byId(el.species.value);
    const st = s.stages.find((x) => x.id === el.stage.value) || s.stages[s.stages.length - 1];
    const liters = chamberLiters(el.l.value, el.w.value, el.h.value, el.unit.value);
    const air = airChanges({ liters, lpm: flowLpm(el.flow.value, el.flowUnit.value), runS: Number(el.run.value), everyMin: Number(el.every.value) });
    out.innerHTML = airResult(s, st, liters, air);
    if (interacted) track("tool_use", s.id);
  }

  fillStages("fruiting");
  fillFan();
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", (e) => {
    if (e.target === el.species) {
      fillStages();
      fillFan();
    } else if (e.target === el.stage) fillFan();
    render(true);
  });
  render(false);
}

if (form && out) {
  if (form.dataset.tool === "grow-timeline") growTimeline();
  if (form.dataset.tool === "fresh-air-planner") freshAirPlanner();
}
