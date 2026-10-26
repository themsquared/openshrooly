# USB installer and signed updates

OpenShrooly releases from Shroom Labs are signed with one Ed25519 key. The device and the
USB installer both refuse anything that does not carry a valid signature from that key.

| Where | URL |
| --- | --- |
| USB installer page | https://shroomlabs.io/install.html |
| Release info (signed) | https://shroomlabs.io/firmware/stable/manifest.json |
| Release images | https://shroomlabs.io/firmware/stable/openshrooly-<version>.ota.bin and `.factory.bin` |

Releases are static files on the Netlify site, not in this repo and not in R2.

## Trust path

1. `scripts/sign_release.mjs` signs a text block that names the product, channel, version,
   size, SHA-256 and exact download URL:

   ```
   openshrooly-release-v1
   product=openshrooly        (openshrooly-usb for the factory image)
   channel=stable
   version=1.0.3-sl.1
   size=<bytes>
   sha256=<hex>
   url=https://shroomlabs.io/firmware/stable/openshrooly-1.0.3-sl.1.ota.bin
   ```

   The Wi-Fi and USB images use different product names, so one signature can never be
   replayed for the other image.
2. The private key lives only on the release machine (`/workspace/secrets/` on the build box).
   The signer refuses a key that sits inside the repo, and refuses a key whose public half
   does not match the one compiled into the device.
3. The public key is compiled into the firmware (`esphome/components/updates.yaml`) and into
   `community/web/public/js/install.js`. A test checks they match.

### On the device (`esphome/external_components/signed_update`)

- Nothing is checked or downloaded until someone presses **Check for updates** in the
  device's Settings. There is no timer and no check at boot.
- The release info is fetched over HTTPS from `https://shroomlabs.io/firmware/stable/` only,
  with the certificate checked against the built-in CA bundle. Redirects are not followed.
- The signature is checked (Monocypher Ed25519, strict: non-canonical `S` is refused) before
  the version is offered, and again when **Install** is pressed.
- Older versions are refused unless **Allow older versions** is on. That switch turns itself
  off at every restart.
- The image is streamed into the spare app slot while SHA-256 is computed. The boot slot is
  switched only if the size and hash match the signed values. Any failure aborts the write and
  the device stays on its current version.
- If a new image fails to boot, the bootloader returns to the previous one (app rollback plus
  `safe_mode`, which marks a new image good after it has run for a minute). The Arduino core
  would otherwise mark the image good as it starts, so `signed_update` overrides
  `verifyRollbackLater()`; without that override rollback never happens. Tested on hardware with
  an image that restarts before it is confirmed: the Shrooly came back on the previous version
  and said "The last update did not start correctly, so this Shrooly went back to version X."
- During that first minute an install is refused with "Your Shrooly restarted less than a minute
  ago and is still checking itself. Try again in a minute." The LAN `/update` page fails the same
  way in that window.

Plain messages the device shows include "You have the latest version (1.0.3-sl.1).",
"Could not reach shroomlabs.io. Check the Wi-Fi connection and try again.", and "This update
failed the safety check and was not installed. Your Shrooly is still on version X."

### USB installer (`community/web/public/install.html`, `js/install.js`)

- ESP Web Tools 10.4.0 is served from this site (`public/vendor/esp-web-tools-10.4.0/`,
  Apache-2.0, unchanged). The page CSP allows scripts from this site only.
- The page reads `/firmware/stable/manifest.json`, checks the `usb` entry's Ed25519 signature
  with WebCrypto, downloads the factory image, checks size and SHA-256, and gives ESP Web Tools
  those checked bytes. If any step fails the Install button never appears.
- Browsers without WebCrypto Ed25519 are told to update; the page does not fall back to
  installing without a check.

### Install from a file (signed, from 1.0.3-sl.2)

The device's own **Install from a file on this computer** upload (and the same upload on the
setup network) only installs `openshrooly-<version>.signed.bin`: the OTA image followed by a
512 byte block holding the channel, version, download URL and the OTA entry's signature
(`channel=`, `version=`, `url=`, `sig=` lines, `OSSIGNv1` in the last 8 bytes). The chamber
holds back the last 512 bytes, hashes the rest as it writes, and switches only if the block's
signature covers that size and hash under the compiled-in key. Otherwise it answers 400
"Refused: this file is not a signed OpenShrooly release." and keeps the running version. The
upload needs the web login (`docs/SECURITY.md`). ESPHome's native OTA is turned off.

USB stays unrestricted on purpose: it needs the chamber in hand.

For USB recovery and full flash backups with esptool, see `docs/RECOVERY.md`.

## Publishing a release

```bash
# 1. Build (bump device_version in esphome/openshrooly.yaml first)
cd webapp && NEXT_BUILD_ID=openshrooly npm run build && cd ../esphome
esphome compile openshrooly.yaml
B=.esphome/build/openshrooly/build

# 2. Sign into the site's firmware folder (never commit these files)
node ../scripts/sign_release.mjs --key /workspace/secrets/firmware-signing.key.pem \
  --version 1.0.3-sl.2 --ota $B/firmware.ota.bin --factory $B/firmware.factory.bin \
  --out ../community/web/public/firmware/stable

# The signer also writes openshrooly-<version>.signed.bin for Install from a file.
# 3. Check and deploy the site
cd ../community/web && npm test && npm run deploy
```

`community/web/scripts/install-verify.test.js` re-verifies a published manifest and both
images with the device key whenever `public/firmware/stable/manifest.json` is present.

The current public release is 1.0.5-sl.1. See `docs/RELEASE-1.0.5-sl.1.md` for its hashes and
how the production deploy copies and checks the release before it goes live.

## Tests

```bash
python3 scripts/test_signed_update.py          # device verifier, host build + signer end to end
cd webapp && npm test                          # update UI wiring, no automatic checks
cd community/web && npm test                   # installer: signed only, same site only
cd community/api && npm test                   # site chrome and SEO
```
