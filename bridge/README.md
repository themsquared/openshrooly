# Matter bridge sidecar

A Node 22 process next to the Python hub. It reads `GET /api/smart-home/state` and exposes a Matter Bridge so chambers show up in Apple Home and Google Home.

It never talks to a chamber. Device writes stay on the hub.

## Run on the Mac mini (required on macOS)

Docker Desktop host networking needs 4.34 or newer, must be enabled while signed in, does not work with Enhanced Container Isolation, and only carries TCP/UDP. Matter mDNS from a container on a Mac will not work. Run this process with Node on the Mac:

```bash
scripts/macos/run-matter-bridge.sh
```

Or the same command by hand:

```bash
cd bridge
npm ci
MATTER_STORAGE_PATH="$HOME/shroom-labs-bridge" HUB_URL=http://127.0.0.1:8090 node src/index.js
```

To start it at login, copy `scripts/macos/com.shroomlabs.openshrooly-bridge.plist` into `~/Library/LaunchAgents/` and replace the `REPLACE` paths.

Keep `$HOME/shroom-labs-bridge`. It holds the fabric and the pairing identity. Sign in on the hub, then open http://127.0.0.1:8090/smart-home for the QR and the 11-digit code. The status HTTP port is 127.0.0.1:8091 only.

## Docker (Linux only)

`docker compose --profile linux up` starts `bridge` with `network_mode: host` and a `bridge-data` volume. The service uses the `linux` compose profile so a Mac `docker compose up` does not start it. Host networking is required for Matter mDNS.

## Tests

```bash
cd bridge
npm test
```

The commission test starts a fake hub, starts this bridge, then uses matter.js's own controller to pair and read temperature, humidity, and the water contact.
