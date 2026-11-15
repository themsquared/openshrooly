# Device UI and control standard

Status: design, Nov 15, 2026. Nothing here changes behavior until the migration steps below ship.

The rule: a grower, the site and Grow Coach work on one model, whatever chamber sits on the shelf.
How a chamber hits its targets (fans, mister pulses, light curves) is the firmware's job.

## The model: one stage, four knobs

Stage is one of **Colonization, Pinning, Fruiting, Custom**. A stage holds exactly four knobs, in this order everywhere:

| Knob | What it holds | Canonical unit |
| --- | --- | --- |
| Temp | target, tolerance | degrees C |
| Humidity | target, tolerance | percent RH |
| Light | schedule (sunrise hour, duration) and mix (white, red, green, blue) | hours, percent of full |
| Fresh air | fan speed, how often, how long | percent, minutes, seconds |

Picking a stage loads the four knobs from the profile. Any knob can then be changed by hand, or by Coach.
Custom loads nothing.

Day count (grow day, days in stage) rides along with Stage. It is not a fifth knob.

## On-device page and site layout

1. Stage picker on top, four buttons in the order above.
2. Four cards in the order Temp, Humidity, Light, Fresh air. Chamber readings (water level, mist level, CO2) and Settings come after them.
3. Same labels, same units, same error display on every page. A write the chamber refuses or ignores shows a plain message with the HTTP status. A zero from the chamber shows as zero.
4. A chamber without a control shows one line saying so in that spot. The layout never changes.

## Firmware canonical entity spec

Firmware owns the logic that reaches the targets. It exposes the model natively, with these names and units, so no translation is needed. Names are ESPHome display names; ids are the snake case form.

| Entity | Type | Range and unit |
| --- | --- | --- |
| Stage | select | Colonization, Pinning, Fruiting, Custom. Selecting one loads the four knobs. |
| Temp Target, Temp Tolerance | number | degrees C |
| Humidity Target, Humidity Tolerance | number | percent RH |
| Light Sunrise Hour | number | 0 to 23, whole or quarter hours |
| Light Hours | number | 0 to 24 hours, quarter hour steps. 0 means dark. |
| Light White, Light Red, Light Green, Light Blue | number | 0 to 100 percent. Any lux curve stays inside the firmware. |
| Light Brightness | number | 0 to 100 percent, master level |
| Light Enabled | switch | on means follow the schedule |
| LED Test | button | shows red, green, blue, white, then returns to the schedule |
| Fresh Air Speed | number | percent. The firmware clamps to its own fan minimum. |
| Fresh Air Every | number | minutes |
| Fresh Air Run | number | seconds |

Rules for firmware:

- A change applies right away, not on the next loop tick.
- LED Test owns the light until it ends, then the schedule resumes.
- Out of range writes are clamped and the clamped value is published, so a read back always shows the truth.
- Telemetry and the local `/api/status` carry the same names and units, with the stage, the four knobs (target and measured) and light mix, plus health. Mechanism detail (mister pulse state, fan level) goes in a separate `detail` object that Coach never reads.
- The cloud link reports every canonical knob, including Light Brightness and Light Enabled, and accepts a setpoints command for any of them.

## Cloud adapter interface

For stock firmware, unflashed units and older releases, the cloud keeps a thin adapter per device type in `community/api/src/device-capabilities.js`:

```
adapter.capabilities(doc)        // which of the four knobs exist, ranges, steps
adapter.fromDevice(doc)          // telemetry in, canonical stage and knobs out
adapter.toDevice(canonical)      // canonical command in, wire payload out (names, units, clamps)
adapter.stageName(canonicalStage) // Colonization to Colonizing on older Shrooly firmware
```

A firmware that exposes the canonical spec uses the identity adapter. Coach and the site call only these four functions and never look at the device type.

## Where device specifics leak today

Coach itself reads no device type. The leaks sit around it:

- `device-capabilities.js`: `isLykynChamber`, `LYKYN_GROW_PHASE_OPTIONS` and `growPhaseForStage` (Colonization or Colonizing), `whiteIsPercent` and `lightToKnobs` (lux or percent), the static `KNOBS` ranges (fan minimum 15 in the table, 33 on a Lykyn), `DEVICE_TYPES` ranges per type.
- `fleet.js`: `deviceTypeLabel`, translation messages and `previewResult` take `caps` and branch on the unit.
- `community/web/public/js/device-ui.js`: `whiteIsPercentDevice` picks labels and drops the lux preview.
- `community/web/public/js/app.js`: light submit builds a white value for each type.
- Shrooly page: lux slider and curve, `|| 150` default that hides a real 0, no LED Test, no brightness or schedule switch.
- Lykyn firmware: names differ from Shrooly (`Light White` percent against `white_intensity` lux), fan minimum 33, stage presets live in the firmware but Shrooly has none.
- Firmware gaps: Light Brightness and Light Enabled are not cloud knobs and not in telemetry.

## Migration plan

1. Cloud fix (PR 202): Coach follows a manual stage, Start this grow works under Coach, Lykyn white as percent. Ships first.
2. Adapter refactor, its own PR: split `device-capabilities.js` into the four adapter functions per type. Tests run the same Coach scenarios against a Shrooly fixture and a Lykyn fixture and assert the same stage, the same knob decisions and the same refusal reasons. No behavior change.
3. Site and on-device pages move to the layout above. Shared module in the web and the two webapps: stage list, knob list, labels, write error text.
4. Lykyn firmware: rename entities to the spec, add Light Brightness and Light Enabled to the cloud knobs and telemetry, `/api/status` as above. Branch only until Mike says flash.
5. Shrooly firmware: add the spec entities as thin wrappers over the current ones (percent white that maps to lux inside), Stage presets from the profile, LED Test, immediate apply. Branch only until Mike says flash.
6. When a device reports the canonical spec (capability token `canonical.v1`), the cloud uses the identity adapter for it. The old adapters stay for devices that do not.

## Adding a chamber type later

Write its firmware to the spec above. If it cannot, write one adapter with the four functions. Nothing in Coach, the site or the pages changes.
