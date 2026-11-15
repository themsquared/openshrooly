import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIGHT_SCALE,
  legacyWhitePercentToLux,
  normalizeStoredProfileLight,
  upgradeRecipeLightScale,
  validateProfile,
  whiteLuxToPercent,
  whitePercentToLux,
} from "../src/profile-schema.js";
import { deviceAdapter } from "../src/device-adapters.js";

const seeds = JSON.parse(readFileSync(new URL("../src/seeds.json", import.meta.url), "utf8"));
const before = JSON.parse(readFileSync(new URL("../../../tests/fixtures/light-scale-before.json", import.meta.url), "utf8")).profiles;

test("white percent is linear to 4000 lux at 100%, with no cap below it", () => {
  const table = [[0, 0], [1, 40], [2.3, 92], [10, 400], [50, 2000], [78, 3120], [79, 3160], [100, 4000], [150, 4000], [-3, 0]];
  for (const [pct, lux] of table) assert.equal(whitePercentToLux(pct), lux, `${pct}%`);
});

test("round trip is exact over 0 to 100 percent and every whole lux", () => {
  for (let tenth = 0; tenth <= 1000; tenth += 1) {
    const pct = tenth / 10;
    assert.equal(whiteLuxToPercent(whitePercentToLux(pct)), pct, `${pct}%`);
  }
  for (let lux = 0; lux <= 4000; lux += 1) assert.equal(whitePercentToLux(whiteLuxToPercent(lux)), lux, `${lux} lux`);
  const shrooly = deviceAdapter("shrooly_chamber").white;
  const lykyn = deviceAdapter("lykyn_chamber").white;
  for (let pct = 0; pct <= 100; pct += 0.5) {
    assert.equal(shrooly.toPercent(shrooly.fromPercent(pct)), pct);
    assert.equal(lykyn.toPercent(lykyn.fromPercent(pct)), pct);
  }
});

test("the old curve is kept for the upgrade and matches what shipped", () => {
  const table = { 0: 0, 10: 46, 20: 92, 26: 190, 37: 506, 51: 1229, 78: 3984, 79: 4000, 100: 4000 };
  for (const [pct, lux] of Object.entries(table)) assert.equal(legacyWhitePercentToLux(Number(pct)), lux, `${pct}%`);
});

test("every seed profile makes the same light as before the scale change", () => {
  const byId = new Map(seeds.map((p) => [p.id, p]));
  assert.deepEqual([...byId.keys()].sort(), Object.keys(before).sort());
  let checked = 0;
  for (const [id, old] of Object.entries(before)) {
    const profile = byId.get(id);
    assert.equal(profile.light_recipe.white_scale, LIGHT_SCALE, id);
    for (const [name, was] of Object.entries(old.phases)) {
      const now = profile.light_recipe.phases[name];
      assert.equal(whitePercentToLux(now.white_brightness_percent), legacyWhitePercentToLux(was.old_percent), `${id} ${name}`);
      if (was.lux != null) {
        const stage = profile.stages.find((s) => s.id === name);
        assert.equal(stage.light.white_led_lux, was.lux, `${id} ${name} stage lux is untouched`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 100);
});

test("a Shrooly and a Lykyn are sent the same share of their own maximum", () => {
  const shrooly = deviceAdapter("shrooly_chamber").white;
  const lykyn = deviceAdapter("lykyn_chamber").white;
  const pearl = seeds.find((p) => p.id === "pearl-oyster");
  const lux = pearl.stages.find((s) => s.id === "fruiting").light.white_led_lux;
  assert.equal(lux, 92);
  const pct = shrooly.percentFromRecipeLux(lux);
  assert.equal(pct, 2.3);
  assert.equal(shrooly.fromPercent(pct), 92);
  assert.equal(lykyn.fromPercent(pct), 2.3);
});

test("an unmarked recipe is upgraded once on read and on save, and keeps its lux", () => {
  const legacy = structuredClone(seeds.find((p) => p.id === "lions-mane"));
  delete legacy.light_recipe.white_scale;
  legacy.light_recipe.phases.fruiting.white_brightness_percent = 26;
  legacy.light_recipe.phases.pinning.white_brightness_percent = 26;
  const read = normalizeStoredProfileLight(legacy);
  assert.equal(read.light_recipe.white_scale, LIGHT_SCALE);
  assert.equal(read.light_recipe.phases.fruiting.white_brightness_percent, 4.75);
  assert.equal(legacy.light_recipe.phases.fruiting.white_brightness_percent, 26, "input is not mutated");
  assert.deepEqual(normalizeStoredProfileLight(read), read, "a second read changes nothing");
  assert.equal(upgradeRecipeLightScale(read.light_recipe), read.light_recipe);
  const saved = validateProfile(legacy);
  assert.equal(saved.light_recipe.phases.fruiting.white_brightness_percent, 4.75);
  assert.equal(saved.light_recipe.white_scale, LIGHT_SCALE);
  assert.equal(whitePercentToLux(saved.light_recipe.phases.fruiting.white_brightness_percent), 190);
  assert.deepEqual(validateProfile(saved), saved, "saving a marked recipe leaves the percent alone");
});
