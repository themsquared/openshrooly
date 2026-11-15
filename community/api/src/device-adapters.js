/**
 * One adapter per chamber type. Everything that differs between chambers lives here:
 * phase names, how white is stored (lux or percent), which phases the select takes, labels,
 * and the limits a type is known to have. Coach, the fleet code and the site ask the adapter
 * and never look at the device type themselves. See docs/device-ui-standard.md.
 *
 * A firmware that reports its own ranges wins over the type's defaults: the adapter only
 * fills in what the chamber has not said.
 */

import { whiteLuxToPercent, whitePercentToLux } from "./profile-schema.js";

/** The four stages every chamber shares, in the order the pages show them. */
export const CANONICAL_STAGES = ["Colonization", "Pinning", "Fruiting", "Custom"];

export const DEFAULT_DEVICE_TYPE = "shrooly_chamber";

/** What every Shroom Labs cloud firmware so far can run. */
const BASELINE_CAPABILITIES = ["setpoints.temperature", "setpoints.humidity"];

/** Profile stage ids and phase names to a canonical stage. Custom is never a profile stage. */
const STAGE_ALIASES = {
  colonization: "Colonization",
  colonizing: "Colonization",
  browning: "Colonization",
  pinning: "Pinning",
  cold_shock: "Pinning",
  fruiting: "Fruiting",
  flush: "Fruiting",
  custom: "Custom",
};

/** Profile stage id for a canonical stage ("" for Custom and the phases that are not stages). */
const STAGE_ID = { Colonization: "colonization", Pinning: "pinning", Fruiting: "fruiting" };

/** Phases a Shrooly shows that are not one of the four stages. They map to no profile stage. */
const EXTRA_PHASES = { idle: "Idle", harvest: "Harvest", rest: "Harvest" };

const TYPES = {
  shrooly_chamber: {
    label: "Shrooly chamber",
    baseline: BASELINE_CAPABILITIES,
    ranges: { temperature_c: [10, 32], humidity_percent: [60, 98] },
    // The Shrooly select: its own name for colonization, two extra phases, no Custom.
    phases: ["Idle", "Colonizing", "Pinning", "Fruiting", "Harvest"],
    nativeName: { Colonization: "Colonizing" },
    whiteScale: "lux",
    knobRanges: {},
  },
  lykyn_chamber: {
    label: "Lykyn Chamber",
    baseline: BASELINE_CAPABILITIES,
    ranges: { temperature_c: [10, 32], humidity_percent: [30, 95] },
    phases: ["Fruiting", "Pinning", "Colonization", "Custom"],
    nativeName: {},
    whiteScale: "percent",
    // Used until the chamber reports its own ranges: the fan never runs below 33%, and white is 0-100%.
    knobRanges: { air_exchange_speed: [33, 100, 1], white_intensity: [0, 100, 1] },
  },
};

/** Known type token, or null when it is missing or unknown. */
export function normalizeDeviceType(value) {
  const id = String(value || "").trim().toLowerCase();
  return id && Object.prototype.hasOwnProperty.call(TYPES, id) ? id : null;
}

/** Type definitions by id, for code that needs the baseline capabilities and limits. */
export const DEVICE_TYPES = TYPES;

export function deviceTypeLabel(type) {
  const id = String(type || DEFAULT_DEVICE_TYPE);
  return TYPES[id]?.label || id.replaceAll("_", " ");
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Canonical stage for a profile stage id or any phase name ("Colonizing", "Colonization",
 * "fruiting", "Idle"...). Null when it is not one of the four stages.
 */
export function canonicalStage(name) {
  if (!name) return null;
  const raw = String(name);
  return STAGE_ALIASES[raw.toLowerCase()] || null;
}

/**
 * A phase name the site accepts for a stage change, in a form every chamber's plan can read:
 * the canonical stage ("Colonization"), or Idle or Harvest. Null when it is none of those.
 * Whether a given chamber has that phase is decided later, by its own adapter.
 */
export function acceptedPhase(name) {
  if (!name) return null;
  return canonicalStage(name) || EXTRA_PHASES[String(name).toLowerCase()] || null;
}

/** Profile stage id for a phase name ("" for Custom, Idle, Harvest and unknown names). */
export function stageIdForPhase(name) {
  return STAGE_ID[canonicalStage(name)] || "";
}

/** True when two phase strings are the same stage ("Colonizing" and "Colonization" are one). */
export function samePhase(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = canonicalStage(a);
  return Boolean(sa && sa === canonicalStage(b));
}

/**
 * The adapter for a chamber. Pass a device type string or the capabilities object
 * (which carries `device_type` and the knob ranges the chamber reported).
 */
export function deviceAdapter(source = {}) {
  const caps = typeof source === "string" ? { device_type: source } : source || {};
  const id = caps.device_type || DEFAULT_DEVICE_TYPE;
  const type = TYPES[id] || TYPES[DEFAULT_DEVICE_TYPE];
  const reportedMax = num(caps.knob_ranges?.white_intensity?.[1]);
  const scale = reportedMax != null ? (reportedMax <= 100 ? "percent" : "lux") : type.whiteScale;
  const percent = scale === "percent";

  /** The phase string this chamber takes for a canonical stage, an alias or a native name. */
  function nativePhase(name) {
    if (!name) return null;
    const raw = String(name);
    const stage = canonicalStage(raw);
    if (stage === "Custom") return type.phases.includes("Custom") ? "Custom" : null;
    if (stage) return type.nativeName[stage] || stage;
    const extra = EXTRA_PHASES[raw.toLowerCase()];
    return extra && type.phases.includes(extra) ? extra : null;
  }

  return {
    type: TYPES[id] ? id : DEFAULT_DEVICE_TYPE,
    label: type.label,
    /** Knob ranges this type has before the chamber reports its own: { key: [min, max, step] }. */
    knobRanges: type.knobRanges,
    /** The select values this chamber accepts, in the order its page lists them. */
    phaseOptions: type.phases.slice(),
    nativePhase,
    /** Canonical stage for any phase name, or null. */
    stage: canonicalStage,
    white: {
      scale,
      unit: percent ? "%" : " lux",
      /** Knob value for a percent from the site or a profile. */
      fromPercent: (p) => (percent ? p : whitePercentToLux(p)),
      /** Knob value for a lux figure from a profile. */
      fromLux: (lux) => (percent ? whiteLuxToPercent(lux) : lux),
      /** Percent for a recipe's lux figure. Recipes are written in lux whatever the chamber. */
      percentFromRecipeLux: (lux) => Math.round(whiteLuxToPercent(lux)),
      /** Percent for a knob value the chamber reported. */
      toPercent: (raw) => (percent ? raw : whiteLuxToPercent(raw)),
      /** Lux for a knob value the chamber reported. */
      toLux: (raw) => (percent ? whitePercentToLux(raw) : raw),
      /** Plain words for a knob value. Always percent: a lux chamber's figure is converted here and nowhere else. */
      describe: (raw) => `white ${Math.round(percent ? raw : whiteLuxToPercent(raw))}%`,
    },
  };
}
