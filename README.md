![OpenShrooly logo](https://github.com/user-attachments/assets/9fa4725c-00c0-42ce-ba5d-a9dcd2bbc7c9)


**OpenShrooly** is free, open source replacement firmware for the Shrooly mushroom growing chamber. It runs the chamber on your own Wi-Fi, with a local web page for temperature, humidity, fresh air and light, and it can work with [Home Assistant](https://www.home-assistant.io/). No cloud account is needed.

This fork adds [Shroom Labs](https://shroomlabs.io): stage by stage grow profiles for culinary and functional mushrooms, an optional account to see your chamber from anywhere, and a "Link this device" option in the chamber's own menu. It is in open beta.

## Get started

1. **Install:** plug the Shrooly into a computer with a USB-C data cable and use the installer at **[shroomlabs.io/install](https://shroomlabs.io/install)** (Chrome or Edge, about 5 minutes). It replaces the stock firmware, so if you might want that back, save a backup first with step 2.
2. **Back up and recover:** the [USB recovery guide](docs/RECOVERY.md) shows how to save your original firmware, and how to get a chamber back if an update goes wrong. If the screen doesn't change after installing, unplug USB and power for 10 seconds, then plug in power only.
3. **Grow:** pick a profile at [shroomlabs.io/grow](https://shroomlabs.io/grow). Each one lists the temperature, humidity, fresh air and light for every stage.
4. **Link (optional):** on the chamber, press button 4 to open the menu, choose "Link this device" and scan the QR code while signed in to shroomlabs.io.

Signed releases and update rollback are built in, and USB is always the way back. Still, this is beta firmware, so use it at your own risk.

## Credit

OpenShrooly was created by Graham Stewart: [grahamsz/openshrooly](https://github.com/grahamsz/openshrooly), with firmware docs at [OpenShrooly.com](https://openshrooly.com). This fork builds on that work. Shroom Labs is not made by or affiliated with the maker of Shrooly.

---

## For developers

What else is in this repo:

- Architecture, data model, sync, monetization, Grow Coach, and hosting costs: [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/COACH.md`](docs/COACH.md)
- Profile JSON (culinary + optional restricted pack): [`data/profiles/`](data/profiles/)
- Local hub (Pi / Docker): [`hub/README.md`](hub/README.md)
- Matter bridge (Apple Home / Google Home): [`docs/SMART_HOME.md`](docs/SMART_HOME.md) · [`bridge/README.md`](bridge/README.md)
- Shroom Labs (shroomlabs.io frontend, api.shroomlabs.io, cdn.shroomlabs.io): [`community/README.md`](community/README.md)
- Design system: [`design/`](design/) · UX: [`docs/UX.md`](docs/UX.md) · Security: [`SECURITY.md`](SECURITY.md) · Auth keys: [`docs/AUTH.md`](docs/AUTH.md)
- Expo iOS scaffold: [`mobile/`](mobile/)

## Continuous Integration

Pull requests and pushes to `main` are checked by the **Firmware CI** workflow,
which builds the RP2040 coprocessor, verifies its embedded image, and compiles
the ESPHome firmware before merging. Hub and community tests run in the
separate **Hub and community tests** workflow and do not rebuild firmware.

## Hardware Notes

- Devices verified with this firmware use an ESP32-S3 module configured with PSRAM in quad mode while keeping the main I²C bus on GPIO36 (SDA) and GPIO35 (SCL). ESPHome will warn that these pins may conflict with PSRAM on some S3 variants; on the tested hardware this wiring is intentional and safe.
- If you build on a different ESP32-S3 module that reserves GPIO36/35 for PSRAM, update `esphome/components/communication.yaml` with alternate I²C pins before compiling.
- The RP2040 coprocessor source and its reproducible build instructions are in
  [`coprocessor/`](coprocessor/).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
