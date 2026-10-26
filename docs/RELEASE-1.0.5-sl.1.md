# Release 1.0.5-sl.1 (published, open beta)

The first Shroom Labs release for owners. Live at
https://shroomlabs.io/firmware/stable/manifest.json since 2026-10-26. Built from merge
`c288dec` (#102). It replaces the 1.0.4-sl.4 prep in #90, which never shipped.

## What is in it

- Everything up to 1.0.4-sl.4: cloud linking, signed updates, Shroomy on the growing screen,
  header fixes, and the ack race fix.
- One `setpoints` command can set every chamber knob (temperature, humidity, fresh air, light
  schedule, white and color light, grow day and phase). All or nothing, with rollback.
- Telemetry reports `firmware_version`, knob values, ranges and capabilities.
- Unknown commands get a `refused` ack. Connect cap (18 per hour) unchanged.

## Files (served from the site, not in git)

| File | Size | sha256 | Used by |
| --- | --- | --- | --- |
| `manifest.json` | | | Installer page and the chamber's **Check for updates** |
| `openshrooly-1.0.5-sl.1.factory.bin` | 1866240 | `95aeba1bf0d01d83c4a04d7e2702ea7060d15f6939764452ae7236850d54c3d7` | USB installer |
| `openshrooly-1.0.5-sl.1.ota.bin` | 1800704 | `b569845dfcc1b2d93a728cd3d23554e5bb7d680d3d7d5785f16d26d73d25773f` | Wi-Fi update |
| `openshrooly-1.0.5-sl.1.signed.bin` | 1801216 | `16e37126efe81d8630b29274d768804371860829f89e09e4e97d46fe7664571f` | **Install from a file on this computer** |

The manifest `key` is `d060c2d2edb7871b`, the first 16 hex characters of the device public key.

## How it is published

`public/firmware/` is git ignored. The canonical copy lives on the build box in
`/workspace/launch/release/firmware/stable/`. The deploy script copies it into
`community/web/public/firmware/stable/` and runs `scripts/install-verify.test.js` (signature,
size and sha256 of both images against the device key) before it deploys. A failed check stops
the deploy.

To roll back to "no public release", empty that folder and deploy. The installer then shows
"first public release is coming soon" and chambers find no update.

## Install guide for owners

### First time, from a stock Shrooly (USB)

You need a computer with Chrome or Edge and a USB-C cable that carries data.

1. Write down your humidity and temperature settings. Installing starts the chamber fresh.
2. Go to https://shroomlabs.io/install and plug the Shrooly in.
3. Click **Install**, pick the Shrooly, and wait about two minutes. Do not unplug it.
4. The screen shows a network called `OpenShrooly-XXXX`, its password, and `192.168.4.1`. Join it
   from your phone, open that address, and pick your home Wi-Fi.
5. To link it (optional, open beta): turn on **Connect to Shroom Labs** on the chamber's page,
   then scan the QR or type the code at https://shroomlabs.io/claim while signed in.

### Already on OpenShrooly (Wi-Fi)

Settings, **Check for updates**, **Install**. If the new version does not start, the chamber goes
back to the old one by itself.

### No internet on the chamber

Download `openshrooly-1.0.5-sl.1.signed.bin` and use **Install from a file on this computer**.
Only signed files are accepted.

## How it was built

```bash
cd webapp && npm ci && NEXT_BUILD_ID=openshrooly npm run build && cd ..
esphome compile esphome/openshrooly.yaml   # ESPHome 2026.7.1
node scripts/sign_release.mjs --key <release key> --version 1.0.5-sl.1 \
  --ota <build>/firmware.ota.bin --factory <build>/firmware.factory.bin --out <folder outside git>
```
