---
id: "autopilot-fan-limits"
claim: "Autopilot may move the fan 20 points from the stage recipe fan speed (FAN_BAND), in steps of 10 (FAN_STEP), and never outside the 0 to 80 clamp (FAN_CLAMP). The fan holds a step until relative humidity is within 1 point of the stage humidity target (FAN_IN_BAND). If humidity stays out of band without improving, Coach may step as far as 30 points from the recipe (FAN_ESCALATE_BAND), wait 60 minutes between extra steps (FAN_ESCALATE_HOLD_MS), and count a move of at least 0.5 humidity points toward the target as improving (FAN_ESCALATE_IMPROVE)."
evidence_type: "test"
source:
  - community/api/src/autopilot-knobs.js (FAN_BAND, FAN_CLAMP, FAN_STEP, FAN_IN_BAND, FAN_ESCALATE_BAND, FAN_ESCALATE_HOLD_MS, FAN_ESCALATE_IMPROVE), last changed in commit 38bb8cf on 2026-11-16
  - community/api/test/autopilot-knobs.test.js (asserts fanRangeForStage uses the stage fan plus or minus 20 inside the clamp, and steerFan steps by 10)
date: "2026-11-16"
pages:
  - /coach
  - /ai/autopilot
  - /ai/grow-coach
  - /ai
  - /ai/smart-mushroom-grow-box-humidity-and-fresh-air
---

# Autopilot fan limits

These constants are defined in `community/api/src/autopilot-knobs.js` and checked in `community/api/test/autopilot-knobs.test.js`. The test named "fan guardrail is the stage fan +/- 20" pins the band, and the dry/wet cases pin the 10-point step and the 80 clamp.

Do not cite a different band, step, or clamp unless the source and the test both change.
