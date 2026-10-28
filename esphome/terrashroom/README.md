# Terrashroom firmware (community, untested on real hardware)

This is an ESPHome profile for the Terrashroom grow chamber. The company behind
Terrashroom posted its last company update on June 24, 2025. It said the company
was closing and that the devices would stop working as its cloud service ended.
This firmware lets a Terrashroom run on your own Wi-Fi with no cloud.

**Status: community, untested on real hardware.** Nobody at Shroom Labs has a
Terrashroom yet. The config builds with ESPHome 2026.7.1 and CI checks it, but it
has never run on a real unit. Flash it only if you accept that risk, and please
tell us what happens: https://shroomlabs.io/terrashroom

## Pin map

| Function | GPIO | Notes |
|---|---|---|
| I2C SDA / SCL | 21 / 22 | HDC1080 temperature and humidity sensor |
| Fan 1 (exhaust) | 32 | PWM, 20 kHz |
| Fan 2 (intake) | 33 | PWM, 20 kHz |
| Blower | 25 | PWM, pushes mist into the chamber |
| Atomizer (mist) | 13 | MOSFET |
| Heater | 12 | High power MOSFET, PWM. Strapping pin, see below |
| UV LED | 18 | On or off |
| Water low sense | 23 | Read only while GPIO15 is on |
| Water read enable | 15 | Strapping pin, kept off |
| Base light strip | 5 | WS2812, 24 LEDs. Strapping pin |
| Canopy light strip | 14 | WS2812, 64 LEDs |
| ESP32-CAM power | 26 | Camera is not supported yet |
| Serial2 TX / RX to camera | 17 / 16 | Not used yet |

Sources:

- Parker Ryan's community reverse engineering in
  [aparkerryan27/terrashroomPublic](https://github.com/aparkerryan27/terrashroomPublic)
  (`hardware/pinout.md` and `esphome/terrashroom.yaml`, November 2025). That repo
  has no license, so this config is our own work written from the pin facts. Thank
  you, Parker.
- An owner guide on Reddit about flashing ESPHome on a Terrashroom:
  https://www.reddit.com/r/terrashroomscam/comments/1pbkpxi/
- Espressif boot mode and strapping pin docs:
  https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html

## The heater pin and booting

The heater MOSFET sits on GPIO12. On the ESP32, GPIO12 is a strapping pin. If it
is high at the moment the chip resets, the chip sets its flash voltage to 1.8 V
and the flash chip (which needs 3.3 V) cannot be read. The board then will not
boot or flash, and the serial log shows `flash read err, 1000`. One community
board stopped booting after heavy heater use, and the owner suspected this pin.

What this firmware does about it:

- The heater output starts off at the earliest boot step (priority 800) and is
  turned off again on shutdown and before every restart.
- GPIO12 has no pull up. The heater stays off until you turn on Heater Control.
- The heater is capped: 35% duty by default (60% max), at most 10 minutes on,
  then 5 minutes off. It turns off above 32 °C and when the sensor reading is
  missing or more than 2 minutes old.

If a board still will not boot with the `flash read err` message, the hardware
fix is to burn an eFuse that ignores GPIO12 and always uses 3.3 V flash:

```
espefuse.py --port /dev/ttyUSB0 summary          # check first
espefuse.py --port /dev/ttyUSB0 set_flash_voltage 3.3V
```

**This cannot be undone.** Only do it after you confirm the module uses 3.3 V
flash (an ESP32-WROOM-32 does). See
https://docs.espressif.com/projects/esptool/en/latest/esp32/espefuse/set-flash-voltage-cmd.html

## How to flash

1. Unplug the Terrashroom from mains power before you open it.
2. Find the flash header: EN, GPIO0, GND, TX, RX.
3. Connect a 3.3 V USB serial adapter (a CH340 works): GND to GND, adapter TX to
   RX, adapter RX to TX. Do not connect 5 V. Power the unit from its own supply.
4. Hold GPIO0 to GND while you reset (tap EN to GND), to enter flash mode.
5. Back up the stock firmware first:
   `esptool.py --port /dev/ttyUSB0 read_flash 0 0x400000 terrashroom-stock.bin`
6. Copy `secrets.example.yaml` to `secrets.yaml` and set your own passwords.
7. Run `esphome run terrashroom.yaml`, or build it and flash the file at
   https://web.esphome.io.
8. Join the `Terrashroom Setup` Wi-Fi network and pick your home Wi-Fi.

## What it does

- Reads temperature and humidity every 30 seconds.
- Auto Climate (off by default): mists when humidity is 2 points under target,
  at most once a minute, runs fresh air on a schedule, and purges with both fans
  above 96%.
- Heater Control (off by default, every boot): heats toward the target with the
  caps above.
- Light schedule on the canopy strip.
- Test buttons for the fans, mist, and heater.
- Local web page, Home Assistant API (encrypted), and password protected OTA.

## What is untested

- Everything, on real hardware.
- Water sensor polarity. We assume the probe reads high when there is water.
- How hot the heater gets at a given duty, and whether 400 Hz PWM is right.
- LED counts and color order on both strips.
- The camera. It is not supported yet.
- Shroom Labs cloud pairing and Grow Coach. Not wired up for Terrashroom yet.

## Build and check

```
cp secrets.example.yaml secrets.yaml
esphome config terrashroom.yaml
esphome compile terrashroom.yaml
```
