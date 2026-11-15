# Shroom Labs local discovery and status API

A shared, read-only LAN contract for every Shroom Labs chamber (Shrooly, Lykyn, and future devices). In-network tools such as Muse can find a chamber and report what it is doing, without writing targets or seeing secrets.

This document is the source of truth. Firmware copies live in:

- openshrooly: `docs/local-api.md`
- lykyn-firmware: `docs/local-api.md`

Schema version 1 is stable. New devices implement this same shape. New fields may be added in a later version. Existing keys keep their meaning. A capability the device does not have is JSON `null`, not omitted, so a client can rely on the keys.

## What already existed

These are still there. This API does not replace them.

Shrooly (OpenShrooly firmware):

- mDNS `_esphomelib._tcp` from ESPHome, used by Home Assistant and the native API.
- mDNS `_http._tcp` when the web server is on, port 80.
- ESPHome web server REST for entities (`/sensor/...`, `/number/...`, and the same for other domains). Those routes can change state on POST (and some GET actions).
- The on-device dashboard is an SPA. Its catch-all would claim unknown two-segment paths, which is why `/api/status` is registered first.
- `GET /cloud` and `GET /grow` are cloud-link helpers, not chamber climate status. `/cloud` can include a claim code and is treated as sensitive on Shrooly.
- Device security leaves ordinary GET reads open on the home network. Writes need the chamber web login. `GET /api/status` is a read, so it stays open.

Lykyn:

- mDNS was enabled with no extra services, so it only advertised the default ESPHome records (`_esphomelib._tcp` when the native API is on, plus `_http._tcp` for the web server).
- ESPHome web server REST, same entity names the OpenShrooly hub already polls. Private builds (`lykyn-home.yaml`, `lykyn-provision.yaml`) protect those entity routes with basic auth. The public installer build does not.
- A compact `Status JSON` text sensor at `GET /text_sensor/Status%20JSON` (or `status_json`), refreshed every 5 seconds. Useful, but it is not versioned, not identical across devices, and on private builds it sits behind the web password.
- `GET /cloud` and `GET /grow` work the same way as on Shrooly.
- The on-device dashboard is at `/`. The stock ESPHome entity table is at `/esp`.

Neither device had a `_shroomlabs._tcp` broadcast or a shared, unauthenticated, versioned `GET /api/status`.

## Discovery

Browse mDNS service `_shroomlabs._tcp` on the local network. The service runs on port 80. The hostname is the device's mDNS name (`openshrooly-xxxxxx.local` or `lykyn.local`).

TXT keys:

| Key | Example | Meaning |
| --- | --- | --- |
| `type` | `shrooly_chamber` or `lykyn_chamber` | Stable device type. Future devices add their own value, same pattern. |
| `model` | `OpenShrooly` or `Lykyn` | Human-readable model. |
| `fw` | `1.0.6-sl.2` | Firmware version string. |
| `api` | `1` | Status schema version. |
| `path` | `/api/status` | Path to the status document. |

Example browse (Avahi):

```
avahi-browse -r _shroomlabs._tcp
```

Example read, once you have the host or address:

```
curl -sS http://lykyn.local/api/status
curl -sS http://openshrooly-xxxxxx.local/api/status
curl -sS http://lykyn.local/api/status/schema
```

Default ESPHome advertisements (`_esphomelib._tcp`, `_http._tcp`) stay as they are. Tools that already speak ESPHome do not need this service. New tools should prefer `_shroomlabs._tcp`.

## Status API

`GET /api/status` returns `application/json`. Cache-Control is `no-store`.

`GET /api/status/schema` returns a compact field guide for the same keys.

`OPTIONS` on both paths is allowed, for browser CORS preflight.

Any other method on those paths returns 405 with `Allow: GET, OPTIONS`. There is no write interface here. To change a target, use the existing ESPHome entity routes (and their auth) or the cloud inbox, not this API.

### Auth and CORS

`GET /api/status` and `GET /api/status/schema` are open on the LAN, even when the web UI or entity REST API is passworded. The payload has no secrets, no Wi-Fi credentials, no MAC address, and no claim code.

CORS allows GET from any origin (`Access-Control-Allow-Origin: *`, methods `GET, OPTIONS`).

Do not put write actions on this path later without revisiting auth.

### JSON shape

`api_version` is `1`. Top-level objects are always present.

```
{
  "api_version": 1,
  "device": {
    "type": "lykyn_chamber",
    "model": "Lykyn",
    "name": "lykyn",
    "firmware": "0.2.0",
    "uptime_s": 3600
  },
  "readings": {
    "temperature_c": {"value": 21.40, "age_ms": 1200, "ts_unix": 1763236800},
    "humidity_pct": {"value": 87.20, "age_ms": 1200, "ts_unix": 1763236800},
    "fan_rpm": {"value": null, "age_ms": null, "ts_unix": null},
    "co2_ppm": {"value": null, "age_ms": null, "ts_unix": null}
  },
  "targets": {
    "temperature_c": 24.0,
    "temperature_tolerance_c": 2.0,
    "humidity_pct": 90.0,
    "humidity_tolerance_pct": 3.0
  },
  "stage": {
    "normalized": "colonization",
    "native": "Colonization"
  },
  "light": {
    "enabled": true,
    "on": false,
    "schedule": {"sunrise_hour": 8, "hours": 12},
    "mix": {"r": 0, "g": 0, "b": 80, "white": 20, "brightness": 50},
    "status": "off"
  },
  "fans": {
    "in_pct": 0,
    "out_pct": 0,
    "speed_set_pct": 33,
    "on": false,
    "boost": false,
    "status": "OFF"
  },
  "humidifier": {
    "on": false,
    "level_pct": 40,
    "status": "OFF"
  },
  "fae": {
    "every_min": 30,
    "run_s": 60,
    "speed_pct": 33
  },
  "climate": {
    "mode": "SMART",
    "fan_boost": false
  },
  "coach": {
    "linked": true,
    "enabled": true,
    "remote_apply": true,
    "state": "linked",
    "last_check_in_age_s": null
  },
  "health": {
    "sensor_stale": false,
    "wifi_connected": true,
    "wifi_rssi_dbm": -52,
    "errors": []
  }
}
```

### Field notes

- Temperatures are Celsius. Humidity and fan or light mix values are percent.
- A reading's `age_ms` is milliseconds since the last good sensor sample, when the firmware tracks that. `ts_unix` is only set when the device clock is synced (SNTP). If the clock is not synced, `ts_unix` is `null`.
- `stage.normalized` is one of: `colonization`, `pinning`, `fruiting`, `harvest`, `idle`, `custom`, `unknown`. `stage.native` is the device's own label. Lykyn uses `Colonization`. Shrooly uses `Colonizing`. Both normalize to `colonization`.
- `light.mix` is the configured color mix, 0 to 100 per channel, plus brightness when the device has it.
- `fans.boost` and `climate.fan_boost` are the firmware over-temperature or over-humidity boost (Lykyn). Devices without that loop report `null`.
- `coach.state` is a short summary: `linked`, `enabled`, or `off`. Detailed claim-code state stays on `GET /cloud`, which may require a login. `last_check_in_age_s` is reserved. Version 1 reports `null` until firmware exposes a last successful telemetry time.
- `health.errors` is an array of short strings. It is `[]` when there is nothing to report. The firmware does not include Wi-Fi SSIDs or addresses here.
- `device.type` values in use: `shrooly_chamber`, `lykyn_chamber`. A new device picks a new `*_chamber` type and keeps the rest of the schema.

## For a new device

1. Advertise `_shroomlabs._tcp` on port 80 with the TXT keys above (`api=1`, `path=/api/status`).
2. Serve `GET /api/status` and `GET /api/status/schema` with the JSON in this document. Leave unused readings and knobs as `null`.
3. Keep the endpoint read-only and free of secrets. Allow CORS for GET.
4. Reuse the shared component when the device is ESPHome-based: `shroom_labs_local_api` in this repository (OpenShrooly `esphome/external_components/shroom_labs_local_api`, copied into lykyn-firmware `external_components/shroom_labs_local_api`). Keep the two copies in sync. The JSON builder in `status_json.cpp` is the schema implementation, and the host test should pass in both repos.

## What this is not

- Not a substitute for Coach or the cloud inbox.
- Not a write API. Do not send setpoints here.
- Not a replacement for Home Assistant or the ESPHome native API.
- Not reachable off the LAN. There is no authentication because the payload is intentionally boring, so do not port-forward it.
