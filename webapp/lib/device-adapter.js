/**
 * Everything the Shrooly page needs to know about this chamber that another chamber does not.
 * The page never checks the device type: it asks this file. See lib/stage-standard.js.
 */

const { RECIPES, canonicalStage, recipeFromProfile } = require("./stage-standard")

/** Canonical stage to the name the Shrooly grow_phase select uses. It has no Custom. */
const NATIVE_STAGE = { Colonization: "Colonizing", Pinning: "Pinning", Fruiting: "Fruiting" }

/** Canonical stages this chamber has, in the standard's order. */
const STAGES_AVAILABLE = ["Colonization", "Pinning", "Fruiting"]

/** The Shrooly firmware has no stage presets: the page writes the recipe. */
const PRESETS_ON_DEVICE = false

/** The page shows white as percent of the chamber's maximum. The chamber itself stores lux. */
const WHITE_UNIT = "%"

/** The white entity tops out at 4000 lux, which is 100 percent. Same rule as the cloud adapter. */
const WHITE_MAX_LUX = 4000

/** The fan never runs below 15 percent. */
const FAN_MIN_PERCENT = 15

/** White lux for a percent of the maximum: linear, 40 lux per percent, 100 percent is 4000 lux. */
function whitePercentToLux(percent) {
  const pct = Math.min(100, Number(percent))
  if (!(pct > 0)) return 0
  return Math.min(WHITE_MAX_LUX, Math.round(pct * (WHITE_MAX_LUX / 100)))
}

/** White as a percent of the maximum for a lux figure, to three decimals (exact for any whole lux). */
function whiteLuxToPercent(lux) {
  const value = Math.min(WHITE_MAX_LUX, Number(lux))
  if (!(value > 0)) return 0
  return Math.round((value / (WHITE_MAX_LUX / 100)) * 1000) / 1000
}

function nativeStage(stage) {
  return NATIVE_STAGE[stage] || null
}

/** Writes that put this chamber in a stage and load that stage's recipe. */
function stageWrites(stage, profileStages) {
  const native = nativeStage(stage)
  if (!native) return []
  const writes = [{ kind: "select", id: "grow_phase", value: native }]
  const r = recipeFromProfile(stage, profileStages) || RECIPES[stage]
  if (!r) return writes
  const fan = Math.max(r.fanSpeed, FAN_MIN_PERCENT)
  writes.push(
    { kind: "number", id: "temperature__target", value: r.temperature },
    { kind: "number", id: "target_humidity", value: r.humidity },
    { kind: "number", id: "lights__sunrise_hour", value: r.sunrise },
    { kind: "number", id: "lights__duration__hours_", value: r.lightHours },
    { kind: "number", id: "white_led_intensity", value: whitePercentToLux(r.white) },
    { kind: "number", id: "red_led_intensity", value: r.red },
    { kind: "number", id: "green_led_intensity", value: r.green },
    { kind: "number", id: "blue_led_intensity", value: r.blue },
    { kind: "number", id: "air_exchange__speed", value: fan },
    { kind: "number", id: "air_exchange__period__min_", value: r.airPeriodMin },
    { kind: "number", id: "air_exchange__run_duration__s_", value: r.airRunSec }
  )
  return writes
}

/** Canonical stage for what the chamber's grow_phase select says now. */
function currentStage(nativeName) {
  return canonicalStage(nativeName)
}

/** White for the Light card and modal: percent of the maximum, one decimal. */
function whiteDisplay(raw) {
  return Math.round(whiteLuxToPercent(Number(raw) || 0) * 10) / 10
}

module.exports = { STAGES_AVAILABLE, PRESETS_ON_DEVICE, WHITE_UNIT, FAN_MIN_PERCENT, whitePercentToLux, whiteLuxToPercent, nativeStage, stageWrites, currentStage, whiteDisplay }
