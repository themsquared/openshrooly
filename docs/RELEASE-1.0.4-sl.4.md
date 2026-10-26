# Release 1.0.4-sl.4 (prepared, not published)

This is the first Shroom Labs release meant for owners. It is built and signed but nothing is
on shroomlabs.io yet. Mike publishes it. Until then `/firmware/stable/` stays empty and the
installer page says the installer is not available.

## What is in it

- Everything up to 1.0.4-sl.3: cloud linking, Autopilot setpoints from the site, signed updates,
  the e-paper mascot and header fixes.
- Shroomy always parties on the growing screen (no sleep frame).
- Fix for the ack race (checklist S4). If the chamber recorded a new "applied" while it was still
  sending the previous one, the new one was dropped. Now it is sent on the next pass.

## Files (on the draft GitHub release, not in git)

| File | Used by |
| --- | --- |
| `manifest.json` | Installer page and the chamber's **Check for updates** |
| `openshrooly-1.0.4-sl.4.factory.bin` | USB installer (first install on a stock Shrooly) |
| `openshrooly-1.0.4-sl.4.ota.bin` | Wi-Fi update from **Check for updates** |
| `openshrooly-1.0.4-sl.4.signed.bin` | **Install from a file on this computer** |
| `SHA256SUMS` | Checking the download |

All four images are signed with the release key. The manifest's `key` field is the first 16 hex
characters of the device public key, so you can see which key signed it.

## Publishing (Mike)

1. Download the four files and `manifest.json` from the draft release.
2. Put them in `community/web/public/firmware/stable/` (this folder is git ignored on purpose).
3. `cd community/web && npm test`. `install-verify.test.js` checks the manifest and both images
   against the device key.
4. Deploy the site the usual way. Check `https://shroomlabs.io/firmware/stable/manifest.json`
   shows `1.0.4-sl.4`.
5. Publish the GitHub release. This creates the tag.
6. After that, turn on linking (checklist B7) and remove the "not out yet" text (U2).

## Install guide for owners

### First time, from a stock Shrooly (USB)

You need a computer with Chrome or Edge and a USB-C cable that carries data (some charge-only
cables do not work).

1. Write down your grow settings if you care about them. Installing starts the chamber fresh.
2. Go to https://shroomlabs.io/install.html and plug the Shrooly into the computer.
3. Click **Install**, pick the Shrooly in the list, and wait. It takes about two minutes. Do not
   unplug it.
4. When it restarts, the screen shows a network called `OpenShrooly-XXXX`, its password, and the
   address `192.168.4.1`. Join that network from your phone, open the address, and pick your home
   Wi-Fi. The screen also shows the chamber's web login. Keep it for later.
5. Sign in on shroomlabs.io and enter the code shown on the chamber to link it.

### Already on OpenShrooly (Wi-Fi)

1. Open the chamber's page on your home network and go to Settings.
2. Press **Check for updates**, then **Install**.
3. The chamber restarts. If the new version does not start, it goes back to the old one by
   itself and tells you.

### No internet on the chamber

Download `openshrooly-1.0.4-sl.4.signed.bin` and use **Install from a file on this computer** in
Settings. Only signed files are accepted.

## How it was built

```bash
cd webapp && npm ci && NEXT_BUILD_ID=openshrooly npm run build && cd ..
esphome compile esphome/openshrooly.yaml   # ESPHome 2026.7.1
node scripts/sign_release.mjs --key /workspace/secrets/firmware-signing.key.pem \
  --version 1.0.4-sl.4 --ota <build>/firmware.ota.bin --factory <build>/firmware.factory.bin \
  --out <folder outside git>
```
