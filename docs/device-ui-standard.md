# Device UI standard

Every Shroom Labs chamber looks and works the same. A grower picks a stage, then sets four knobs. The same on the cloud site, on the chamber's own page, in Coach, and in the local status API. What differs between chambers stays inside that chamber's adapter.

## Stage and four knobs

A stage selector sits on top: Colonization, Pinning, Fruiting, Custom. A stage loads the profile's numbers into the four knobs. Under it, in this order on every device:

1. Temperature (degrees C)
2. Humidity (% RH)
3. Light (hours on, sunrise hour, and the mix: red, green, blue and white, each in percent)
4. Fresh air (fan speed in percent, how often in minutes, how long in seconds)

Firmware owns how a chamber reaches the numbers. Cloud adapters stay thin. Coach does not branch on device type. A control a chamber lacks shows one short note in its place, never a different layout.

Device specifics live in one adapter per chamber type: `community/api/src/device-adapters.js` and `community/web/public/js/device-adapters.js`. Examples are the phase name (Colonizing on the Shrooly, Colonization on the Lykyn), the lowest fan speed (15 and 33), and how white is stored.

## Light percent means the same thing everywhere

Light is 0 to 100 percent, and 100 is the most that channel can put out on that chamber. The scale is linear in output, so 50% is half the output. The same percent is the same share of the chamber's own maximum.

| Chamber | Native unit | Rule | 100% is |
|---|---|---|---|
| Shrooly white | lux, 0 to 4000 | lux = 40 x percent | 4000 lux, the top of the white entity |
| Lykyn white and RGB | percent of the full channel | percent as is, at ring brightness 100 and gamma 1.0 | full ring output |

The Lykyn ring is linear (gamma 1.0). Its ring brightness is a separate master dimmer that defaults to 100, so a percent on the page is a percent of full output. If someone lowers the master dimmer, the local status API reports the effective output (channel x brightness / 100).

Conversion between percent and a native unit lives in the adapter only (`whitePercentToLux` and `whiteLuxToPercent` in `profile-schema.js`, behind `deviceAdapter(...).white`; `white_percent_to_lux` and `lux_to_white_percent` in `shared/openshrooly_lib/light_scale.py`). Nothing else converts.

Percent keeps three decimals. That is exact for any whole lux, because 1 lux is 0.025%, so percent and lux round trip with nothing lost over 0 to 100. Round for display only: whole numbers stay whole, otherwise one decimal (2.3%).

### Recipes and the scale marker

A profile's light recipe stores white as percent on this scale and carries `white_scale: "output"`. A recipe with no marker was written on the old scale, where the percent was the input to the firmware curve (20% was 92 lux, and anything above about 78% was 4000 lux). The API and the Python loader upgrade an unmarked recipe on read and on save: the old percent goes through the old curve to lux, and lux is divided by 40. The lux a stage makes does not change. Upgrading twice does nothing, and no stored row is rewritten.

| Old percent | Lux (unchanged) | New percent |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 5 | 0.125 |
| 10 | 46 | 1.15 |
| 20 | 92 | 2.3 |
| 26 | 190 | 4.75 |
| 37 | 506 | 12.65 |
| 51 | 1229 | 30.725 |
| 65 | 2405 | 60.125 |
| 79 to 100 | 4000 | 100 |

Profiles that cite a lux figure keep the lux they actually produced, so the new percent can look uneven (200 lux in the source is 190 lux made, which is 4.75%).

### What this means across chambers

A profile's percent is a share of each chamber's maximum, so the same profile sends the same percent to a Shrooly and a Lykyn. It does not promise the same lux. The Shrooly maximum is measured (4000 lux). The Lykyn ring has no lux calibration yet. A lux meter reading at full ring output would let the Lykyn adapter report lux too.

## Profiles state a physical light target

Percent is what Coach, the pages and the status API speak. A profile stage still states the light it wants in physical terms: `white_led_lux` (lux of white) and, optionally, `blue_umol_m2s` (blue photon flux, umol per m2 per second). Each chamber type carries a calibration in `community/api/src/light-calibration.js` (the site reads a byte-identical copy): what it puts out at 100 percent.

| Chamber | White at 100% | Blue at 100% | Basis |
|---|---|---|---|
| Shrooly | 4000 lux | none yet, uses the stage's blue percent | The white entity's cap. The lux curve was measured with a Sekonic L-758DR; the strip itself reached 8317 lux at full drive. |
| Lykyn | 400 lux | 3.5 umol/m2/s | Estimated, not measured. 16 WS2812B pixels, datasheet intensities, 30 to 50% of the light reaching a 30 x 30 cm floor. The range is about 160 to 600 lux and 1.6 to 5.3 umol/m2/s. |

The adapter turns a target into that chamber's percent (lux / lux-at-100, clamped to 100). So 92 lux is 2.3% on a Shrooly and 23% on the Lykyn estimate. When a target is above what the chamber makes, the command goes out at 100 and the site and Coach say so: "Wanted 600 lux of white, this chamber tops out at about 400 lux (estimated)." A blue target converts the same way on a chamber that has a blue figure, and falls back to the stage's blue percent on one that does not.

To replace the Lykyn estimate, change the two numbers in `light-calibration.js`, copy the file to `community/web/public/js/`, and set `estimated` to false. Nothing else holds them. Coach and the stage code never check the chamber type: they ask the adapter.

## Local status API

`GET /api/status` reports light as `rgba`, each 0 to 100 and normalized to that chamber's maximum. `a` is the white channel, not opacity. See `docs/local-api.md` on the firmware branches.

## Adding a chamber type

1. Add its adapter on the API and the web (phase names, fan minimum, how white is stored, what it lacks).
2. Make its firmware accept the stage and the four knobs, and report light as percent of its own maximum.
3. Add it to the parity tests in `community/api/test/device-commands.test.js`. Coach must make the same decisions on it as on a Shrooly.
