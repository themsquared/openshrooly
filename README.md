![OpenShrooly logo](https://github.com/user-attachments/assets/9fa4725c-00c0-42ce-ba5d-a9dcd2bbc7c9)


**OpenShrooly** is a very early experimental replacement firmware for the Shrooly mushroom growing device.  
The intent is to convert the Shrooly into a **Wi-Fi–only device**, controllable from a local web interface or integrated with [Home Assistant](https://www.home-assistant.io/).

The 1.0.2 release is recommended if you are using an earlier version.

⚠️ **Warning:** Use at your own risk! This project is experimental and may brick your device.

---

## Community platform (this fork)

Mike's fork adds a **local hub** and a **shared community site** on top of the stock firmware. Devices stay offline-first.

- Architecture, data model, sync, monetization, and hosting costs: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Profile JSON (culinary + optional restricted pack): [`data/profiles/`](data/profiles/)
- Local hub (Pi / Docker): [`hub/README.md`](hub/README.md)
- Community site (Netlify frontend + Cloudflare Workers/D1/R2): [`community/README.md`](community/README.md)

## Documentation

See [OpenShrooly.com](https://openshrooly.com) for firmware documentation. Upstream project: [grahamsz/openshrooly](https://github.com/grahamsz/openshrooly) by Graham Stewart.

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
