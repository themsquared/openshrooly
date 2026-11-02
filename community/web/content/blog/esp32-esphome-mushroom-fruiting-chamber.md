---
title: Build a mushroom fruiting chamber with an ESP32 and ESPHome
h1: Build an automated mushroom fruiting chamber with an ESP32 and ESPHome
description: Build an automated mushroom fruiting chamber with an ESP32 and ESPHome. Parts by role, wiring, an example YAML that runs a grow profile, and tuning.
date: 2026-11-02
updated: 2026-11-02
category: Chamber builds
answer: You need one ESP32 running ESPHome, a humidity sensor (an SHT40 or SHT41, plus an optional SCD41 for CO2), and three low voltage switches for a humidifier, a fan and an LED light. The firmware turns the humidifier on when humidity drops 1.5 points under target and off at 0.5 over, runs the fan for a set time on a set interval, and keeps the light on for a set number of hours. Our pearl oyster fruiting stage is 88% humidity, 40 seconds of fan every 10 minutes and 12 hours of light. The example YAML below runs that profile and shows up in Home Assistant.
related:
  - Humidity and fresh air | /guides/humidity-and-fresh-air
  - Fresh air calculator | /tools/fresh-air-planner
  - Shrooly alternatives | /shrooly-alternatives
  - Which chambers work with Shroom Labs | /chambers
  - Pearl oyster grow profile | /profiles/pearl-oyster
  - Install on a Shrooly | /install
howto: How to build the chamber, step by step
---

## What an automated fruiting chamber has to do

A fruiting chamber holds a colonized block and keeps three things where the mushroom wants them: humidity, fresh air and light. Temperature matters too, but most home builds handle it by putting the box in a room that is already close to the right temperature.

An ESP32 running [ESPHome](https://esphome.io/) can do all of that for a few parts. It reads a sensor, switches loads, keeps working with no internet, and shows up in Home Assistant so you can watch graphs and change targets from your phone. It is the same approach our own firmware takes on the chambers we support, so the logic below is the logic we already run, cut down to fit one file.

If you own a Shrooly, you do not need to build anything. [Install our free firmware](/install) on it instead. This post is for everyone else, and for anyone who wants a chamber that does not depend on one company staying in business. Our [Shrooly alternatives](/shrooly-alternatives) page covers the other options.

## Parts by role

Buy by role, not by brand. Any part that fills the role works.

| Role | What to use | Notes |
| --- | --- | --- |
| Controller | ESP32 dev board (esp32dev) | Powered from 5 V |
| Humidity and temperature | SHT40, SHT41 or SHT45 breakout | I2C, address 0x44 |
| CO2 (optional) | SCD40 or SCD41 breakout | I2C, address 0x62 |
| Humidifier | 5 V or 12 V ultrasonic mist maker, fogger or USB humidifier | Pick one that mists as soon as it gets power, with no button |
| Humidifier switch | Logic level MOSFET module or a relay module that triggers at 3.3 V | One channel |
| Fan | 12 V PC case fan | Pulls room air in or pushes chamber air out |
| Fan switch | Logic level MOSFET module | Lets the ESP32 set the speed |
| Light | 12 V LED strip, white or blue | Low output is fine |
| Light switch | Logic level MOSFET module | One channel |
| Power | 12 V supply plus a 5 V buck converter | Size it for everything on at once |
| Box | Clear tote or any sealed box | Drill holes for the fan and an exhaust |

Keep every load on low voltage. If you want to run a mains heater or a mains humidifier, use a listed smart plug that Home Assistant can switch, not a relay board wired by hand.

The SHT4x is the better humidity sensor for this job. Sensirion rates the SHT40 and SHT41 at plus or minus 1.8% RH typical and the SHT45 at 1.0%. The SCD4x also reports humidity, but buy it for CO2. Its datasheet limits it to non condensing air from 0 to 95% RH, so keep it out of the mist.

## Wiring

All three sensors share one I2C bus. Every load gets its own switch module. Tie every ground together: the 12 V supply, the buck converter, the ESP32 and each module.

| Part | Connects to | ESP32 pin |
| --- | --- | --- |
| Sensor SDA | I2C data | GPIO21 |
| Sensor SCL | I2C clock | GPIO22 |
| Sensor VCC and GND | 3.3 V and GND | 3V3, GND |
| Humidifier switch input | On or off | GPIO26 |
| Fan MOSFET input | PWM | GPIO25 |
| Light MOSFET input | PWM | GPIO27 |
| ESP32 power | 5 V from the buck converter | 5V (VIN), GND |

These pins were picked to stay clear of trouble. On the ESP32, GPIO0, 2, 5, 12 and 15 are strapping pins that change how the chip boots, GPIO6 to 11 usually connect to the flash chip, and GPIO34 to 39 are inputs only. Avoid all of those for loads.

Two things catch people out. Many relay modules switch on when the input goes low. If yours does, add `inverted: true` under the humidifier pin. And the SCD4x datasheet asks for a steady supply, with a separate regulator recommended, so do not hang it off a rail that also feeds the fogger.

## Mount the sensor in the right place

Put the humidity sensor at the height of the block, out of the direct path of the mist and the fan. A sensor sitting in the fog stream reads 100% and turns the humidifier off while the rest of the box dries out.

High humidity is hard on these sensors. Sensirion says SHT4x parts build up a reversible upward offset, called creep, when they sit above about 90% RH for long periods, and that the built in heater clears it. Our firmware runs the heater in short pulses capped at 2% of the time, and the example below does the same. ESPHome does not publish readings while the heater runs, so a reading every 2 seconds still leaves plenty of data.

## The example ESPHome YAML

This is an example to adapt, not a finished product build. It follows the same rules as our firmware, but it has not been tested on your parts. Check every pin and value against what you bought before you power anything.

What it does:

- Turns every load off at boot. Nothing runs until you turn on the Auto mode switch.
- Humidity: on below target minus 1.5 points, off above target plus 0.5, with at least 90 seconds on and 60 seconds off. Those are our firmware defaults. It shuts the humidifier off if the sensor stops reporting.
- Fresh air: runs the fan for the set seconds every set minutes, and any time CO2 is over the limit or humidity is over 96%.
- Light: on for the set hours starting at the set hour.
- A Stage select that loads the colonization, pinning or fruiting stage of our pearl oyster profile. Every value is also its own number, so you can tune one without editing the file.
- A button to calibrate the CO2 sensor to outdoor air. Delete the scd4x block and that button if you have no CO2 sensor.

Put your Wi-Fi details, an API encryption key and an OTA password in `secrets.yaml` next to it. ESPHome writes the key for you when you create a new device.

```yaml
# Example to adapt, not a finished product build.
# One ESP32 runs a fruiting chamber from a grow profile:
# humidifier on/off with a band, fan on a fresh air timer plus a CO2 limit,
# light on a daily schedule. Pin numbers match the wiring table in the post.
# Check every value against your parts before you power anything.

esphome:
  name: fruiting-chamber
  friendly_name: Fruiting chamber
  on_boot:
    priority: 800
    then:
      # Every load starts off. The control loops turn things on.
      - switch.turn_off: humidifier
      - output.set_level:
          id: fan_pwm
          level: 0%
      - light.turn_off: grow_light

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

api:
  encryption:
    key: !secret api_key

ota:
  - platform: esphome
    password: !secret ota_password

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

time:
  - platform: sntp
    id: sntp_time
    timezone: America/Los_Angeles

i2c:
  sda: GPIO21
  scl: GPIO22

globals:
  - id: hum_changed_ms
    type: uint32_t
    initial_value: "0"
  - id: fan_cycle_start_ms
    type: uint32_t
    initial_value: "0"

sensor:
  - platform: sht4x
    address: 0x44
    update_interval: 2s
    # Short heater pulses fight the offset SHT4x sensors pick up above 90% RH.
    heater_max_duty: 0.02
    heater_power: Med
    heater_time: Short
    temperature:
      id: temperature
      name: Temperature
    humidity:
      id: humidity
      name: Humidity
      filters:
        - sliding_window_moving_average:
            window_size: 3
            send_every: 1

  # Optional. Delete this block if you have no SCD40 or SCD41.
  - platform: scd4x
    id: co2_sensor
    address: 0x62
    update_interval: 30s
    # ASC needs the sensor to see fresh outdoor air once a week.
    # A sealed chamber may never do that, so calibrate by hand instead.
    automatic_self_calibration: false
    co2:
      id: co2
      name: CO2

output:
  - platform: ledc
    id: fan_pwm
    pin: GPIO25
    frequency: 20000Hz
  - platform: ledc
    id: light_pwm
    pin: GPIO27
    frequency: 1000Hz

light:
  - platform: monochromatic
    id: grow_light
    name: Grow light
    output: light_pwm
    restore_mode: ALWAYS_OFF

switch:
  - platform: gpio
    id: humidifier
    name: Humidifier
    pin: GPIO26
    restore_mode: ALWAYS_OFF
  - platform: template
    id: auto_mode
    name: Auto mode
    optimistic: true
    restore_mode: RESTORE_DEFAULT_OFF

number:
  - platform: template
    id: target_humidity
    name: Target humidity
    unit_of_measurement: "%"
    min_value: 60
    max_value: 96
    step: 1
    initial_value: 88
    optimistic: true
    restore_value: true
  - platform: template
    id: fan_every_min
    name: Fresh air every
    unit_of_measurement: min
    min_value: 1
    max_value: 240
    step: 1
    initial_value: 10
    optimistic: true
    restore_value: true
  - platform: template
    id: fan_run_s
    name: Fresh air run
    unit_of_measurement: s
    min_value: 5
    max_value: 900
    step: 5
    initial_value: 40
    optimistic: true
    restore_value: true
  - platform: template
    id: fan_speed
    name: Fan speed
    unit_of_measurement: "%"
    min_value: 15
    max_value: 100
    step: 5
    initial_value: 45
    optimistic: true
    restore_value: true
  - platform: template
    id: co2_limit
    name: CO2 limit
    unit_of_measurement: ppm
    min_value: 500
    max_value: 2000
    step: 50
    initial_value: 800
    optimistic: true
    restore_value: true
  - platform: template
    id: lights_on_hour
    name: Lights on at
    min_value: 0
    max_value: 23
    step: 1
    initial_value: 8
    optimistic: true
    restore_value: true
  - platform: template
    id: light_hours
    name: Light hours
    unit_of_measurement: h
    min_value: 0
    max_value: 24
    step: 1
    initial_value: 12
    optimistic: true
    restore_value: true

# Picking a stage loads that stage of the Pearl Oyster profile.
select:
  - platform: template
    id: stage
    name: Stage
    options:
      - Colonization
      - Pinning
      - Fruiting
    initial_option: Fruiting
    optimistic: true
    restore_value: true
    set_action:
      - if:
          condition:
            lambda: 'return x == "Colonization";'
          then:
            - number.set: {id: target_humidity, value: 90}
            - number.set: {id: fan_every_min, value: 60}
            - number.set: {id: fan_run_s, value: 15}
            - number.set: {id: fan_speed, value: 20}
            - number.set: {id: light_hours, value: 0}
      - if:
          condition:
            lambda: 'return x == "Pinning";'
          then:
            - number.set: {id: target_humidity, value: 93}
            - number.set: {id: fan_every_min, value: 15}
            - number.set: {id: fan_run_s, value: 35}
            - number.set: {id: fan_speed, value: 35}
            - number.set: {id: light_hours, value: 12}
      - if:
          condition:
            lambda: 'return x == "Fruiting";'
          then:
            - number.set: {id: target_humidity, value: 88}
            - number.set: {id: fan_every_min, value: 10}
            - number.set: {id: fan_run_s, value: 40}
            - number.set: {id: fan_speed, value: 45}
            - number.set: {id: light_hours, value: 12}

button:
  # Run outdoors for at least 3 minutes, then press. 426 ppm is the
  # NOAA global monthly mean for July 2026.
  - platform: template
    name: Calibrate CO2 to outdoor air
    on_press:
      - scd4x.perform_forced_calibration:
          id: co2_sensor
          value: 426

interval:
  # Humidity: on below target minus 1.5, off above target plus 0.5,
  # at least 90 s on and 60 s off. Same defaults as our firmware.
  - interval: 5s
    then:
      - lambda: |-
          const float rh = id(humidity).state;
          if (!id(auto_mode).state || isnan(rh) || rh <= 0.0f) {
            if (id(humidifier).state) id(humidifier).turn_off();
            return;
          }
          const uint32_t now = millis();
          const uint32_t held = now - id(hum_changed_ms);
          const float target = id(target_humidity).state;
          const bool on = id(humidifier).state;
          if (!on && rh < target - 1.5f && held >= 60000) {
            id(humidifier).turn_on();
            id(hum_changed_ms) = now;
          } else if (on && rh > target + 0.5f && held >= 90000) {
            id(humidifier).turn_off();
            id(hum_changed_ms) = now;
          }

  # Fresh air: run the fan for fan_run_s every fan_every_min minutes,
  # and any time CO2 is over the limit.
  - interval: 5s
    then:
      - lambda: |-
          if (!id(auto_mode).state) {
            id(fan_pwm).set_level(0.0f);
            return;
          }
          const uint32_t now = millis();
          const uint32_t every = (uint32_t) (id(fan_every_min).state * 60000.0f);
          const uint32_t run = (uint32_t) (id(fan_run_s).state * 1000.0f);
          if (now - id(fan_cycle_start_ms) >= every) id(fan_cycle_start_ms) = now;
          const bool scheduled = (now - id(fan_cycle_start_ms)) < run;
          const float ppm = id(co2).state;
          const bool co2_high = !isnan(ppm) && ppm > id(co2_limit).state;
          const bool too_wet = id(humidity).state > 96.0f;
          const float level = (scheduled || co2_high || too_wet) ? id(fan_speed).state / 100.0f : 0.0f;
          id(fan_pwm).set_level(level);

  # Light: on for light_hours starting at lights_on_hour.
  - interval: 30s
    then:
      - lambda: |-
          if (!id(auto_mode).state) return;
          const auto t = id(sntp_time).now();
          if (!t.is_valid()) return;
          const int start = (int) id(lights_on_hour).state;
          const int hours = (int) id(light_hours).state;
          const int since = (t.hour - start + 24) % 24;
          const bool want = hours > 0 && since < hours;
          if (want != id(grow_light).current_values.is_on()) {
            auto call = want ? id(grow_light).turn_on() : id(grow_light).turn_off();
            call.perform();
          }
```

Flash it once over USB with `esphome run fruiting-chamber.yaml`. After that ESPHome updates it over Wi-Fi. The lambdas use `id(...).state`, which is how ESPHome reads a sensor or number inside C++ code.

## How to build the chamber, step by step

1. Drill a fan hole low on one side of the box and an exhaust hole high on the other side, so fresh air sweeps across the block.
2. Mount the humidifier so the mist goes into the open box, not straight onto the block or the sensor.
3. Wire the sensor, the three MOSFET or relay modules and the power as in the wiring table, with all grounds tied together.
4. Copy the example YAML, change pins to match your build, add secrets.yaml, and flash it over USB.
5. Add the device in Home Assistant. It shows up on its own through the ESPHome integration.
6. Run the box empty for a day with Auto mode on and watch the humidity graph.
7. Tune the humidifier and fan until humidity holds near the target, then put the block in and pick the stage.

## Run a grow profile

The Stage select loads these values from our [pearl oyster profile](/profiles/pearl-oyster). Change the stage on the day the profile says to.

| Stage | Days | Humidity | Fresh air | Light | Room temperature |
| --- | --- | --- | --- | --- | --- |
| Colonization | 14 | 90% | 15 s every 60 min at 20% | Dark | 24 °C (75 °F) |
| Pinning | 5 | 93% | 35 s every 15 min at 35% | 12 h from 8:00 | 18 °C (64 °F) |
| Fruiting | 10 | 88% | 40 s every 10 min at 45% | 12 h from 8:00 | 16 °C (61 °F) |

For another species, copy the values from its profile into the three `if` blocks. Our [lion's mane profile](/profiles/lions-mane) wants damper air, for example: 94% to pin and 90% to fruit, with 25 seconds of fan every 18 minutes.

This build has no heater and no cooler. Our own firmware treats temperature the same way. It only controls temperature when Home Assistant switches an outside heater. Put the chamber somewhere that sits close to the stage temperature.

## How to tune it

**Humidity swings too far.** If humidity runs well past the target before it drops, the mist maker is too strong for the box. Turn it down, move it away from the sensor, or raise the minimum off time. If humidity never reaches the target, the box leaks or the fan runs too long.

**Check the sensor.** Seal the sensor in a small jar with a damp paste of table salt. Saturated salt holds the air at about 75% RH at 25 °C. If your sensor reads far off that after a few hours, add an offset filter in the YAML.

**Fresh air.** Fresh air is a trade off. More of it keeps CO2 down but dries the box. The [fresh air calculator](/tools/fresh-air-planner) turns your box size and fan into run times for a target number of air changes. University of California extension material suggests about 4 air changes an hour while oyster pins form and 4 to 6 while they crop. Our [humidity and fresh air guide](/guides/humidity-and-fresh-air) has the reasons.

**CO2.** With an SCD41 you can stop guessing. A SARE funded oyster guide says to keep CO2 under 800 ppm, which is the default limit in the example, and says oysters may not fruit above about 1,200 ppm. Long stems and small caps on oysters usually mean the box needs more fresh air.

**CO2 calibration.** The SCD4x automatic calibration assumes the sensor sees fresh air near 400 ppm for at least 3 minutes once a week. A closed chamber may never see that, so the example turns it off. Instead, take the sensor outside, let it run for at least 3 minutes, and press the calibrate button. The value in the YAML is 426 ppm, the NOAA global monthly mean for July 2026.

## Home Assistant

The `api` block with an encryption key is what Home Assistant uses to talk to the ESP32. Home Assistant finds the device on your network and adds every sensor, switch, number and the Stage select as entities. From there you get history graphs, phone alerts if humidity drops, and a way to change stages without a laptop. The chamber keeps running its own loops if Home Assistant or Wi-Fi goes down.

Read our [docs](/docs) for how our firmware lays out the same controls on the chambers we support.

## FAQ

### What is the best sensor for a mushroom fruiting chamber?

An SHT40, SHT41 or SHT45 for humidity and temperature, mounted out of the mist. Add an SCD40 or SCD41 if you want to control fresh air by CO2. The SCD41 covers a wider range, 400 to 5,000 ppm against 400 to 2,000 ppm for the SCD40.

### Do I need Home Assistant?

No. The ESP32 runs the humidity, fan and light loops by itself. Home Assistant adds graphs, alerts and an easy way to change settings.

### Can I control a mains humidifier or heater?

Not with a hand wired relay board. Plug it into a listed smart plug and let Home Assistant switch it, or pick a 5 V or 12 V mist maker so everything in the box stays low voltage.

### Why does my humidity sensor read 100% all the time?

It is in the mist path or it has condensation on it. Move it out of the fog stream. The SHT4x heater pulses in the example also help clear the high humidity offset.

### Why turn off CO2 automatic calibration?

Automatic calibration assumes the sensor sees fresh outdoor air once a week. Inside a closed chamber that may never happen, and the sensor will drift. Calibrating by hand outdoors is more reliable.

## Sources

- [Shroom Labs pearl oyster grow profile](https://shroomlabs.io/profiles/pearl-oyster)
- [Shroom Labs lion's mane grow profile](https://shroomlabs.io/profiles/lions-mane)
- [OpenShrooly firmware: humidity controls and defaults (controls.yaml)](https://github.com/themsquared/openshrooly/blob/main/esphome/components/controls.yaml)
- [OpenShrooly firmware: humidity control script](https://github.com/themsquared/openshrooly/blob/main/esphome/scripts/humidity_control_manager.yaml)
- [OpenShrooly firmware: SHT4x sensor settings (sensors.yaml)](https://github.com/themsquared/openshrooly/blob/main/esphome/components/sensors.yaml)
- [Shroom Labs community ESPHome config for the Terrashroom](https://github.com/themsquared/openshrooly/tree/main/esphome/terrashroom)
- [ESPHome SHT4X sensor](https://esphome.io/components/sensor/sht4x/)
- [ESPHome SCD4X CO2 sensor](https://esphome.io/components/sensor/scd4x/)
- [ESPHome native API](https://esphome.io/components/api/)
- [ESPHome template select](https://esphome.io/components/select/template/)
- [Home Assistant ESPHome integration](https://www.home-assistant.io/integrations/esphome/)
- [Espressif ESP32 GPIO reference](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html)
- [Sensirion SHT4x datasheet](https://sensirion.com/media/documents/33FD6951/6A7C10A0/HT_DS_Datasheet_SHT4x_V7.3.pdf)
- [Sensirion application note: creep mitigation for SHT4x](https://sensirion.com/media/documents/A88858C9/629626D4/Application_Note_Creep_Mitigation_SHT4x.pdf)
- [Sensirion SCD4x datasheet](https://sensirion.com/media/documents/48C4B7FB/64C134E7/Sensirion_SCD4x_Datasheet.pdf)
- [Sensirion SCD4x sensor operation guide](https://sensirion.com/media/documents/9D6E378D/6AC75EB6/CD_AN_Sensor_Operation_Guide_D1.pdf)
- [NOAA global monthly mean CO2](https://gml.noaa.gov/ccgg/trends/global.html)
- [Greenspan, Humidity fixed points of binary saturated aqueous solutions (NIST)](https://nvlpubs.nist.gov/nistpubs/jres/81A/jresv81An1p89_A1b.pdf)
- [UC ANR, Growing oyster mushrooms](https://ucanr.edu/sites/default/files/2012-05/144772.pdf)
- [SARE and FungiAlly, Oyster mushroom cultivation guide](https://projects.sare.org/media/pdf/F/u/n/FungiAlly_Oyster_booklet_Final-1.pdf)
