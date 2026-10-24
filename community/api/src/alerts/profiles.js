/** Grow tracking uses the bundled free culinary profiles only, so no lookup can leak paid content. */

import seeds from "../seeds.json" with { type: "json" };
import { isFree, isPsilocybin } from "../profile.js";

const TRACKABLE = new Map(
  seeds.filter((p) => p.pack === "culinary" && isFree(p) && !isPsilocybin(p)).map((p) => [p.id, p])
);

export function trackableProfile(id) {
  return id ? TRACKABLE.get(String(id)) || null : null;
}

export function trackableList() {
  return [...TRACKABLE.values()]
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
