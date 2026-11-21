---
id: "autopilot-recipe-not-model"
claim: "Autopilot chamber knobs (fan, fresh air, light, and phase) are the stage recipe or a bounded step from it. Nothing in the Autopilot knobs module comes from a model. When the chamber can take them, Autopilot sets air_exchange_period_min, air_exchange_run_sec, sunrise_hour, light_hours, white_intensity, color_r, color_g, and color_b straight from the stage recipe (RECIPE_KEYS)."
evidence_type: "test"
source:
  - community/api/src/autopilot-knobs.js (file header and RECIPE_KEYS), last changed in commit 38bb8cf on 2026-11-16
  - community/api/test/autopilot-knobs.test.js (imports recipeKnobs and the knobs module and exercises those recipe fields against source)
date: "2026-11-16"
pages:
  - /coach
  - /ai/autopilot
  - /ai/grow-coach
  - /ai
  - /ai/can-ai-grow-mushrooms
---

# Autopilot uses the stage recipe, not a model

The module header in `community/api/src/autopilot-knobs.js` states that every value is the stage recipe or a bounded step from it, and that nothing there comes from a model. Cite that distinction when a page explains how Autopilot decides. Do not claim a model sets these knobs.
