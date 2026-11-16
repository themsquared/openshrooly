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
  assert.equal(by.white_led_intensity, 92, "2.3 percent of the maximum is 92 lux, the light the old 20 percent made")
  assert.equal(by.blue_led_intensity, 80)
  assert.equal(by.air_exchange__speed, 50)
  assert.equal(by.air_exchange__period__min_, 10)
  assert.equal(by.air_exchange__run_duration__s_, 40)
  assert.equal(writes[0].id, "grow_phase")
  assert.deepEqual(adapter.stageWrites("Custom"), [])
})

test("Colonization keeps the light off and sends the profile fan", () => {
  const by = Object.fromEntries(adapter.stageWrites("Colonization").map((w) => [w.id, w.value]))
  assert.equal(by.grow_phase, "Colonizing")
  assert.equal(by.lights__duration__hours_, 0)
  assert.equal(by.white_led_intensity, 0)
  assert.equal(by.air_exchange__speed, 20)
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

test("white percent is linear: 100 percent is 4000 lux and every whole lux round-trips", () => {
  assert.equal(adapter.whitePercentToLux(0), 0)
  assert.equal(adapter.whitePercentToLux(2.3), 92)
  assert.equal(adapter.whitePercentToLux(10), 400)
  assert.equal(adapter.whitePercentToLux(50), 2000)
  assert.equal(adapter.whitePercentToLux(100), 4000)
  assert.equal(adapter.whitePercentToLux(150), 4000)
  assert.equal(adapter.WHITE_UNIT, "%")
  for (let lux = 0; lux <= 4000; lux += 1) {
    assert.equal(adapter.whitePercentToLux(adapter.whiteLuxToPercent(lux)), lux)
  }
})

test("the Light card shows percent of the maximum with one decimal", () => {
  assert.equal(adapter.whiteDisplay(92), 2.3)
  assert.equal(adapter.whiteDisplay(150), 3.8)
  assert.equal(adapter.whiteDisplay(4000), 100)
  assert.equal(adapter.whiteDisplay(0), 0)
})

test("the current stage is read back through the canonical name", () => {
  assert.equal(adapter.currentStage("Colonizing"), "Colonization")
  assert.equal(adapter.currentStage("Idle"), null)
})
