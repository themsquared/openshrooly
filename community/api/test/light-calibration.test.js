import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deviceAdapter } from "../src/device-adapters.js";
import { LIGHT_CALIBRATION, calibrationFor, lightLimits } from "../src/light-calibration.js";
import { deviceCapabilities, lightToKnobs, planForCapabilities, stageTargets } from "../src/device-capabilities.js";
import { recipeKnobs } from "../src/autopilot-knobs.js";

const ALL = [
  "setpoints.temperature",
  "setpoints.humidity",
  "setpoints.multi",
  "ack.refused",
  "setpoints.fan",
  "air.schedule",
  "light.schedule",
  "light.color",
  "grow.day",
  "grow.phase",
];
const shroolyCaps = deviceCapabilities({ firmware_version: "1.0.5-sl.1", capabilities: ALL, ranges: { white_intensity: [0, 4000, 5] } }, "shrooly_chamber");
const lykynCaps = deviceCapabilities({ firmware_version: "0.2.0", capabilities: ALL, ranges: { white_intensity: [0, 100, 0.1], air_exchange_speed: [0, 100, 1] } }, "lykyn_chamber");
const shrooly = deviceAdapter("shrooly_chamber");
const lykyn = deviceAdapter("lykyn_chamber");

test("the site and the API read one calibration file", () => {
  const api = readFileSync(new URL("../src/light-calibration.js", import.meta.url), "utf8");
  const web = readFileSync(new URL("../../web/public/js/light-calibration.js", import.meta.url), "utf8");
  assert.equal(web, api);
});

test("the Shrooly is measured and the Lykyn is flagged as an estimate", () => {
  assert.equal(LIGHT_CALIBRATION.shrooly_chamber.white_lux_at_100, 4000);
  assert.equal(LIGHT_CALIBRATION.shrooly_chamber.estimated, false);
  assert.equal(LIGHT_CALIBRATION.lykyn_chamber.estimated, true);
  assert.equal(calibrationFor("something_new"), LIGHT_CALIBRATION.shrooly_chamber, "unknown types use the default chamber");
});

test("the same lux target is a different percent on each chamber", () => {
  assert.equal(shrooly.white.percentFromRecipeLux(92), 2.3);
  assert.equal(lykyn.white.percentFromRecipeLux(92), 23);
  assert.equal(shrooly.white.fromLux(92), 92, "the Shrooly knob is lux");
  assert.equal(lykyn.white.fromLux(92), 23, "the Lykyn knob is percent");
  assert.equal(lykyn.white.toLux(23), 92);
  assert.equal(shrooly.white.toLux(92), 92);
});

test("lux to percent to lux round-trips on both chambers", () => {
  for (let lux = 0; lux <= 4000; lux += 5) {
    assert.equal(shrooly.white.toLux(shrooly.white.fromLux(lux)), lux, `${lux} lux on the Shrooly`);
  }
  for (let lux = 0; lux <= 400; lux += 0.4) {
    const pct = lykyn.white.fromLux(lux);
    assert.ok(Math.abs(lykyn.white.toLux(pct) - lux) < 0.01, `${lux} lux on the Lykyn`);
  }
  for (let tenth = 0; tenth <= 1000; tenth++) {
    const pct = tenth / 10;
    assert.equal(lykyn.white.toPercent(lykyn.white.fromPercent(pct)), pct);
    assert.equal(shrooly.white.toPercent(shrooly.white.fromPercent(pct)), pct);
  }
});

test("a white target above what the chamber makes goes out at 100 and says so", () => {
  assert.equal(lykyn.white.fromLux(600), 100);
  assert.equal(shrooly.white.fromLux(600), 600);
  const light = { white_led_lux: 600, blue_percent: 80 };
  const limits = lykyn.light.limits(light);
  assert.equal(limits.length, 1);
  assert.equal(limits[0].note, "Wanted 600 lux of white, this chamber tops out at about 400 lux (estimated).");
  assert.deepEqual(shrooly.light.limits(light), [], "600 lux is within the Shrooly's 4000");
  assert.equal(shrooly.light.limits({ white_led_lux: 4000 }).length, 0);
  assert.deepEqual(lightLimits({ white_led_lux: 400 }, calibrationFor("lykyn_chamber")), [], "exactly the maximum is not a cap");
});

test("a blue target converts on the Lykyn and falls back to blue percent on the Shrooly", () => {
  assert.equal(lykyn.light.bluePercent({ blue_umol_m2s: 3.5 }), 100);
  assert.equal(lykyn.light.bluePercent({ blue_umol_m2s: 1.75 }), 50);
  assert.equal(lykyn.light.bluePercent({ blue_umol_m2s: 50 }), 100);
  assert.equal(lykyn.light.bluePercent({ blue_percent: 80 }), null);
  assert.equal(shrooly.light.bluePercent({ blue_umol_m2s: 50 }), null, "no Shrooly blue figure yet");
  const blueLimit = lykyn.light.limits({ blue_umol_m2s: 50 });
  assert.equal(blueLimit[0].note, "Wanted 50 umol/m2/s of blue, this chamber tops out at about 3.5 umol/m2/s (estimated).");
  assert.deepEqual(shrooly.light.limits({ blue_umol_m2s: 50 }), []);
  const stageLight = { sunrise_hour: 8, duration_hours: 12, white_led_lux: 92, red_percent: 0, green_percent: 0, blue_percent: 80 };
  assert.equal(lightToKnobs(stageLight, lykynCaps).color_b, 80);
  assert.equal(lightToKnobs({ ...stageLight, blue_umol_m2s: 1.75 }, lykynCaps).color_b, 50);
  assert.equal(lightToKnobs({ ...stageLight, blue_umol_m2s: 1.75 }, shroolyCaps).color_b, 80, "Shrooly keeps its blue percent");
});

const STAGE = {
  id: "fruiting",
  name: "Fruiting",
  temperature_c: 18,
  humidity_percent: 88,
  fan: { speed_percent: 50, period_min: 10, run_duration_s: 40 },
  light: { sunrise_hour: 8, duration_hours: 12, white_led_lux: 600, red_percent: 0, green_percent: 0, blue_percent: 80 },
};

test("a profile stage gives the same physical light on both chambers, in each chamber's own percent", () => {
  const stage = { ...STAGE, light: { ...STAGE.light, white_led_lux: 92 } };
  const s = stageTargets(stage, { stageId: "fruiting", caps: shroolyCaps });
  const l = stageTargets(stage, { stageId: "fruiting", caps: lykynCaps });
  assert.equal(s.white_intensity, 92);
  assert.equal(l.white_intensity, 23);
  assert.equal(shrooly.white.toLux(s.white_intensity), lykyn.white.toLux(l.white_intensity));
  assert.equal(recipeKnobs(stage, "fruiting", lykynCaps).white_intensity, 23, "Coach steers to the same target");
  assert.equal(recipeKnobs(stage, "fruiting", shroolyCaps).white_intensity, 92);
});

test("applying a stage the chamber cannot light fully sends 100 and tells the grower", () => {
  const plan = { kind: "apply_profile", payload: { profile_id: "x", stage: "fruiting" } };
  const lykynPlan = planForCapabilities(plan, lykynCaps, { stage: STAGE });
  assert.equal(lykynPlan.ok, true);
  assert.equal(lykynPlan.commands[0].payload.white_intensity, 100);
  assert.ok(lykynPlan.skipped.some((n) => /Wanted 600 lux of white, this chamber tops out at about 400 lux \(estimated\)/.test(n.note)));
  const shroolyPlan = planForCapabilities(plan, shroolyCaps, { stage: STAGE });
  assert.equal(shroolyPlan.commands[0].payload.white_intensity, 600);
  assert.equal(shroolyPlan.skipped.filter((n) => /Wanted/.test(n.note)).length, 0);
  const picked = planForCapabilities({ kind: "stage", payload: { grow_phase: "Fruiting", profile_id: "x" } }, lykynCaps, { stage: STAGE });
  assert.ok(picked.skipped.some((n) => /Wanted 600 lux/.test(n.note)), "the stage picker says it too");
});

test("Coach and the stage code never branch on the device type", () => {
  for (const file of ["coach-autopilot.js", "autopilot-knobs.js", "device-capabilities.js"]) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /===\s*["'](lykyn|shrooly)_chamber["']/, `${file} compares a device type`);
  }
});

test("a profile may carry a blue target, kept as written and range checked", async () => {
  const { validateProfile } = await import("../src/profile-schema.js");
  const pearl = JSON.parse(readFileSync(new URL("../../../data/profiles/culinary/pearl-oyster.json", import.meta.url), "utf8"));
  assert.equal("blue_umol_m2s" in pearl.stages[1].light, false, "no shipped profile sets one yet");
  const withBlue = structuredClone(pearl);
  withBlue.stages[1].light.blue_umol_m2s = 3.5;
  assert.equal(validateProfile(withBlue).stages[1].light.blue_umol_m2s, 3.5);
  withBlue.stages[1].light.blue_umol_m2s = 500;
  assert.throws(() => validateProfile(withBlue), /blue target/);
});
