# Smart Home: Apple Home, Google Home, and Matter

Status: SH-1 is in the repo. It is not deployed and it is not flashed. The chamber firmware does not change.

Agreed path (PR #27): a Matter bridge sidecar next to the local hub. Native Matter on the chamber is deferred.

## What SH-1 does

The Python hub publishes a local state API. A Node 22 `bridge/` process reads that API and exposes a Matter Bridge (aggregator). Each chamber becomes:

| Chamber thing | Matter device type | Apple Home / Google Home |
| --- | --- | --- |
| Temperature | Temperature Sensor `0x0302` | Temperature tile |
| Humidity | Humidity Sensor `0x0307` | Humidity tile |
| Needs water (`water_level` below 15%) | Contact Sensor `0x0015` | Contact tile. Closed means water is ok. Open means add water |

Vendor / product IDs are the CSA test pair `0xFFF1` / `0x8000`. Both apps will say the accessory is uncertified. That is expected until we join the CSA.

The grow light On/Off Light (`0x0100`) is SH-2. The state API already includes `light_on`. The bridge does not expose the light yet.

The bridge talks only to the hub (`GET /api/smart-home/state`). It never opens a chamber URL. Hub writes still go through the hub device client, which must send the chamber admin login after Ship 9.

## How to pair

The pairing code is a secret. It lives on the hub volume / bridge data directory. The hub Smart Home page shows it only after you sign in as `admin`, and only before the first pair. It is not written to logs and is not sent to shroomlabs.io.

Sign in at `http://<hub-host>:8090/login`. The password is `HUB_ADMIN_PASSWORD`, or the generated value in the hub data file `admin.json`. The hub writes a random session secret to `hub.secret` on first run (mode 0600). Do not set `HUB_SECRET` to the old published default. Scripts can use HTTP Basic `admin:<password>`, same as the chamber. Writes (sign in, sign out, add or remove a device, apply a profile, import a profile, sync) need a CSRF token and must come from this hub's own host.

### Once, for Google Home

1. Sign in at the Google Home Developer Console with the Google account the Google Home app uses.
2. Create a project.
3. Add a Matter integration with vendor ID `0xFFF1` and product ID `0x8000`, named Shroom Labs Hub.

Without that project, Google Home will not finish pairing a test-VID bridge.

### Apple Home (iPhone)

1. Open the hub on the LAN, sign in, then open `http://<hub-host>:8090/smart-home`. Leave the QR on screen.
2. Home app: **+**, **Add Accessory**, scan the QR. Or type the 11-digit code.
3. Tap **Add Anyway** at Uncertified Accessory.
4. Pick a room. Each chamber should show temperature, humidity, and water.

### Google Home app

1. If Apple Home already paired this hub, open the bridge in Apple Home, then **Turn On Pairing Mode**, and use that code in Google Home.
2. If this is the first pair, Google Home: **Devices**, **+ Add**, **Matter-enabled device**, scan the QR on the hub page.
3. Accept the uncertified-device notice and pick a room. The same chambers appear. The bridge itself may show as a Control Bridge.

Matter keeps the first commissioning window open until a fabric joins, then it closes. A second app needs pairing mode opened again. SH-3 will add a **Pair another app** button on the hub page.

## What needs host networking

Matter advertises over mDNS (IPv4 and IPv6 multicast) on UDP port 5540. A Docker port map like `8090:8090` is not enough for the bridge.

On Linux (a Pi or a Linux box):

- `docker compose --profile linux up` starts **both** the hub and the bridge with `network_mode: host`.
- The `bridge` service is on the `linux` compose profile. It is not started by a plain `docker compose up`.
- The status server listens on `127.0.0.1:8091` only. It does not listen on Wi-Fi or Ethernet.
- The hub reads `http://127.0.0.1:8091/status`. Because both processes share the host network, that loopback address works.
- The sidecar also writes `/shared/status.json` on a compose volume. The hub reads that file if HTTP is down.

Do not publish port 8091. Do not bind the status server to every interface.

## Mac mini notes

This hub is meant to stay on Mike's always-on Mac mini.

Docker Desktop on macOS runs Linux in a VM. Host networking needs Docker Desktop 4.34 or newer, must be turned on while you are signed in, and does not work with Enhanced Container Isolation. Even then it only carries TCP and UDP. Matter mDNS is multicast, so a bridge container on a Mac will not be found by Apple Home or Google Home.

The supported macOS path is:

1. Run the Matter bridge with Node on the Mac (not in Docker).
2. Run the hub on the Mac as well, or in Docker with a published port and a bind-mounted status file.

Native bridge:

```bash
scripts/macos/run-matter-bridge.sh
```

That script stores the fabric in `$HOME/shroom-labs-bridge` and writes `$HOME/shroom-labs-bridge/status.json`. To start it at login, copy `scripts/macos/com.shroomlabs.openshrooly-bridge.plist`, replace the `REPLACE` paths, then:

```bash
cp scripts/macos/com.shroomlabs.openshrooly-bridge.plist ~/Library/LaunchAgents/
# edit the copy so the repo path and home path are real
launchctl load ~/Library/LaunchAgents/com.shroomlabs.openshrooly-bridge.plist
```

Native hub (same Mac, loopback status HTTP works):

```bash
scripts/macos/run-hub.sh
```

Hub in Docker on a Mac, bridge still native:

```bash
mkdir -p "$HOME/shroom-labs-bridge"
touch "$HOME/shroom-labs-bridge/status.json"
docker compose -f docker-compose.yml -f docker-compose.macos.yml up hub
```

Do not start the compose `bridge` service on a Mac. A hub container on Docker Desktop's VM network cannot reach a status server that is bound only to the Mac's loopback, so the macos overlay reads the status file instead.

Keep `$HOME/shroom-labs-bridge`. That directory is the fabric. Deleting it unpairs every home app.

The Mac and the iPhone / Google Home speaker must be on the same LAN. Client isolation on the Wi-Fi AP will block pairing.

## Hub API (local)

`GET /api/smart-home/state` returns:

```json
{
  "chambers": [
    {
      "id": 1,
      "name": "Kitchen",
      "mac": null,
      "online": true,
      "temperature_c": 22.1,
      "humidity_pct": 87.6,
      "water_pct": 42.0,
      "needs_water": false,
      "light_on": true
    }
  ],
  "needs_water_threshold_pct": 15
}
```

`needs_water` is true when `water_pct` is below 15, the same empty / S0 band as the chamber banner and `docs/ALERTS.md`. Offline chambers keep last readings and set `needs_water` / `light_on` to null.

`GET /api/smart-home/pairing` and `GET /smart-home` need the hub admin login. They return no QR or manual code until you sign in, and they hide both after the first pair. Pairing is 503 when the bridge is down. The Smart Home page uses it for the QR.

## Ships

| Ship | Scope | Status |
| --- | --- | --- |
| SH-1 | Hub state API, read-only Matter bridge, commission flow, hub QR page, CI pair+read | This change |
| SH-2 | Grow light On/Off Light. Writes go `POST /api/smart-home/light` then the hub device client (admin login + CSRF on the chamber) | Not started |
| SH-3 | Pair another app, reset fabric, show paired fabrics | Not started |
| SH-4 | Light override until the next schedule tick | Not started |
| SH-5 | Live add/remove chambers, offline `Reachable=false`, restart without re-pair | Partial: new chambers are added on poll. Remove and restart proof are later |

Native Matter on the chamber, HAP-python, and Google cloud-to-cloud stay out of scope unless we ask for them. They are documented in PR #27.

## Tests

```bash
PYTHONPATH=shared:. python -m pytest -q tests/test_smart_home.py tests/test_hub_auth.py tests/test_bridge_status_reachability.py tests/test_hub_targets.py
cd bridge && npm test
```

The Node suite includes a mapping unit test and an integration test that uses matter.js's controller to commission the bridge and read the three sensor attributes.
