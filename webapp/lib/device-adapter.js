/**
 * Everything the Shrooly page needs to know about this chamber that another chamber does not.
 * The page never checks the device type: it asks this file. See lib/stage-standard.js.
 */

const { RECIPES, canonicalStage } = require("./stage-standard")

/** Canonical stage to the name the Shrooly grow_phase select uses. It has no Custom. */
const NATIVE_STAGE = { Colonization: "Colonizing", Pinning: "Pinning", Fruiting: "Fruiting" }

/** Canonical stages this chamber has, in the standard's order. */
const STAGES_AVAILABLE = ["Colonization", "Pinning", "Fruiting"]

/** The Shrooly firmware has no stage presets: the page writes the recipe. */
const PRESETS_ON_DEVICE = false

/** White is lux on this chamber. */
const WHITE_UNIT = "lux"

/** The fan never runs below 15 percent. */
const FAN_MIN_PERCENT = 15

/** White lux for a percent of full. Same curve as the cloud and the firmware: linear to 20 percent, then a power law. */
function whitePercentToLux(percent) {
  const pct = Math.min(100, Number(percent))
  if (!(pct > 0)) return 0
  const lux = pct <= 20 ? (pct / 20) * 92 : 0.02307 * pct ** 2.768
  return Math.min(4000, Math.round(lux))
}

function nativeStage(stage) {
  return NATIVE_STAGE[stage] || null
}

/** Writes that put this chamber in a stage and load that stage's recipe. */
function stageWrites(stage) {
  const native = nativeStage(stage)
  if (!native) return []
  const writes = [{ kind: "select", id: "grow_phase", value: native }, { kind: "number", id: "grow_day", value: 1 }]
  const r = RECIPES[stage]
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

/** White as the chamber counts it, for the Light card. */
function whiteDisplay(raw) {
  return Math.round(Number(raw) || 0)
}

module.exports = { STAGES_AVAILABLE, PRESETS_ON_DEVICE, WHITE_UNIT, FAN_MIN_PERCENT, whitePercentToLux, nativeStage, stageWrites, currentStage, whiteDisplay }
