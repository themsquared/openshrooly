# USB installer and signed OTA

Shroom Labs flashes the same ESP32-S3 artifacts as [openshrooly.com](https://openshrooly.com): `factory.bin`, `ota.bin`, and an ESP Web Tools `manifest.json` from `grahamsz/openshrooly` releases. Signing is artifact-level (checksums + Ed25519). It is not a new on-device OTA protocol.

The installer lives at [`/install.html`](https://shroomlabs.io/install.html). Chrome or Edge on a computer. Hold BOOT if the serial port does not appear.

## What this ship adds

| Piece | Role |
| --- | --- |
| `community/web/public/install.html` | ESP Web Tools button. Default manifest is grahamsz `latest`. `?manifest=` overrides. |
| `GET /api/firmware/latest` | Manifest, checksum, and signature URLs. `signature_required` is true only when `FIRMWARE_SIGNING_PUB` is set. |
| `POST /api/firmware/verify` | Fail-closed without a public key. With a key, requires `SHA256SUMS` + `SHA256SUMS.sig` and the named `.ota.bin`. |
| `.github/workflows/dev-release.yml` | Writes `SHA256SUMS`. Signs with `FIRMWARE_SIGNING_KEY` when that repo secret exists. |
| `safe_mode` + `improv_serial` | Listed firmware deviations. Recovery after a bad OTA, and USB serial Wi-Fi provisioning. |

The local hub still does not flash firmware. If it ever proxies an `.ota.bin`, it must call `/api/firmware/verify` first.

## Deviations from grahamsz/openshrooly

| Change | Why |
| --- | --- |
| `safe_mode:` in `esphome/openshrooly.yaml` | Recover after a bad OTA without a cable |
| `improv_serial:` | Browser installer can hand the chamber a Wi-Fi network over USB |

Climate, pins, sensors, humidifier, fan, lights, partitions, and the existing `ota: platform: esphome` path stay upstream. Signed checksums do not change how the device applies OTA.

## Secrets and migrations

Optional. USB factory flash works without them (physical possession). OTA verify stays fail-closed until the public key is set.

```
# GitHub Actions (PKCS8 PEM, or base64 of that PEM). Newlines as \n are fine.
# Repo secret: FIRMWARE_SIGNING_KEY

# Worker (matching SPKI public key)
npx wrangler secret put FIRMWARE_SIGNING_PUB
```

Optional Worker vars (defaults point at grahamsz latest):

- `FIRMWARE_MANIFEST_URL`
- `FIRMWARE_CHECKSUMS_URL`
- `FIRMWARE_SIGNATURE_URL`

No D1 SQL. No wrangler route or D1 id changes. Netlify needs no new secret; `/install.html` has a looser CSP for `unpkg.com` and GitHub release downloads.

## How to validate in prod

After a Netlify rebuild of the site (Worker deploy only if you added `FIRMWARE_SIGNING_PUB`):

```bash
# Installer page and CSP for ESP Web Tools
curl -sI https://shroomlabs.io/install.html | grep -i -e HTTP -e content-security
# expect 200 and unpkg.com in script-src / connect-src

curl -s https://shroomlabs.io/install.html | grep -e esp-web-tools -e 192.168.4.1
# expect the unpkg script and the AP URL

# Catalog still links to the installer
curl -s https://shroomlabs.io/ | grep -c install.html
# expect 2 or more

# Latest firmware pointer (grahamsz until we publish our own manifest)
curl -s https://api.shroomlabs.io/api/firmware/latest
# expect manifest_url containing grahamsz/openshrooly and signature_required false
# (true only after FIRMWARE_SIGNING_PUB is set)

# Unsigned OTA is refused when no public key is configured
curl -s -o /tmp/fw.json -w "%{http_code}" -X POST https://api.shroomlabs.io/api/firmware/verify \
  -H "content-type: application/json" \
  -d '{"checksums":"deadbeef  openshrooly.ota.bin","signature":"QQ==","filename":"openshrooly.ota.bin"}'
# expect 400 and {"ok":false,"error":"unsigned firmware rejected"}
```

`curl -sI https://api.shroomlabs.io/health` should still be 200 from earlier ships.

## Hardware checklist

1. Chrome or Edge on a computer. Open `https://shroomlabs.io/install.html`. The Install button appears after the grahamsz (or override) manifest loads.
2. USB-C to the chamber. Hold BOOT if no port is listed. Flash the factory image.
3. After reboot, join `OpenShrooly` and open `http://192.168.4.1/app/`. First-run banner from Ship 5b.
4. Use `/` or the phone captive portal (or Improv over the same USB serial) to join home Wi-Fi.
5. Settings → OTA file upload still accepts a local `.ota.bin` on the LAN. That path is unchanged.
6. If `FIRMWARE_SIGNING_PUB` is set: `POST /api/firmware/verify` with the release `SHA256SUMS` + `.sig` returns `{ ok: true }` for the named OTA file, and 400 without the signature.
7. Safe mode: interrupt power during an OTA once. The chamber should come back on a recovery AP so you can USB-flash again.
8. `?manifest=` still installs from a custom ESP Web Tools manifest (dev builds).

## Tests

```bash
cd community/api && npm test
```

Firmware cases: signed checksums verify, unsigned OTA is refused, ESP32-S3 manifest shape, `/api/firmware/verify` fail-closed without `FIRMWARE_SIGNING_PUB`.
