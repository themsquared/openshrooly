# Chamber security

Every chamber makes its own secrets the first time it starts this firmware. Nothing secret is
shared between chambers or stored in this repository.

| Secret | Used for | Where to read it |
| --- | --- | --- |
| Home Assistant encryption key (32 random bytes) | Encrypts the ESPHome API on port 6053 | `http://<chamber-ip>/security` after signing in |
| Web password (12 characters) | Changing settings, installing updates, pressing buttons from a browser | Chamber screen: Menu, System, `Web password`. Also on `/security` |
| Wi-Fi setup password (12 characters) | Joining the setup network `OpenShrooly-XXXX` | Chamber screen while Wi-Fi setup is on, and `/security` |

The secrets live in the chamber's settings storage (NVS). Updates keep them. A full USB erase
removes them and the chamber makes new ones on its next start. The key never appears in logs.

Code: `esphome/external_components/device_security/`, `esphome/components/security.yaml`.

## Home Assistant

The chamber still announces itself on the network, so Home Assistant finds it as before. The
announcement now says the connection is encrypted, and Home Assistant asks for the key.

1. On a computer on the same network, open `http://<chamber-ip>/security`.
2. Sign in with the user name `admin` and the web password from the chamber screen.
3. Copy the Home Assistant encryption key.
4. In Home Assistant open Settings, then Devices and services. Choose the OpenShrooly chamber
   (it shows as needing attention after the update), or Add integration, then ESPHome, and
   enter the chamber's address.
5. Paste the key when asked.

Without the key the chamber refuses the connection. A wrong key is refused too.

## Web page

- Reading is open on your home network: the dashboard at `/app/`, the entity page at `/`, and
  the live `/events` stream. Anyone on the same Wi-Fi can see temperature, humidity and settings.
  Keep the chamber on a network you trust.
- Every change needs the web login (user `admin`, the web password). This covers settings,
  switches, buttons, the update upload, and `/security`.
- Changes must come from the chamber's own page. A request that carries an `Origin` or `Referer`
  from another site is refused with 403. Actions sent as GET must carry one of those headers.
- The setup network's Wi-Fi form (`/wifisave`) works without the login, but only for someone
  joined to the password protected setup network. From the home network it needs the login.

Scripts can use the same login, for example
`curl -u admin:<web password> -X POST -d '' "http://<chamber-ip>/number/target_humidity/set?value=90"`.
The hub (`hub/`) reads chambers without a login. Its writes (apply, refresh with changes) are
refused until it learns the web password.

## Updates

- The chamber's **Install from a file** page and the captive portal upload only accept a signed
  release file, `openshrooly-<version>.signed.bin`. That is the normal update image with a 512 byte
  signature block on the end. Plain `.bin` files and images signed with a different key are
  refused before anything is switched. See `docs/INSTALL.md`.
- **Check for update** downloads from shroomlabs.io and checks the same signature.
- ESPHome's native OTA (`esphome run` over Wi-Fi) is turned off.
- USB stays open on purpose. Anyone holding the chamber can flash any image with esptool or the
  USB installer. That is the recovery path (`docs/RECOVERY.md`).

## Wi-Fi setup network

- Name `OpenShrooly-XXXX` (last four hex digits of the chamber's Wi-Fi MAC), WPA2 with the
  chamber's own setup password.
- It runs only while Wi-Fi setup is on. Setup turns on by itself when the chamber has no saved
  Wi-Fi, or from Menu, System, Wi-Fi setup (+ or -), or the **Start Wi-Fi setup** button on the web
  page (login needed).
- If saved home Wi-Fi stops working, the chamber keeps trying it and does not open the setup
  network by itself. The screen says `No Wi-Fi. Menu, System, Wi-Fi setup`.
- When the chamber is also on home Wi-Fi, setup turns itself off after 10 minutes. With no home
  Wi-Fi it stays on until Wi-Fi is set up.
- While setup is on, the main screen shows the network name, its password, the address
  `192.168.4.1` and the web login. Preview: `docs/device-screen/wifi-setup@4x.png`.

## Moving from upstream OpenShrooly or an older Shroom Labs build

1. Install `1.0.3-sl.2` or later once. From an older build the update page still takes the plain
   `.ota.bin`, or use the USB installer.
2. Read the web password from Menu, System on the chamber.
3. Re-add the chamber in Home Assistant with the key from `/security` (steps above). Until you
   do, Home Assistant shows it as unavailable.
4. If you joined the old open `OpenShrooly` network on a phone or laptop, you can forget it.
5. If you build your own firmware: keep `api: encryption: {}` without a `key:` line, do not add
   `ota: platform: esphome`, a `wifi: ap: password:`, or `web_server: auth:`. The build stops with
   a message if you do, because those would replace the per chamber secrets. To sign your own
   releases, put your public key in `esphome/components/updates.yaml` and sign with
   `scripts/sign_release.mjs`.

## Tests

```bash
python3 scripts/test_signed_update.py   # signed file layout, wrong key, unsigned, tampered, USB signature swap
python3 scripts/test_epaper_previews.py # setup screen preview and status text
```
