/**
 * The device UI standard, as code: one stage picker, four cards, and the stock recipe for each
 * stage in canonical units. This file is identical in every Shroom Labs device page (Shrooly,
 * Lykyn, and any later chamber). Everything that differs between chambers lives in that
 * chamber's own device-adapter.js. See docs/device-ui-standard.md.
 *
 * Canonical units: degrees C, percent RH, light as hours and percent of the chamber's maximum output, fresh air as fan
 * percent, minutes between runs and seconds per run.
 */

/** The stages every chamber shows, in this order. */
const STAGES = ["Colonization", "Pinning", "Fruiting", "Custom"]

/** The four cards under the stage picker, in this order. */
const CARDS = [
  { id: "temperature", label: "Temp" },
  { id: "humidity", label: "Humidity" },
  { id: "light", label: "Light" },
  { id: "air", label: "Fresh air" },
]

/**
 * Stock recipes (the Black Oyster band the Lykyn firmware ships). A chamber whose firmware has
 * no stage presets of its own writes these from the page. Custom has none: it keeps what is set.
 */
const RECIPES = {
  Colonization: { temperature: 24, humidity: 90, sunrise: 8, lightHours: 0, white: 0, red: 0, green: 0, blue: 0, fanSpeed: 20, airPeriodMin: 60, airRunSec: 15 },
  Pinning: { temperature: 17, humidity: 92, sunrise: 8, lightHours: 12, white: 2.3, red: 0, green: 0, blue: 80, fanSpeed: 40, airPeriodMin: 12, airRunSec: 35 },
  Fruiting: { temperature: 18, humidity: 88.5, sunrise: 8, lightHours: 12, white: 2.3, red: 0, green: 0, blue: 80, fanSpeed: 50, airPeriodMin: 10, airRunSec: 40 },
}

const ALIASES = {
  colonization: "Colonization",
  colonizing: "Colonization",
  pinning: "Pinning",
  fruiting: "Fruiting",
  custom: "Custom",
}

/** Canonical stage for any chamber's own phase name ("Colonizing" is Colonization), else null. */
function canonicalStage(name) {
  return ALIASES[String(name || "").trim().toLowerCase()] || null
}

/** The stages a chamber lacks, from the ones it has. */
function missingStages(available) {
  return STAGES.filter((stage) => !available.includes(stage))
}

/** One note line for a picker that lacks stages, or "" when it has all four. */
function missingStageNote(available) {
  const missing = missingStages(available)
  if (!missing.length) return ""
  return `This chamber has no ${missing.join(" or ")} stage.`
}


const STAGE_IDS = { Colonization: "colonization", Pinning: "pinning", Fruiting: "fruiting" }

/** Profile stage from the inbox, in the same shape as RECIPES, or null. */
function recipeFromProfile(stage, profileStages) {
  const raw = profileStages && profileStages[STAGE_IDS[stage] || ""]
  if (!raw || raw.temperature_c == null && raw.humidity_percent == null) return null
  return {
    temperature: raw.temperature_c,
    humidity: raw.humidity_percent,
    sunrise: raw.sunrise_hour ?? 8,
    lightHours: raw.light_hours ?? 0,
    white: raw.white_percent ?? 0,
    red: raw.red_percent ?? 0,
    green: raw.green_percent ?? 0,
    blue: raw.blue_percent ?? 0,
    fanSpeed: raw.fan_speed_percent ?? 0,
    airPeriodMin: raw.air_exchange_period_min ?? 60,
    airRunSec: raw.air_exchange_run_sec ?? 15,
  }
}

module.exports = { STAGES, CARDS, RECIPES, canonicalStage, missingStages, missingStageNote, recipeFromProfile }
