---
id: "coach-water-thresholds"
claim: "Coach water alerts default to a low threshold of 30 and an empty threshold of 12 (percent of tank). A reading below 12 is empty, a reading from 12 up to but not including 30 is low, and 30 or above is ok. Water recovers once the level is 5 points above the low or empty mark (WATER_HYSTERESIS). Owners may set below between 5 and 60 and empty between 2 and 30. water_empty is an urgent second tier of the water rule, not a separate setting."
evidence_type: "test"
source:
  - community/api/src/alerts/rules.js (DEFAULT_RULES.water below 30, empty 12; WATER_HYSTERESIS 5; updateRules limits), last changed in commit 63fdba4 on 2026-11-19
  - "community/api/src/alerts/water.js (waterSeverity: level < emptyAt is empty, level < below is low)"
  - "community/api/test/alerts.test.js (assert readRules({}).water.below === 30 and readRules({}).water.empty === 12)"
  - community/api/test/water-fields.test.js (assert waterSeverity at 5 is empty, at 29 is low, at 30 is ok, using below 30 and empty 12)
date: "2026-11-19"
pages:
  - /coach
  - /ai/grow-coach
  - /ai/autopilot
  - /ai
  - /ai/photo-check-and-charts
---

# Coach water alert thresholds

Defaults and severity come from `community/api/src/alerts/rules.js` and `community/api/src/alerts/water.js`. The tests named above pin the default 30 / 12 cuts and the severity bands. Do not cite a different default without a source and test change.

An inferred alert (no tank sensor) must not claim the tank is empty. That honesty rule is covered in `community/api/test/alerts.test.js` ("an inferred alert never claims the tank is empty").
