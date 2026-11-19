/**
 * Water fields a chamber may report in telemetry. All optional, so older firmware keeps working.
 *   water_level   number, percent of the tank (0 to 110). Only chambers with a tank sensor send it.
 *   water_state   ok | low | empty | unknown | suspect
 *   water_source  sensor | inferred. "inferred" means the chamber has no tank sensor and watched
 *                 humidity fail to rise while the mister ran, so it cannot tell empty from blocked.
 *   water_low     true when the chamber thinks the water needs attention (low, empty or suspect).
 */

export const WATER_STATES = new Set(["ok", "low", "empty", "unknown", "suspect"]);

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flag(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

/** Normalize the water fields of one telemetry document. Never throws. */
export function readWater(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  const level = num(d.water_level ?? d.water ?? d.water_level_percent);
  const rawState = typeof d.water_state === "string" ? d.water_state.trim().toLowerCase() : "";
  const state = WATER_STATES.has(rawState) ? rawState : null;
  const rawSource = typeof d.water_source === "string" ? d.water_source.trim().toLowerCase() : "";
  const source = rawSource === "inferred" ? "inferred" : rawSource === "sensor" ? "sensor" : null;
  return { level, state, source, low: flag(d.water_low) };
}

/**
 * Severity of one reading against the device's thresholds: ok, low, empty, or unknown.
 * A number wins over the chamber's own state, so the owner's "low means below" setting applies.
 * A chamber with no tank sensor can only say suspect, which is as urgent as empty.
 */
export function waterSeverity(water, { below, empty }) {
  if (water.level != null) {
    const emptyAt = Math.min(empty, below);
    if (water.level < emptyAt) return "empty";
    if (water.level < below) return "low";
    return "ok";
  }
  if (water.state === "empty" || water.state === "suspect") return "empty";
  if (water.state === "low") return "low";
  if (water.state === "ok") return "ok";
  if (water.state === "unknown") return "unknown";
  if (water.low === true) return "low";
  if (water.low === false) return "ok";
  return "unknown";
}

export function hasWater(water) {
  return water.level != null || water.state != null || water.low != null;
}
