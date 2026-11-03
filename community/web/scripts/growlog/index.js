/**
 * /grow-log: the public log for the three Shroom Labs test chambers.
 * Rule: entries hold only what was measured or seen. No invented readings, yields, or photos.
 * To log a grow, add an object to ENTRIES with the fields in ENTRY_FIELDS. Missing values stay missing.
 */
import { link } from "../guides/data.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const CHAMBERS = [
  { id: "shrooly-a", name: "Shrooly A", hardware: "Shrooly", software: "OpenShrooly firmware with Grow Coach", status: "Starting soon", note: "Runs the free profile for the comparison species." },
  { id: "shrooly-b", name: "Shrooly B", hardware: "Shrooly", software: "OpenShrooly firmware with Grow Coach", status: "Starting soon", note: "Second Shrooly, so one odd block does not decide the result." },
  { id: "lykyn", name: "Lykyn Single-Tier", hardware: "Lykyn Single-Tier smart grow box", software: "Stock Lykyn controls for now", status: "Arriving, outside-control validation pending", note: "We still have to confirm Shroom Labs can read and set it from outside. Until then it runs on its own controls." },
];

export const COMPARISON = {
  species: "lions-mane",
  plan: "The same species from the same batch of blocks, started the same day, in both Shroolys and the Lykyn. We log days to first pins, days to first harvest, and fresh weight per flush.",
};

/** Every entry must use these keys. Values come from the chamber log or a scale, never from an estimate. */
export const ENTRY_FIELDS = [
  ["date", "Date (YYYY-MM-DD)"],
  ["chamber", "Chamber"],
  ["day", "Grow day"],
  ["stage", "Stage"],
  ["temp", "Temperature (°C, from the chamber log)"],
  ["rh", "Humidity (% RH, from the chamber log)"],
  ["note", "What we saw"],
  ["weight", "Harvest weight (g, scale, only on harvest days)"],
];

/** Real entries only. Empty until the first grow starts. */
export const ENTRIES = [];

export const GROW_LOG = {
  updated: "2026-11-03",
  title: "Mushroom grow log: Shrooly vs Lykyn, same species · Shroom Labs",
  h1: "Shroom Labs grow log",
  description: "A public log of three home mushroom chambers, two Shroolys and a Lykyn Single-Tier, growing the same species side by side. Starting soon.",
  answer: "We are setting up three chambers to log in public: two Shroolys and one Lykyn Single-Tier, growing the same species side by side. Nothing has started yet, so there are no readings, yields, or photos here. Entries go up as they happen.",
  faq: [
    { q: "When does the grow log start?", a: "When the Lykyn arrives and we confirm we can read and set it from outside. The two Shroolys start the same day so the comparison is fair." },
    { q: "Are the numbers real?", a: "Yes. Each entry comes from a chamber log or a kitchen scale. If we did not measure it, the entry leaves it blank." },
    { q: "Why compare a Shrooly and a Lykyn?", a: "Both are small home chambers. Growing the same species from the same blocks in each shows how much the chamber itself changes the result." },
  ],
};

export function validateEntry(e) {
  const keys = ENTRY_FIELDS.map(([k]) => k);
  for (const k of Object.keys(e)) if (!keys.includes(k)) throw new Error(`grow log entry has unknown field ${k}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) throw new Error("grow log entry needs a YYYY-MM-DD date");
  if (!CHAMBERS.some((c) => c.id === e.chamber)) throw new Error(`grow log entry has unknown chamber ${e.chamber}`);
  if (!e.note) throw new Error("grow log entry needs a note of what was seen");
  return true;
}

export function renderGrowLogBody(entries = ENTRIES) {
  entries.forEach(validateEntry);
  const cards = CHAMBERS.map(
    (c) => `<div class="card grow-log-chamber" id="${c.id}"><h3>${esc(c.name)}</h3><p><strong>Status:</strong> ${esc(c.status)}</p><p><strong>Hardware:</strong> ${esc(c.hardware)}</p><p><strong>Software:</strong> ${esc(c.software)}</p><p class="muted">${esc(c.note)}</p></div>`
  ).join("");
  const name = (id) => CHAMBERS.find((c) => c.id === id)?.name || id;
  const cell = (v) => (v === undefined || v === null || v === "" ? "" : esc(v));
  const log = entries.length
    ? `<div class="table-wrap"><table class="conditions-table"><caption>Grow log entries</caption><thead><tr>${ENTRY_FIELDS.map(([, l]) => `<th scope="col">${esc(l)}</th>`).join("")}</tr></thead><tbody>${entries
        .map((e) => `<tr>${ENTRY_FIELDS.map(([k]) => `<td>${k === "chamber" ? esc(name(e.chamber)) : cell(e[k])}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`
    : `<p><strong>No entries yet.</strong> The first one goes up the day the grows start.</p>`;
  return `<h2>The chambers</h2><div class="grow-log-chambers">${cards}</div>
<h2>Planned comparison: Shrooly vs Lykyn</h2>
<p>Species: ${link(COMPARISON.species)}. ${esc(COMPARISON.plan)} The Shroolys follow the free profile, and you can map the stage dates with the <a href="/tools/grow-timeline?species=${COMPARISON.species}">grow timeline calculator</a>. <a href="/coach">Grow Coach</a> watches the Shrooly readings.</p>
<h2>Log entries</h2>
${log}
<h2>What each entry records</h2>
<ul>${ENTRY_FIELDS.map(([, l]) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="muted">Readings come from the chamber's own log. Harvest weights come from a kitchen scale. Blank means not measured.</p>`;
}
