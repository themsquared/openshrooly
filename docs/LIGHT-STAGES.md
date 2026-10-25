# Per-stage light settings

Every built-in profile stage names a complete light mix: sunrise hour, hours on, white lux, and RGB. Duration 0 is only for an explicit dark stage (lux 0 and RGB 0). A schedule with brightness on and duration 0 is invalid.

Firmware 1.0.x still has one live schedule. Hub, cloud apply, and the device UI write that schedule when a grow starts or a stage changes. The firmware does not store the profile. If duration is 0 or unset while lux or RGB is on, firmware 1.0.3-sl.6 and later uses 12 h, logs a warning, and shows it on Light Status.

## Value sources

Numbers come from `shared/openshrooly_lib/light_recipes.py`. Where a paper does not give a room lux or photoperiod, the recipe uses a labeled general default: 12 h, 20% white (92 lux on this strip), 80% blue as a WS2812 stand-in for 440 to 470 nm.

| Stage | Typical mix | Why |
| colonization, rest, browning, cold_shock | Dark (0 h, 0 lux, RGB 0) | Spawn run and rest rooms are usually unlit (Sakamoto 2018; Penn State oyster spawn run). Shiitake browning and cold shock stay dark. |
| pinning | Same as fruiting unless a paper says otherwise | Light is the usual pinning cue. |
| fruiting, flush | Species recipe | See the profile `light_recipe.sources`. |

Species notes:

- Oysters: 12 h, 92 lux, blue-heavy. Penn State 50 to 300 lux band; Richartz and MacLellan 1987; Wang 2020.
- Lion's mane: 12 h, 200 lux (26% white). Jozifek et al. 2025 additional tests. Their 24 h / 500 lux run caused pink stress coloring and is not used.
- Cordyceps: 12 h, about 1250 lux (51% white). Wu 2016 cordycepin optimum.
- Reishi / maitake: 12 h, about 500 lux (37% white). Maitake keeps RGB off because Chi 2008 found white outyielded blue.
- Button / cremini and commercial enoki: dark in every stage (Agaricus does not need light; long-stem enoki stays pale without it).
- Off-menu cubensis group: 12 h fruiting from Badham 1980 and Waldbillig 2023. Intensity is the labeled general default.

Sunrise defaults to 08:00 on every stage. The chamber strip does not have a separate sunrise ramp entity, so ramp length is not stored.
