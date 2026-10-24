# Device growing screen

Waveshare `2.90inv2-r2` e-paper, LVGL rotation 90, canvas **296 x 128**, 1-bit inverted (`paper_white` / `paper_black`). Pins, driver, and refresh rules stay upstream: `update_interval: never`, `full_update_every: 300`, labels every **10 seconds** so values use partial refresh.

Regenerate the PNGs (native + 4x nearest neighbor):

```bash
python3 scripts/render_epaper_previews.py
```

| File | State |
| --- | --- |
| `growing-in-range.png` | Fruiting, day 6 of 10, temp/RH on target |
| `growing-alert.png` | Same grow, values drifting, water low |
| `idle.png` | No grow; climate numbers still shown |
| `boot-splash.png` | 1-bit logo + OpenShrooly wordmark |

Each has a `@4x.png` sibling.

## What the screen reads

Upstream entities only for live data:

- `temperature`, `humidity`, `temperature_target`, `target_humidity`, `temperature_hysteresis`, `humidity_hysteresis`
- `temperature_warning_minimum` / `temperature_warning_maximum` (existing alert binary sensors)
- `water_level_percent` (banner when below **15**, the empty / S0-approaching band from `water_level_calculator`)
- `sntp_time`, `sunrise_hour`, `light_hours`, `lights_on_flag`, `lights_status`
- `air_exchange_on_flag`, `air_exchange_next_on_ts`, `air_exchange_next_off_ts`
- `humidifier_on_flag` (mist is demand-based, so the line says `Misting` when the pad is on)
- `alert_temp_too_low`, `alert_temp_too_high`, `alert_humidity_failure`

Display-only caption (does **not** change climate, lights, fan, or humidifier):

- `grow_phase` (Idle / Colonizing / Pinning / Fruiting / Harvest)
- `grow_days_total`
- `grow_day` is derived from `grow_started_ts` and the RTC/SNTP clock (`1 + elapsed 86400s`). It is display-only; climate scripts do not read it.

Idle is the default. Starting a non-Idle phase with a total day count stamps `grow_started_ts`. A later device web UI can set the caption when a profile is applied.

The bottom-left line is Wi-Fi state plus IP, or `Join OpenShrooly, then 192.168.4.1` in AP mode, so first-time setup stays readable from the panel.

## Deviations from grahamsz/openshrooly

| Change | Why | Control logic |
| --- | --- | --- |
| Main page layout (`aaaa`) | Across-the-room growing screen | Unchanged. Select still opens the menu. Page id stays `aaaa`. |
| Boot splash page, 2s | 1-bit logo | SWD / fan / humidity still start 5s after LVGL is ready (2s splash + 3s wait). |
| Spleen 8x16 and 16x32 | Distance-readable type | Fonts only. Same 1-bit family as upstream `font1`. |
| `grow_phase` / day numbers | Phase line and progress bar | Diagnostic, hidden from the main web groups. Day advances from start time + clock. No climate `on_value` scripts. |
| `font_ui` / `font_hero` | Distance-readable type | Declared on `display.yaml`'s `font:` list. A second `font:` in `lvgl_config.yaml` is dropped by `<<` merge. |
| Water-low banner at 15% | Subtle out-of-band treatment | Reads `water_level_percent` only. No new humidifier interlock. |
| 10s update script moved to `update_growing_screen` | Keep `openshrooly.yaml` interval small | Still `component.update: my_display` every 10s. `full_update_every: 300` untouched. |

Not changed: display driver and pins (GPIO 8/48/38/21), sensors, humidifier / fan / light managers, climate, OTA, safe mode, partition layout, button map.

## How to validate on a device

1. Flash the usual OpenShrooly build. First paint should be the logo, then the growing screen.
2. With `grow_phase=Idle` (default), confirm big temp/RH, `Idle`, `No grow running`, and the Wi-Fi / AP hint on the bottom left.
3. Set `grow_phase=Fruiting` and `grow_days_total=10`. Confirm `Fruiting, day 1 of 10` at start, then that the day number advances with the clock. `--.-` / `--:--` / `tgt --` placeholders must show the hyphen.
4. Confirm next-event text tracks `sunrise_hour` + `light_hours` or the next FAE timestamp, and says `Misting` while the humidifier is on.
5. Lower water below 15% or trip a temp warning. Confirm the inverted `WATER LOW` / `TEMP HIGH` strip. Values should still partial-refresh; a full refresh still happens every 300 updates.
6. Button 4 still opens Settings. Back still returns to this screen.
