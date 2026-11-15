const test = require("node:test")
const assert = require("node:assert/strict")
const { STAGES, CARDS, RECIPES, canonicalStage, missingStageNote } = require("./stage-standard")
const adapter = require("./device-adapter")

test("the standard is four stages and four cards, in one order", () => {
  assert.deepEqual(STAGES, ["Colonization", "Pinning", "Fruiting", "Custom"])
  assert.deepEqual(CARDS.map((c) => c.label), ["Temp", "Humidity", "Light", "Fresh air"])
  assert.deepEqual(Object.keys(RECIPES), ["Colonization", "Pinning", "Fruiting"])
})

test("each chamber's own stage name maps to the canonical one", () => {
  assert.equal(canonicalStage("Colonizing"), "Colonization")
  assert.equal(canonicalStage("Colonization"), "Colonization")
  assert.equal(canonicalStage("fruiting"), "Fruiting")
  assert.equal(canonicalStage("Idle"), null)
  assert.equal(canonicalStage(undefined), null)
})

test("a chamber that lacks a stage gets one note line, a full one gets none", () => {
  assert.equal(missingStageNote(STAGES), "")
  assert.equal(missingStageNote(["Colonization", "Pinning", "Fruiting"]), "This chamber has no Custom stage.")
  assert.doesNotMatch(missingStageNote(["Pinning"]), /[\u2013\u2014]/)
})

test("this chamber's adapter answers every stage in the standard", () => {
  for (const stage of adapter.STAGES_AVAILABLE) assert.ok(STAGES.includes(stage), stage)
  for (const stage of STAGES) {
    const available = adapter.STAGES_AVAILABLE.includes(stage)
    assert.equal(typeof adapter.nativeStage(stage) === "string", available, stage)
    const writes = adapter.stageWrites(stage)
    assert.equal(Array.isArray(writes), true)
    if (available) assert.equal(writes[0].kind, "select", `${stage} writes the stage select first`)
    else assert.deepEqual(writes, [], `${stage} writes nothing`)
  }
})
