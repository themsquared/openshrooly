/**
 * Profile numbers for guide copy. Guides quote these instead of typing numbers by hand,
 * so a profile change shows up in every guide on the next build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../data/profiles/culinary");

const PROFILES = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")))
    .filter((p) => p.pricing?.kind !== "paid")
    .map((p) => [p.id, p])
);

export function profile(id) {
  const p = PROFILES[id];
  if (!p) throw new Error(`guide cites unknown profile ${id}`);
  return p;
}

const f = (c) => Math.round((Number(c) * 9) / 5 + 32);
export const temp = (c) => `${c} °C (${f(c)} °F)`;

export function stage(id, stageId) {
  const stages = profile(id).stages;
  return stages.find((s) => s.id === stageId) || stages[stages.length - 1];
}

/** Total days from the start of colonization to the end of the first harvest window. */
export function days(id) {
  return profile(id).stages.reduce((sum, s) => sum + Number(s.duration_days || 0), 0);
}

export function fruit(id) {
  return stage(id, "fruiting");
}

/** Link to a profile guide page with its display name. */
export function link(id, label) {
  return `<a href="/profiles/${id}">${label || profile(id).name}</a>`;
}

export function hasTag(id, tag) {
  return (profile(id).tags || []).includes(tag);
}

export const FREE_IDS = Object.keys(PROFILES).sort();

/** Fan schedule for one stage in plain words, like the profile pages. */
export function air(id, stageId) {
  const fan = stage(id, stageId).fan || {};
  return `a fan run of ${fan.run_duration_s} s every ${fan.period_min} min`;
}

/** Lowest and highest value of one stage field across the free culinary profiles. */
export function range(stageId, field) {
  const values = FREE_IDS.map((id) => profile(id).stages.find((s) => s.id === stageId)).filter(Boolean).map((s) => Number(s[field]));
  return [Math.min(...values), Math.max(...values)];
}
