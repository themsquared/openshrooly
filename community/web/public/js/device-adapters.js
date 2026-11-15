/**
 * One adapter per chamber type, for the site. Everything the page needs to know about how a
 * chamber differs from another lives here: its name for a stage, how it counts white, the lowest
 * fan speed it runs. The page asks the adapter and never checks the device type itself.
 * The API has the matching adapter (community/api/src/device-adapters.js) for what it sends.
 * See docs/device-ui-standard.md.
 */

import { whiteLuxToPercent, whitePercentToLux } from "./profile-schema.js";

/** The four stages every chamber shows, in this order. */
export const CANONICAL_STAGES = ["Colonization", "Pinning", "Fruiting", "Custom"];

export const DEFAULT_DEVICE_TYPE = "shrooly_chamber";

/** The profile stage id each canonical stage loads. Custom loads no recipe. */
const STAGE_IDS = { Colonization: "colonization", Pinning: "pinning", Fruiting: "fruiting" };

const ALIASES = {
  colonization: "Colonization",
  colonizing: "Colonization",
  browning: "Colonization",
  pinning: "Pinning",
  cold_shock: "Pinning",
  fruiting: "Fruiting",
  flush: "Fruiting",
  custom: "Custom",
};

const TYPES = {
  shrooly_chamber: {
    label: "Shrooly chamber",
    // Stages the chamber's own select has, by canonical name. Custom is not one of them.
    stages: { Colonization: "Colonizing", Pinning: "Pinning", Fruiting: "Fruiting" },
    whiteScale: "lux",
    fanMin: 15,
  },
  lykyn_chamber: {
    label: "Lykyn Chamber",
    stages: { Colonization: "Colonization", Pinning: "Pinning", Fruiting: "Fruiting", Custom: "Custom" },
    whiteScale: "percent",
    fanMin: 33,
  },
};

const PERCENT_WHITE_NOTE =
  "The ring mixes the colors below. White is added on top of red, green and blue, so blue 80 with white 20 is full blue. Raise white and lower blue to move toward white light.";

export function deviceTypeLabel(type) {
  const id = String(type || DEFAULT_DEVICE_TYPE);
  return TYPES[id]?.label || id.replaceAll("_", " ");
}

/** White brightness preview: a lux chamber's white channel is set in lux, the site shows %. */
export function luxPreview(percent) {
  const lux = whitePercentToLux(percent);
  return `About ${lux} lux${lux >= 4000 ? " (the most the chamber can do)" : ""}`;
}

/** Canonical stage for a phase name or profile stage id, or null. */
export function canonicalStage(name) {
  return name ? ALIASES[String(name).toLowerCase()] || null : null;
}

/** The profile stage id a canonical stage loads, or "" for Custom and unknown names. */
export function profileStageId(stage) {
  return STAGE_IDS[canonicalStage(stage)] || "";
}

/** The adapter for a device as the fleet API returns it. */
export function deviceAdapter(device = {}) {
  const id = device?.device_type || DEFAULT_DEVICE_TYPE;
  const type = TYPES[id] || TYPES[DEFAULT_DEVICE_TYPE];
  const reported = device?.capabilities?.knob_ranges || {};
  const whiteMax = Number(reported.white_intensity?.[1]);
  const percentWhite = Number.isFinite(whiteMax) ? whiteMax <= 100 : type.whiteScale === "percent";
  const fanMin = Number(reported.air_exchange_speed?.[0]);
  return {
    type: TYPES[id] ? id : DEFAULT_DEVICE_TYPE,
    label: type.label,
    /** Lowest fan speed this chamber runs, from what it reported, else the type's own. */
    fanMin: Number.isFinite(fanMin) ? fanMin : type.fanMin,
    /** The stage picker's options: always the four, with the ones this chamber lacks marked. */
    stages: CANONICAL_STAGES.map((name) => ({ name, available: Boolean(type.stages[name]) })),
    /** Canonical stage for what the chamber reports now (null for Idle, Harvest, or nothing). */
    currentStage: (phase) => canonicalStage(phase),
    white: {
      percent: percentWhite,
      label: percentWhite ? "White added to each color (%)" : "White brightness (%)",
      /** One plain line under the white box, or "" when there is nothing to say. */
      note: percentWhite ? PERCENT_WHITE_NOTE : "",
      /** Lux line for a percent, or "" when the chamber counts percent itself. */
      preview: (percent) => (percentWhite ? "" : luxPreview(percent)),
      /** A knob value in the chamber's own unit: "20%" or "92 lux". */
      describe: (raw) => `${raw}${percentWhite ? "%" : " lux"}`,
      /** Percent from a lux figure the cloud sent. */
      fromLux: (lux) => Math.round(whiteLuxToPercent(lux)),
    },
  };
}
