# Autopilot with Jev

Autopilot can ask Jev, TypeSafe's System One model, what to nudge next, in place of
the built-in rules. Jev answers a handful of narrow questions. The code still decides
how far anything moves and how often.

It is off by default. `AUTOPILOT_DECIDER=rules` (or unset) keeps the rules decider.
`AUTOPILOT_DECIDER=jev` turns on Jev.

## What Jev is asked

Each pass asks five questions in one request (`POST https://api.typesafe.ai/v1/systemone`,
model pinned to `jev-1.14.0`):

| Question | Type | Answers |
| --- | --- | --- |
| `temperature` | Choice | raise / hold / lower the temperature setpoint |
| `humidity` | Choice | raise / hold / lower the humidity setpoint |
| `fan` | Choice | raise / hold / lower the fresh air fan speed |
| `light` | Choice | raise / hold / lower white light brightness |
| `abnormal` | Noul | do the readings look broken, or does a sensor look off? |

On every Choice, `hold` is the safe answer. Its description tells Jev to pick it when it isn't sure.

The questions live in `JEV_QUESTIONS` in `community/api/src/jev.js`.

## What Jev sees

Jev gets the chamber's structured state. It has no free text and no user data.

- The chamber's profile, stage, phase and grow day.
- The current reading and the current setpoints (temperature, humidity, fan, light,
  light schedule).
- The stage targets and guardrails, the step sizes, and the max changes per day.
- What the rules decider would do this pass.
- The last 5 Autopilot commands: what changed, how long ago, and whether each one landed or was undone.
- A time series covering every numeric feed in telemetry for the last 6 hours, averaged
  into 30-minute buckets, with the newest bucket last. That includes temperature, humidity,
  their setpoints and target bands, fan speed, period and run time, light brightness, color
  and schedule, plus a `light_on` column worked out from sunrise and light hours. A new
  feed (lux, water level, CO2) is picked up as soon as the chamber reports it. Today's
  chambers don't report lux, water level or CO2.

## What code decides

- **Confidence.** A raise or lower only counts at a confidence of 0.6 or higher
  (`JEV_MIN_CONFIDENCE`). Below that, the rules value stands for that knob.
- **Fixed steps.** A confident raise or lower moves exactly one step from the current
  setpoint: 0.5 °C, 2 % RH, 10 % fan, 50 white. A confident hold keeps the current value.
- **Clamps.** The result then goes through the same planner as the rules decider: stage
  guardrails, per-pass step limits, 1 hour between changes, 8 changes a day, the 2-hour
  command expiry, newer commands replacing older ones, Undo, and the auto-pause on stale readings.
  Light stays within ±50 % of the stage recipe's brightness. Jev doesn't change the light schedule.
- **Abnormal.** If the `abnormal` probability reaches 0.85 (`JEV_ABNORMAL_PAUSE`),
  Autopilot pauses back to Advisor, sends nothing to the chamber, and emails the grower
  (when email alerts are on).
- **Off-menu.** Off-menu profiles are refused before Jev is called, the same as with the rules.
- **Audit.** Each applied change records the decider, the model, and every knob's choice,
  confidence, probabilities, and whether Jev's answer or the rules value was used. It also
  records the abnormal probability, token usage and latency. All of this goes in the
  Autopilot log's readings, and Undo works the same as before.

## When it falls back

If the key is missing, the request fails (any HTTP error, including 429 and 529), takes
longer than 2 seconds, or returns a malformed answer, that pass uses the rules. The log
line is `jev_fallback` with the reason only. The key is never logged.

## Caps

Jev is only called when a change could actually go out this pass. Calls are also capped,
using the same `envInt` pattern as the Coach caps:

| Var | Default | Meaning |
| --- | --- | --- |
| `JEV_MIN_CALL_INTERVAL_MIN` | 30 | minimum minutes between calls per chamber |
| `JEV_DAILY_CALLS_PER_DEVICE` | 48 | calls per chamber per UTC day |
| `JEV_DAILY_TOKENS_PER_DEVICE` | 150000 | input tokens per chamber per day |
| `JEV_GLOBAL_DAILY_TOKENS` | 2000000 | input tokens per day, all chambers |

Once a cap is hit, Autopilot uses the rules until the next day. The counters live in `coach_cache`, so there's no schema change.

## Cost

The price is $0.042 per million input tokens, and output is free.

Measured on Thing One (lions-mane), 13 live calls replayed from its last 12 hours of telemetry:

- Request body: 6.5 KB (state 2.2 KB, the rest is the five questions).
- Input tokens: 2,657–2,740 per call, 2,705 on average.
- Per call: 2,705 × $0.042 / 1M = **$0.000114**.
- Per chamber per day at the cap of 48 calls: **$0.0055** (about $0.16 a month).
- The global token cap limits total spend to about $0.084 a day.

A steady chamber hits about 48 calls a day, because nothing changes and every 30-minute
window is eligible. A chamber that's being adjusted makes fewer calls.

## Trying it

```sh
cd community/api
node scripts/jev-dry-run.js --device sldev_... --hours 12 --every 60
```

This replays a chamber's recent telemetry from D1 through both deciders and prints them
side by side, along with tokens and request size. It only reads: one SELECT per table,
with no writes and no commands. Without `TYPESAFE_API_KEY` in the environment, it prints
the rules column only.

## Turning it on

1. Get TypeSafe early access and an API key.
2. Run `printf %s "$TYPESAFE_API_KEY" | npx wrangler secret put TYPESAFE_API_KEY -c wrangler.deploy.toml`.
3. Change `AUTOPILOT_DECIDER = "rules"` to `"jev"` in `community/api/wrangler.deploy.toml` and deploy. A dashboard change gets overwritten by the next deploy. Set it back to `rules` to turn Jev off.
   The flag applies to every chamber in Autopilot mode.
