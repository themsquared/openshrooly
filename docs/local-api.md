# Local discovery and status API

Every Shroom Labs chamber (Shrooly, Lykyn, and later types) advertises itself on the LAN
and serves the same read-only status document. In-network tools such as Muse home link
use this to find a chamber and report on it. The grower, the site, Coach, and Muse all
see one model: a stage plus four settings. How a given chamber hits those settings is
firmware work, not part of this contract.

This is the companion to `docs/device-ui-standard.md` (the shared stage and four knobs).
The names and units here match that layer. Fan is the fresh-air knob: speed plus how
often and how long the box airs out.

## Discovery

mDNS service: `_shroomlabs._tcp` on port 80.

TXT records:

- `type`: `shrooly_chamber` or `lykyn_chamber` (same values the cloud already uses)
- `model`: short model string, for example `OpenShrooly` or `Lykyn`
- `fw`: firmware version
- `api`: schema version, currently `1`
- `path`: `/api/status`

Existing ESPHome (`_esphomelib._tcp`) and HTTP (`_http._tcp`) advertisements stay as they are.

Example:

```
avahi-browse -r _shroomlabs._tcp
curl -sS http://lykyn.local/api/status
curl -sS http://lykyn.local/api/status/schema
```

## Endpoints

- `GET /api/status` returns application/json. Versioned, read-only snapshot.
- `GET /api/status/schema` returns a short description of the document: units, stage
  names, chamber types, and the top-level field list.
- `OPTIONS` on either path is allowed (CORS).
- Any other method returns 405.

The document is open on the LAN even when the on-device UI or entity REST is
passworded. It never includes secrets, Wi-Fi credentials, MAC addresses, claim
codes, or customer names.

CORS is `Access-Control-Allow-Origin: *`.

## Units

Light mix is RGBA on a 0-100 scale, integers. `r`, `g`, and `b` are the color
channels. `a` is the white channel, not opacity. This matches the 0-100 light mix
in the device UI standard.

Shrooly's white entity is stored as lux (0-4000). The API maps that onto 0-100
with the same curve the site uses (`whiteLuxToPercent` in profile-schema.js):
0-92 lux is linear to 0-20%; above that, percent = (lux / 0.02307) ^ (1/2.768),
capped at 100. 4000 lux is about 78%. The raw lux value is also in `detail.white_lux`
on Shrooly only. Lykyn already stores white as 0-100, so no conversion is applied.

Temperature is Celsius. Humidity, fan speed, and light brightness are percent.
Fan cycle timing is `every_min` (minutes between airings) and `run_s` (seconds
the fans run each cycle).

Missing values are JSON `null`. Keys are always present, so a client can rely on
the shape.

## Document shape

```json
{
  "api_version": 1,
  "chamber_name": "Kitchen Lykyn",
  "chamber_type": "lykyn_chamber",
  "growing": {
    "id": "black-oyster",
    "name": "Black Oyster",
    "image_url": "https://shroomlabs.io/img/species/species-oyster-640.webp"
  },
  "stage": {
    "name": "Colonization",
    "native": "Colonization"
  },
  "temperature": {
    "target_c": 24.0,
    "tolerance_c": 2.0,
    "actual_c": 21.4,
    "age_ms": 800
  },
  "humidity": {
    "target_pct": 90.0,
    "tolerance_pct": 3.0,
    "actual_pct": 87.2,
    "age_ms": 800
  },
  "fan": {
    "speed_pct": 33,
    "actual_speed_pct": 0,
    "every_min": 30,
    "run_s": 60
  },
  "light": {
    "on": false,
    "enabled": true,
    "rgba": { "r": 0, "g": 0, "b": 80, "a": 20 },
    "sunrise_hour": 8,
    "hours": 12,
    "brightness_pct": 60
  },
  "detail": {},
  "health": {}
}
```

### Top-level fields

- `chamber_name`: the user-facing name (ESPHome friendly name, else the hostname).
- `chamber_type`: `shrooly_chamber` or `lykyn_chamber`.
- `growing.id`: profile id (for example `black-oyster`). Null until the cloud
  inbox includes `profile_id` (see below).
- `growing.name`: display name (for example `Black Oyster`).
- `growing.image_url`: public https image on shroomlabs.io. Null if unknown.
- `stage.name`: one of `Colonization`, `Pinning`, `Fruiting`, `Custom`. Null when
  the chamber is in a native-only state such as Idle or Harvest.
- `stage.native`: the firmware's own stage string. Shrooly colonization is
  `Colonizing`; the canonical name is still `Colonization`.
- `temperature` / `humidity`: `target_*`, `tolerance_*`, `actual_*`, and `age_ms`
  of the last good reading.
- `fan.speed_pct`: the fresh-air speed setpoint, 0-100.
- `fan.actual_speed_pct`: what the fans are doing now. On Lykyn this is the
  higher of the inlet and outlet levels. On Shrooly it is the setpoint while a
  cycle is running, otherwise 0.
- `fan.every_min` / `fan.run_s`: the fresh-air cycle.
- `light.on` / `light.enabled`: whether the schedule currently has the lights on,
  and whether the light output is enabled at all.
- `light.rgba`: the mix, 0-100, `a` = white.
- `light.sunrise_hour` / `light.hours` / `light.brightness_pct`: schedule and
  overall brightness. Brightness is omitted as null on chambers that have no
  separate brightness knob (Shrooly).
- `detail`: mechanism only. Coach and Muse should not need it. Includes model,
  firmware, uptime, per-fan levels, fan boost, humidifier/mister state, climate
  mode, coach link flags, wifi RSSI, and (on Shrooly) raw `white_lux`.
- `health`: `sensor_stale`, `wifi_connected`, and `errors` (an array of strings).

## Grow identity

When a grow is applied from the cloud inbox, firmware stores the profile id
(when present), the display name, and the image URL in NVS so they survive a
reboot and a temporary unlink. The same fields are used if a later local apply
path writes them.

The inbox already sends `grow_name`, `grow_url`, and `grow_image` (see
`community/api/src/chamber-grow.js`). It does not yet send `profile_id`. Needed
cloud change, not done in this firmware work: add `profile_id` to the object
`chamberGrow()` returns, and include that key in the inbox body. Until that
ships, `growing.id` stays null even when the name and image are present.

## What this is not

This API does not accept writes. Setpoints still go through the on-device page,
the cloud, or ESPHome's own (often passworded) entity REST.

`GET /cloud` and `GET /grow` remain cloud-link helpers. They are not this
status document. `/cloud` can include a claim code and should be treated as
sensitive.

Lykyn still has a compact `Status JSON` text sensor at
`GET /text_sensor/Status%20JSON`. That blob is unversioned, sits behind basic
auth on private builds, and is not the contract in-network tools should use.
