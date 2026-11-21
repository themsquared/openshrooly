---
id: "coach-alert-defaults"
claim: "Default Coach alert rules are: temperature enabled with a 30-minute delay; humidity enabled with a 30-minute delay and a margin of 8 points around the humidity target; offline enabled with a 30-minute delay; fruiting enabled. Default prefs use the America/Los_Angeles time zone, quiet hours from 22:00 to 07:00, a 360-minute cooldown, and email on. Recovery requires 10 minutes back in range (RECOVERY_MINUTES). When no grow is tracked, temperature range falls back to plus or minus 3 around the chamber or profile set point (SETPOINT_TEMP_MARGIN). There is a hard cap of 12 alert emails per person per rolling day (DAILY_EMAIL_CAP)."
evidence_type: "test"
source:
  - community/api/src/alerts/rules.js (DEFAULT_RULES, DEFAULT_PREFS, RECOVERY_MINUTES, SETPOINT_TEMP_MARGIN, DAILY_EMAIL_CAP), last changed in commit 63fdba4 on 2026-11-19
  - community/api/test/alerts.test.js (assert readRules(null).temperature.minutes === 30, and imports readRules / readPrefs from that module)
date: "2026-11-19"
pages:
  - /coach
  - /ai/grow-coach
  - /ai
---

# Coach default alert rules

`DEFAULT_RULES` and `DEFAULT_PREFS` are frozen objects in `community/api/src/alerts/rules.js`. `community/api/test/alerts.test.js` pins `temperature.minutes` at 30 through `readRules(null)`, which returns those defaults. The humidity margin of 8 is the default in that same `DEFAULT_RULES` object: the humidity band is the target plus or minus the margin, capped at 100.

Do not invent a different delay, margin, or email cap.
