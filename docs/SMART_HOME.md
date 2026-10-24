# Smart Home: Apple Home, Google Home and Matter

Status: research and design only. Nothing here is deployed or flashed.
Researched 2026-10-24 against the repo at `6698a31` (post Ship 8) and the primary sources linked at the end.

## Short answer

| Question | Verdict |
| --- | --- |
| Q1. Native Matter on the Shrooly | **No, not now.** It doesn't fit in the current firmware slot, it needs a framework switch and a new partition table (a USB reflash of every unit), and it would show up as an uncertified test device anyway. |
| Q2. Matter bridge on the local hub | **Yes. This is the recommended path.** One QR code pairs the hub to Apple Home, and the same bridge can then be shared to Google Home. Each chamber shows up as a temperature sensor, a humidity sensor, a grow light and a "needs water" sensor. Everything stays local. |
| Q3. Alternatives | HomeKit only (HAP) is the best fallback if Mike only uses Apple. Google cloud-to-cloud works but needs an OAuth server, a Google project, and certification to go beyond Mike's own account. Neither beats one Matter bridge that covers both. |
| Q4. Plan | Add a small Node sidecar to the hub (matter.js) and ship it in five small steps (SH-1 to SH-5 below). The first step is read-only sensors. |

---

## What we have today (repo facts)

**The device**
- `esphome/openshrooly.yaml`: ESP32-S3 (`esp32-s3-devkitc-1`) built with the **Arduino** framework. It runs LVGL, `api`, `ota: esphome`, `signed_update`, `web_server` and `improv_serial`.
- The chip has 16 MB of flash (RECOVERY.md backs up 16 MB), but the build uses ESPHome's **default 4 MB layout**. From the built `partitions.csv`, `app0` and `app1` are each `0x1C0000` (1,835,008 B), plus `nvs` `0x60000`.
- The last builds use **90.3% of the app slot**: 1,656,319 of 1,835,008 bytes, leaving about 175 KB free.
- `docs/device-web.md` says the partitions stay upstream.

**What the device exposes, and what the hub already reads or writes**
- Sensors: `temperature`, `humidity`, `water_level_percent`.
- Light: `white_led` (monochromatic) plus the RGB strip. Both are driven by the sunrise/duration schedule.
- Switch: `humidifier_fan`, which the humidity hysteresis loop drives.
- Binary sensors: `humidifier_on`, `grow_lights_on`, `air_exchange_on`.

**The hub**
- `hub/` is Python 3.12-slim with FastAPI and uvicorn on port 8090, and stores data in SQLite.
- It discovers chambers over mDNS (`_esphomelib._tcp`). It polls and writes the ESPHome web_server REST API through `shared/openshrooly_lib/device.py` (`get_entity`, `set_number`, `set_switch`).
- It runs in Docker on a Raspberry Pi. `docker-compose.yml` uses a port mapping, not host networking.
- **There is no Node runtime.**

**The cloud link**
- `shroom_labs_cloud` is an opt-in, outbound-only mTLS websocket to `link.shroomlabs.io` that already accepts cloud commands. This is what a Google cloud-to-cloud integration would reuse.

---

## Q1. Native Matter over Wi-Fi on the Shrooly

### Does ESPHome support Matter today?
**No.** ESPHome has no official Matter component. The feature request (esphome/feature-requests#1430) is still open after five years.

The only option is a community external component, **DavidvtWout/esphome-matter**. Its README calls it an "experimental preview" with an unstable YAML interface. It has these limits:
- It needs the **ESP-IDF framework**. The Arduino framework is not supported, and we are on Arduino.
- It needs the PlatformIO toolchain.
- BLE commissioning is broken.
- It uses **dev certificates**. The maintainer has only verified Home Assistant and python-matter-server, not Apple Home or Google Home.

### Flash and RAM
- **Flash:** esp-matter's own `light` example uses two **1.875 MB** OTA slots (`0x1E0000`). It also adds `esp_secure_cert`, `nvs_keys` and `fctry` partitions.
  - The Arduino-ESP32 Matter library tells you to pick **"Huge APP (3 MB No OTA)"** for every Matter example.
  - Our slot is 1.75 MB and already 90% full of LVGL, the web UI, the API and TLS. Matter alone is bigger than our free space, and probably bigger than the whole slot.
- **RAM:** the ESP32-S3 has 512 KB of SRAM. In esp-matter#1171, developers running Matter with LVGL on an S3 report the CHIP task using about 40 KB of internal RAM. They needed PSRAM, or had to turn BLE off after setup, to make it fit.
  - That would sit on top of our LVGL screen, the SHT4x sensor, the RP2040 SWD programmer and the optional TLS cloud client (22–42 KB).

### Does it fit our layout?
**No, not without a new partition table.**
- The chip has room: it has 16 MB, and we use a 4 MB map.
- But changing the partition table **can't be done safely over OTA**. OTA only rewrites an app slot, not the table or the bootloader.
- So every chamber would need a **USB reflash** (RECOVERY.md flow). That breaks the "update from the web page" story we just shipped.
- It also means moving from Arduino to ESP-IDF, which touches every custom component: `shrooly_touch`, `swd_programmer`, `web_server`, `signed_update` and `shroom_labs_cloud`.

### Certification, DAC and the warnings
- Every Matter device carries a Device Attestation Certificate (DAC → PAI → PAA).
- Without CSA membership, a CSA Vendor ID and certification, you can only use **test VIDs `0xFFF1`–`0xFFF4`** with test DACs. CSA membership and testing cost real money.
- **Apple Home** pairs test devices behind an **"Uncertified Accessory"** prompt, and you tap **Add Anyway**.
- **Google Home** pairs a test-VID device only if the signed-in Google account owns a **Google Home Developer Console** project with a Matter integration for that exact VID/PID (for example `0xFFF1`/`0x8000`). Google says test VIDs can be used for basic commissioning and control, but not for the Test, Field Trial or OTA phases.
- These warnings would apply exactly the same to the hub bridge, so native firmware buys nothing here.

### Upstream and signed OTA
- It would fork us away from upstream OpenShrooly (Arduino, default partitions).
- It would also force a new signed-OTA story, because the slot sizes and offsets change. Existing units on 1.0.3-sl.1 could not reach a Matter build over OTA at all.
- The firmware executor also owns the device for the Ship 9 lockdown right now. This is a separate reason not to touch it.

**Verdict on Q1: no.**
- Don't put Matter on the chamber now.
- Revisit only if (a) ESPHome ships an official Matter component, (b) we have already moved to ESP-IDF for other reasons, and (c) we accept a one-time USB reflash to a 16 MB partition map.
- Even then, it gives the same uncertified prompts as the hub bridge.

---

## Q2. A Matter bridge on the hub

A Matter **bridge** is one Matter node. Its Aggregator endpoint (`0x000E`) lists a set of **Bridged Node** endpoints (`0x0013`), one per real device, and each one carries normal device types.

Both Apple Home and Google Home support bridges:
- Apple lists "bridges" as a supported Matter category.
- Google says devices behind a bridge "appear as normal". The bridge itself shows up as an inert Control Bridge.

The matter.js README lists Apple Home and Google Home as "Fully working".

### Mapping the chamber to Matter types (all certifiable in Matter 1.3/1.4)

| Chamber thing | Matter device type (ID) | Cluster(s) | Apple Home | Google Home |
| --- | --- | --- | --- | --- |
| Temperature (`temperature`) | Temperature Sensor `0x0302` | Temperature Measurement `0x0402` | Supported sensor. Temperature tile, usable in automations | Supported (Sensor). Shown in the app; Assistant can read it |
| Humidity (`humidity`) | Humidity Sensor `0x0307` | Relative Humidity Measurement `0x0405` | Supported sensor. Humidity tile | Supported (Sensor) |
| Grow light (`white_led` / `grow_lights_on`) | On/Off Light `0x0100` (or Dimmable Light `0x0101` later) | On/Off `0x0006` (+ Level Control `0x0008`) | Light tile, Siri "turn off the grow light" | Light, voice and app control |
| Needs water (`water_level_percent` below a threshold) | **Contact Sensor `0x0015`** | Boolean State `0x0045` | Supported sensor ("Open"/"Closed"). Can notify and trigger automations | Supported (Sensor) |
| Humidifier (`humidifier_fan` / `humidifier_on`) | No humidifier type in 1.3/1.4. *Humidity Conditioner* `0x007D` only appears in **Matter 1.7**. Closest options: **Fan `0x002B`** or **On/Off Plug-in Unit `0x010A`** | Fan Control `0x0202` / On/Off | Fan tile | Fan; a plug can be re-typed by the user |

Notes on the mapping:
- **Water Leak Detector** `0x0043` exists from Matter 1.3, but it is **not** on Google's supported list or Apple's published Matter categories. A leak alarm is also the wrong meaning for "refill me".
  - Contact Sensor is on both lists. Use "closed = OK, open = needs water", named "Shrooly water".
- **Humidifier control is a trap.** The firmware already runs a hysteresis loop (`target_humidity`, Δ on/off, min on/off times).
  - A Home "on/off" would fight that loop, and it can't stay on safely while the tank is empty.
  - v1 should therefore not expose humidifier control. If we add it later, map it to a status-only Fan, or gate it behind a hub setting that defaults to off.
- **The grow light runs on a schedule.** A manual on/off from Home should be documented as "override until the next scheduled change", or we add a hub-side override flag.
  - The hub client also needs a small `set_light()` (`POST /light/white_led/turn_on|turn_off`) because today it only has `set_number` and `set_switch`.

### Pairing UX
- The bridge has **one** setup code: an 11-digit manual code plus an `MT:` QR payload.
  - The code is random per hub, generated on first run and saved in the hub volume. Never use the well-known test passcode `20202021`.
  - The hub's local page shows it as a QR and as a number.
- **Apple:** Home app → **+** → **Add Accessory** → scan the QR → **Add Anyway** at the "Uncertified Accessory" prompt → pick a room → each chamber's tiles appear.
- **Google:** pair the *same* bridge as a second admin (multi-admin), using either route:
  - In Apple Home: open the bridge's settings → **Turn On Pairing Mode**, which gives a new one-time code. Then in Google Home: **Devices** → **+ Add** → **Matter-enabled device** → enter or scan that code.
  - Or use a **Pair another app** button on the hub page that opens a new commissioning window and shows a fresh QR. matter.js supports opening a commissioning window; the exact API gets verified in SH-2.
- **Google prerequisites:**
  - Mike's Google account needs a free **Google Home Developer Console** project with one Matter integration for VID `0xFFF1`, PID `0x8000`. Our bridge must advertise exactly that pair.
  - Google Home also needs a Google Matter hub in the home (Nest speaker or display, or Google TV Streamer).
- **Apple prerequisites:** pairing and local control work from an iPhone on iOS 18+. A HomePod or Apple TV is needed for remote access and automations.

### Multiple devices
- Each chamber the hub knows about becomes one Bridged Node, with the chamber name as its label and the device MAC as its unique ID.
- Adding a chamber in the hub adds endpoints live (dynamic endpoints), so there is **no re-pairing**. Removing a chamber removes its endpoints.

### Security
- **Local only.** Matter runs on the LAN over IPv6 and mDNS.
  - Every controller session uses PASE during pairing and CASE afterwards, with fabric certificates issued by Apple or Google.
  - No Shroom Labs cloud and no new inbound internet ports.
- **The setup code is a secret.**
  - It is only shown on the hub's local UI.
  - It is not written to logs and not sent to shroomlabs.io.
  - It can be regenerated, which needs a factory reset of the bridge fabric.
- **The commissioning window closes by itself.** Matter limits it to 15 minutes. "Pair another app" re-opens it on purpose.
- The bridge only calls the hub's own device client, so it can't do anything the hub can't already do. Writes are limited to light on/off in v1.
- **Docker:** Matter needs mDNS and IPv6 multicast, so the sidecar must run with `network_mode: host`. A port map like today's `8090:8090` isn't enough.
- **Ship 9:** the bridge inherits whatever chamber auth Ship 9 adds to the REST or native API (web_server auth or API encryption). It must use the hub's client, not talk to chambers itself.

### Does matter.js fit the hub?
**Yes, as a sidecar.**
- matter.js packages support every Node.js LTS from **20.x** on. The hub image is Python-only, so we add a small `node:22-slim` service.
- It reads chamber state from the hub's `/api/devices`, or from a new local-only `/api/smart-home/state`, and calls the hub for writes. The Python hub stays the single source of truth.
- A Raspberry Pi 4 or 5 runs Node 22 and matter.js comfortably. matter.js powers Matterbridge and the Home Assistant Matter Hub add-on on the same class of hardware.
- **Why not Python?** python-matter-server and the Home Assistant Matter integration are **controllers**: they pair *to* devices. They can't expose our chambers *as* devices. There is no maintained Python Matter device or bridge library.

---

## Q3. Alternatives

### A. HomeKit only (HAP)
- **HAP-python** works inside the existing Python hub, so there is no new runtime. HAP-NodeJS needs Node.
- HAP has richer native types than Matter 1.4:
  - `TemperatureSensor` and `HumiditySensor`.
  - `Lightbulb`.
  - `HumidifierDehumidifier`, with `CurrentRelativeHumidity`, a humidity threshold and **`WaterLevel`**. This maps to the Shrooly almost exactly.
- **Pairing:** Home app → Add Accessory → scan the HAP setup code. It also shows an uncertified prompt.
- **Home Assistant HomeKit Bridge:** only useful if Mike runs Home Assistant. It would need the chambers in Home Assistant first, via the ESPHome integration.
  - It supports humidifier accessories with a `linked_humidity_sensor`, and bridge mode for many entities.
  - It makes Home Assistant a hard dependency, so it's a fallback, not our product path.
- **Cost:** Apple only. Google Home gets nothing.

### B. Google Home cloud-to-cloud from shroomlabs.io
To build it we would need:
- A Google Home Developer Console project.
- An **OAuth 2.0 authorization-code** server on `api.shroomlabs.io` for account linking: authorize plus token endpoints, refresh tokens, and revocation.
- A fulfillment webhook that handles `SYNC`, `QUERY`, `EXECUTE` and `DISCONNECT`.
- HomeGraph **Report State** and **Request Sync**, which need a Google service-account key as a Worker secret.
- Commands sent down through the existing `shroom_labs_cloud` link.

Limits:
- Mike's own account can use it in testing.
- To let other growers link it, it has to pass the Google Home Test Suite and certification and launch review.
- It only works for chambers with the opt-in cloud link, and when the internet and our Worker are up.
- It gives Google only. Apple has no cloud-to-cloud equivalent.

### Comparison

| | Matter bridge on hub (rec.) | HomeKit (HAP) on hub | Google cloud-to-cloud | Native Matter firmware |
| --- | --- | --- | --- | --- |
| Covers | Apple + Google (+ Alexa, SmartThings, HA) | Apple only | Google only | Apple + Google |
| Effort | Medium: Node sidecar plus about 5 ships | Low–medium | High: OAuth, webhook, HomeGraph, certification | Very high: framework switch, partitions, USB reflash |
| Local / offline | Yes | Yes | No (cloud) | Yes |
| Needs the hub | Yes | Yes | No (needs cloud link) | No |
| Firmware change | None | None | None (reuses link) | Large |
| Uncertified prompt | Yes (Add Anyway; Google console entry) | Yes | No (account link) | Yes |
| Humidifier fidelity | Weak (no type until 1.7) | Best (native humidifier + water level) | Good (`HUMIDIFIER` type) | Weak |
| What Mike must do | Scan one QR; one-time Google console entry | Scan one code | Link account in Google Home | Reflash every chamber by USB |

---

## Q4. Recommendation and plan

**Build a matter.js bridge as a sidecar to the local hub.**
- It reaches both of Mike's ecosystems with one pairing and one code.
- It stays local and needs no firmware changes, so it doesn't conflict with the Ship 9 lockdown.
- It doesn't touch DNS or Cloudflare.

Keep HAP-python as a later add-on only if the Apple humidifier tile turns out to matter.

Each ship is one PR, tested and validated, then retested on the real hub.

**SH-1 · Hub state API (Python only)**
- Add `GET /api/smart-home/state`, local only. For each chamber it returns `{id, name, mac, online, temperature_c, humidity_pct, water_pct, needs_water, light_on}`.
- Add `POST /api/smart-home/light` (on/off) and `set_light()` in `device.py`.
- **Tests:** pytest for mapping, the `needs_water` threshold and offline handling. Retest against a live chamber, read-only first.

**SH-2 · matter.js sidecar, read-only**
- Add `bridge/` (Node 22, `@matter/main`) and a `docker-compose` service with `network_mode: host`.
- The bridge has an Aggregator plus one Bridged Node per chamber, carrying a Temperature Sensor, a Humidity Sensor and a Contact Sensor ("needs water").
- VID `0xFFF1` / PID `0x8000`. A random passcode and discriminator are saved in the volume.
- **Tests:**
  - Unit tests for the mapping.
  - Pair with `chip-tool` or the matter.js shell, and read the attributes.
  - Then pair in Apple Home on Mike's iPhone and compare the values with the hub page.

**SH-3 · Hub "Smart Home" page**
- Show the QR plus the manual code (only on the LAN UI), pairing status (fabrics paired: Apple, Google) and a **Pair another app** button.
- Add a **Reset smart home** action, behind a confirm.
- **Tests:**
  - The code is never in the logs.
  - The window closes after 15 minutes.
  - A second fabric pairs successfully.

**SH-4 · Grow light control**
- Add an On/Off Light endpoint wired to `POST /api/smart-home/light`, with "override until next schedule" semantics shown in the hub UI.
- **Tests:**
  - Toggle from Apple Home and from Google Home, and check the chamber light.
  - Check that the schedule resumes on the next tick.
  - Check that state syncs back within one poll.

**SH-5 · Multi-chamber and resilience**
- Add and remove chambers live. Mark offline chambers as unreachable (Bridged Device Basic Information `Reachable=false`).
- Restart the bridge and check that fabrics survive.
- **Tests:** two chambers, unplug one, reboot the Pi, and confirm both apps recover without re-pairing.

**Later, only if asked**
- A humidifier status endpoint.
- HAP-python for an Apple-native humidifier tile.
- Google cloud-to-cloud for growers without a hub.

### Exactly what Mike does at the end

**Once, for Google:**
1. Sign in at console.home.google.com with the Google account his Google Home uses.
2. Create a project and add a Matter integration with **VID `0xFFF1`, PID `0x8000`**, named "Shroom Labs Hub".

**iPhone (Apple Home):**
1. Open the hub page → **Smart Home** and leave the QR on screen.
2. In the Home app: **+** → **Add Accessory** → scan the QR.
3. Tap **Add Anyway** at "Uncertified Accessory".
4. Choose a room and tap through the tiles. Each chamber shows Temperature, Humidity, "Water" (contact) and, after SH-4, "Grow Light".

**Google Home app:**
1. On the hub page, tap **Pair another app**. A fresh QR appears.
2. In Google Home: **Devices** → **+ Add** → **Matter-enabled device** → scan it.
3. Accept the uncertified-device notice and pick a room. The same chambers appear, and the bridge itself shows as an inert "Control Bridge".

(Other route for step 1: in Apple Home → bridge settings → **Turn On Pairing Mode**, then enter that code in Google Home.)

---

## Sources
- ESPHome Matter feature request: https://github.com/esphome/feature-requests/issues/1430
- esphome-matter (community, experimental): https://github.com/DavidvtWout/esphome-matter and commissioning notes https://github.com/DavidvtWout/esphome-matter/discussions/44
- Espressif esp-matter: https://github.com/espressif/esp-matter, light partitions https://github.com/espressif/esp-matter/blob/main/examples/light/partitions.csv, requirements discussion https://github.com/espressif/esp-matter/issues/1171
- Arduino-ESP32 Matter library (Huge APP 3 MB requirement): https://docs.espressif.com/projects/arduino-esp32/en/latest/matter/matter.html
- ESP32-S3 datasheet (512 KB SRAM): https://documentation.espressif.com/esp32-s3_datasheet_en.pdf
- Matter device type IDs by spec version: https://project-chip.github.io/connectedhomeip-doc/ids_and_codes/spec_device_types.html
- Matter 1.4 Device Library: https://csa-iot.org/wp-content/uploads/2024/11/23-27351-005_matter-1-4-device-library-specification.pdf
- matter.js (Node 20+ LTS, ecosystem compatibility, certification note): https://github.com/matter-js/matter.js
- Google Home supported Matter device types and bridges: https://developers.home.google.com/matter/supported-devices
- Google test VIDs and Developer Console: https://developers.home.google.com/matter/test
- Google cloud-to-cloud: https://developers.home.google.com/cloud-to-cloud/primer/account-linking and https://developers.home.google.com/cloud-to-cloud/checklist
- Apple Matter categories: https://developer.apple.com/apple-home/works-with-apple-home/ and https://support.apple.com/en-us/102135
- Apple Matter in iOS: https://developer.apple.com/apple-home/matter/
- Home Assistant Matter (controller, not bridge): https://www.home-assistant.io/integrations/matter/
- Home Assistant HomeKit Bridge: https://www.home-assistant.io/integrations/homekit/
- HAP-python: https://github.com/ikalchev/HAP-python
