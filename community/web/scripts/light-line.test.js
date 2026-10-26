import test from "node:test";
import assert from "node:assert/strict";
import { lightRecipeLine } from "../public/js/light-line.js";

const off = { photoperiod_hours: 0, white_brightness_percent: 0, red_percent: 0, green_percent: 0, blue_percent: 0 };

test("light recipe reads as one plain line", () => {
  const oyster = { phases: { colonization: off, fruiting: { photoperiod_hours: 12, white_brightness_percent: 20, red_percent: 0, green_percent: 0, blue_percent: 80 } } };
  assert.equal(lightRecipeLine(oyster), "Dark while it colonizes, then 12 h a day of cool white with some blue.");
  const white = { phases: { colonization: off, fruiting: { ...off, photoperiod_hours: 12, white_brightness_percent: 37 } } };
  assert.equal(lightRecipeLine(white), "Dark while it colonizes, then 12 h a day of cool white.");
  assert.equal(lightRecipeLine({ phases: { colonization: off, fruiting: off } }), "No light needed. It grows in the dark.");
  assert.doesNotMatch(lightRecipeLine(oyster), /nm|WS2812|RGB/);
});
