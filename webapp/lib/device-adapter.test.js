const test = require("node:test")
const assert = require("node:assert/strict")
const adapter = require("./device-adapter")
const { RECIPES } = require("./stage-standard")

test("Shrooly says Colonizing, has no Custom, and writes the recipe from the page", () => {
  assert.deepEqual(adapter.STAGES_AVAILABLE, ["Colonization", "Pinning", "Fruiting"])
  assert.equal(adapter.nativeStage("Colonization"), "Colonizing")
  assert.equal(adapter.nativeStage("Custom"), null)
  assert.equal(adapter.PRESETS_ON_DEVICE, false)
  const writes = adapter.stageWrites("Fruiting")
  const by = Object.fromEntries(writes.map((w) => [w.id, w.value]))
  assert.equal(by.grow_phase, "Fruiting")
  assert.equal(by.temperature__target, RECIPES.Fruiting.temperature)
  assert.equal(by.target_humidity, RECIPES.Fruiting.humidity)
  assert.equal(by.lights__duration__hours_, 12)
  assert.equal(by.white_led_intensity, 92, "20 percent of full is 92 lux")
  assert.equal(by.blue_led_intensity, 80)
  assert.equal(by.air_exchange__speed, 50)
  assert.equal(by.air_exchange__period__min_, 10)
  assert.equal(by.air_exchange__run_duration__s_, 40)
  assert.equal(writes[0].id, "grow_phase")
  assert.deepEqual(adapter.stageWrites("Custom"), [])
})

test("Colonization keeps the light off and the fan at or above this chamber's floor", () => {
  const by = Object.fromEntries(adapter.stageWrites("Colonization").map((w) => [w.id, w.value]))
  assert.equal(by.grow_phase, "Colonizing")
  assert.equal(by.lights__duration__hours_, 0)
  assert.equal(by.white_led_intensity, 0)
  assert.ok(by.air_exchange__speed >= adapter.FAN_MIN_PERCENT)
  assert.equal("grow_day" in by, false, "changing stage must not reset the start date")
})

test("a linked profile's stage knobs beat the built-in recipe", () => {
  const by = Object.fromEntries(
    adapter.stageWrites("Colonization", {
      colonization: { temperature_c: 21, humidity_percent: 93, fan_speed_percent: 25, air_exchange_period_min: 45, air_exchange_run_sec: 20, light_hours: 0, white_percent: 0, red_percent: 0, green_percent: 0, blue_percent: 0 },
    }).map((w) => [w.id, w.value])
  )
  assert.equal(by.grow_phase, "Colonizing")
  assert.equal(by.temperature__target, 21)
  assert.equal(by.target_humidity, 93)
  assert.equal(by.air_exchange__speed, 25)
  assert.equal(by.air_exchange__period__min_, 45)
  assert.equal("grow_day" in by, false)
})

test("white percent to lux matches the cloud and firmware curve", () => {
  assert.equal(adapter.whitePercentToLux(0), 0)
  assert.equal(adapter.whitePercentToLux(20), 92)
  assert.equal(adapter.whitePercentToLux(10), 46)
  assert.equal(adapter.whitePercentToLux(100), 4000)
  assert.equal(adapter.WHITE_UNIT, "lux")
})

test("the current stage is read back through the canonical name", () => {
  assert.equal(adapter.currentStage("Colonizing"), "Colonization")
  assert.equal(adapter.currentStage("Idle"), null)
})
