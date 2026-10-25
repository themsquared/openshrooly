# Per-stage light settings

Every built-in profile stage names a complete light mix: sunrise hour, hours on, white lux, and RGB. Duration 0 is only for an explicit dark stage (lux 0 and RGB 0). A schedule with brightness on and duration 0 is invalid.

Firmware 1.0.x still has one live schedule. Hub, cloud apply, and the device UI write that schedule when a grow starts or a stage changes. The firmware does not store the profile. If duration is 0 or unset while lux or RGB is on, firmware 1.0.3-sl.6 uses 12 h, logs a warning, and shows it on Light Status.

Create and update are strict. Profiles saved before this rule are not rewritten in storage. When the API or Hub reads one, a stage with no light reads as dark, and a stage with lux or RGB on and 0 or missing hours reads as 12 h, the same as the firmware.

## Value sources

Numbers come from `shared/openshrooly_lib/light_recipes.py`. Where a paper does not give a room lux or photoperiod, the recipe uses a labeled general default: 12 h, 20% white (92 lux on this strip), 80% blue as a WS2812 stand-in for 440 to 470 nm.

White percent and lux use the firmware curve from `lux_to_brightness` in `esphome/scripts/lighting_control_manager.yaml`. At or below 20% it is linear and 20% is 92 lux. Above 20% it is lux = 0.02307 x percent^2.768, so 26% is 190 lux, 37% is 506 lux, and 51% is 1229 lux. The white entity tops out at 4000 lux (about 78%). The web builder (`whitePercentToLux` in `profile-schema.js`) and `shared/openshrooly_lib/mapping.py` use the same curve.

| Stage | Typical mix | Why |
|---|---|---|
| colonization, rest, cold_shock | Dark (0 h, 0 lux, RGB 0) | Spawn run and rest rooms are usually unlit (Sakamoto 2018; Penn State oyster spawn run). Shiitake cold shock stays dark. |
| browning | Low light: 12 h, about 200 lux (26% white, 190 lux on this strip), blue 80 | Shiitake skin browning is light induced. See the shiitake note below. |
| pinning | Same as fruiting unless a paper says otherwise | Light is the usual pinning cue. |
| fruiting, flush | Species recipe | See the profile `light_recipe.sources`. |

Species notes:

- Oysters: 12 h, 92 lux, blue-heavy. Penn State 50 to 300 lux band; Richartz and MacLellan 1987; Wang 2020.
- Lion's mane: 12 h, 200 lux (26% white). Jozifek et al. 2025 additional tests. Their 24 h / 500 lux run caused pink stress coloring and is not used.
- Shiitake browning: 12 h, about 200 lux (26% white), blue 80. Cold shock stays dark. Sources:
  - Yoo et al. 2019, BMC Genomics 20, describes light-induced brown film on the mycelium as an important process for yield and quality ([doi](https://doi.org/10.1186/s12864-019-5509-4)).
  - Kim et al. 2024, Mycobiology, incubated blocks 60 days dark, then 40 to 60 days under blue or white LED at 4 umol/m2/s, and browning happened in that light period. It cites Park et al. 2017 (J. Mushrooms 15) for high browning efficiency at 200 lux regardless of light source ([doi](https://doi.org/10.1080/12298093.2024.2430052)).
  - Koo et al. 2018, J. Mushrooms 16(4), browned blocks with light on a 1 h on, 1 h off cycle at 20 °C for 60 days. The best browning came at 1.5 umol/m2/s red and blue LED. The strongest settings tested (20.5 umol/m2/s and 300 lux fluorescent) browned less ([earticle](https://www.earticle.net/Article/A348305)).
  - The chamber has one daily light window, so 12 h stands in for the 1 h on, 1 h off cycle, and 200 lux stays under the 300 lux level where Koo saw less browning.
- Cordyceps: 12 h, about 1250 lux (51% white). Wu 2016 cordycepin optimum.
- Reishi / maitake: 12 h, about 500 lux (37% white). Maitake keeps RGB off because Chi 2008 found white outyielded blue.
- Button / cremini and commercial enoki: dark in every stage (Agaricus does not need light; long-stem enoki stays pale without it).
- Off-menu cubensis group: 12 h fruiting from Badham 1980 and Waldbillig 2023. Intensity is the labeled general default.

Sunrise defaults to 08:00 on every stage. The chamber strip does not have a separate sunrise ramp entity, so ramp length is not stored.
