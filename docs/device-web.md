# Offline device web UI

The chamber dashboard is the Next.js app in `webapp/`, gzip-embedded by ESPHome `web_server` v3:

```yaml
app_html_include: ../webapp/out/index.html
```

`webapp/out/` is gitignored. Flash the rebuilt `index.html`, not a second LittleFS tree. Captive portal and the ESPHome entity form stay at `/`. This UI is at `/app/`.

## Surfaces

| State | How we know | What the grower sees |
| --- | --- | --- |
| Unreachable | REST and `/events` both fail | Retry. Same Wi-Fi, or `OpenShrooly` AP at `192.168.4.1` |
| First-run Wi-Fi | `wifi_mode=Access Point` or SSID `OpenShrooly*` | Setup banner + link to `/` for the stock Wi-Fi form |
| Empty grow | `grow_phase` is Idle / missing, or `grow_days_total=0` | Culinary presets. Climate sliders still work |
| Ready | Station Wi-Fi + an active phase | Gauges, grow strip, light timeline |

Helpers live in `webapp/lib/setup-state.js` (no DOM). Tests: `cd webapp && npm test`.

## What a preset writes

Presets are captions for the e-paper growing screen, plus the **same** number entities the sliders already use.

| Preset | `grow_phase` | day / total | Climate writes |
| --- | --- | --- | --- |
| No grow | Idle | 0 / 0 | none |
| Colonizing, 14 days | Colonizing | 1 / 14 | RH 90, 24 °C, sunrise 8, 0 h light |
| Oyster fruiting, 10 days | Fruiting | 1 / 10 | RH 90, 22 °C, sunrise 8, 12 h light |
| Lion's mane fruiting, 14 days | Fruiting | 1 / 14 | RH 90, 18 °C, sunrise 8, 12 h light |

Idle never touches humidity, temperature, or lights. There is still no on-device recipe object; the local hub can keep applying full profiles over the same REST.

## Flash budget

No webfonts, no extra images, no CDN. This ship adds first-run copy and preset buttons to the existing gzip bundle.

| Artifact | Notes |
| --- | --- |
| `webapp/out/index.html` | Next static export. Embedded, not committed |
| Extra JS/CSS | First-run banner + four preset cards. System fonts only |
| Firmware YAML | Unchanged in this ship. `grow_*` arrived in Ship 5a as diagnostic entities |

Rebuild after UI edits:

```bash
cd webapp && npm ci && npm run build
```

Then compile firmware so `app_html_include` picks up the new `out/index.html`.

## Deviations from grahamsz/openshrooly

None in YAML. This ship is UX on stock REST (`/number`, `/select`, `/text_sensor`, `/events`). Climate, pins, sensors, humidifier, fan, lights, OTA, safe mode, and partitions stay upstream.

## Secrets and migrations

None. No Worker secrets, no D1 SQL, no wrangler change.

## How to validate in prod (site / hub)

This UI is on-device. After a firmware flash that embeds the new `out/index.html`:

1. Open `http://<device-ip>/app/` on the same LAN. Gauges should populate from `/events`.
2. `http://<device-ip>/` still shows the ESPHome form and captive-portal Wi-Fi fields.
3. Community site and API are unchanged. `curl -sI https://api.shroomlabs.io/health` should still be 200 from earlier ships.

## Hardware checklist

1. Factory / erased NVS: join `OpenShrooly`, open `http://192.168.4.1/app/`. Setup banner, not a wall of zeroed cards.
2. Use `/` or the phone captive portal to join home Wi-Fi. Reload `/app/` on the home network. Banner should clear.
3. Idle chamber: "No grow is running" plus the four presets. Climate sliders still change RH / temp / light.
4. Tap **Oyster fruiting, 10 days**. E-paper (Ship 5a) should show `Fruiting, day 1 of 10`. Sliders should read RH 90, 22 °C, 12 h light.
5. Tap **No grow**. Caption returns to Idle. RH / temp / light stay where they were.
6. Pull the phone off the chamber network. `/app/` shows the unreachable retry, not a spinner forever.
7. Button 4 still opens the physical settings menu. Water calibration and OTA file upload in Settings still work.
8. `?demo=1` still paints the demo gauges without a device.

## API used (stock)

| Action | Route |
| --- | --- |
| Wi-Fi caption | `GET /text_sensor/wifi_mode`, `wifi_ssid`, `ip_address` |
| Grow caption | `GET /select/grow_phase`, `GET /number/grow_day`, `GET /number/grow_days_total` |
| Apply preset | `POST /select/grow_phase/set?option=`, `POST /number/{id}/set?value=` |
| Live updates | `GET /events` |
