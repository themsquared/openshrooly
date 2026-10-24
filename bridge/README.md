# Matter bridge sidecar

A Node 22 process next to the Python hub. It reads `GET /api/smart-home/state` and exposes a Matter Bridge so chambers show up in Apple Home and Google Home.

It never talks to a chamber. Device writes stay on the hub.

## Run on the Mac mini (recommended)

Docker Desktop on macOS does not give a container the Mac's multicast or IPv6 the way Linux host networking does. Run this process on the Mac itself:

```bash
cd bridge
npm ci
MATTER_STORAGE_PATH="$HOME/shroom-labs-bridge" HUB_URL=http://127.0.0.1:8090 node src/index.js
```

Keep that directory. It holds the fabric and the pairing identity. Open the hub at http://127.0.0.1:8090/smart-home for the QR and the 11-digit code.

## Docker (Linux)

`docker-compose.yml` starts `bridge` with `network_mode: host` and a `bridge-data` volume. Host networking is required for Matter mDNS.

## Tests

```bash
cd bridge
npm test
```

The commission test starts a fake hub, starts this bridge, then uses matter.js's own controller to pair and read temperature, humidity, and the water contact.
