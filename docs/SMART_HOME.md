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

Sign in at `http://<hub-host>:8090/login`. The password is `HUB_ADMIN_PASSWORD`, or the generated value in the hub data file `admin.json`. Scripts can use HTTP Basic `admin:<password>`, same as the chamber. Writes (sign in, sign out) need a CSRF token and must come from this hub's own page.

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

- `docker-compose.yml` gives **both** the hub and the bridge `network_mode: host`.
- The status server listens on `127.0.0.1:8091` only. It does not listen on Wi-Fi or Ethernet.
- The hub reads `http://127.0.0.1:8091/status`. Because both processes share the host network, that loopback address works.
- The sidecar also writes `/shared/status.json` on a compose volume. The hub reads that file if HTTP is down.

Do not publish port 8091. Do not bind the status server to `0.0.0.0`.

## Mac mini notes

This hub is meant to stay on Mike's always-on Mac mini.

Docker Desktop on macOS runs Linux in a VM. `network_mode: host` attaches to that VM, not to the Mac's Wi-Fi or Ethernet. Matter multicast from a container on a Mac is unreliable.

Run the bridge with Node 22 on the Mac, not in Docker:

```bash
cd bridge
npm ci
MATTER_STORAGE_PATH="$HOME/shroom-labs-bridge" HUB_URL=http://127.0.0.1:8090 node src/index.js
```

Run the hub on the Mac as well (or with host networking). Point `HUB_URL` at `http://127.0.0.1:8090` and `BRIDGE_STATUS_URL` at `http://127.0.0.1:8091`. A hub container on Docker Desktop's VM network cannot reach a status server that is bound only to the Mac's loopback.

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
PYTHONPATH=shared:. python -m pytest -q tests/test_smart_home.py tests/test_hub_auth.py tests/test_bridge_status_reachability.py
cd bridge && npm test
```

The Node suite includes a mapping unit test and an integration test that uses matter.js's controller to commission the bridge and read the three sensor attributes.
