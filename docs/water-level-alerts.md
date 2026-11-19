# Water level alerts

The tank has five capacitive electrodes read by the coprocessor. `water_level_calculator` turns them into a percent every 30 s, and a small state machine (`esphome/external_components/shroom_labs_cloud/water_level.h`) turns the percent into a tank state.

| State | Enters at | Leaves at | What happens |
| --- | --- | --- | --- |
| ok | 35% or more | | Nothing |
| low | below 30% | 35% | "Alert: Water Low" turns on, one warning beep, "WATER LOW" on the screen, `water_low: true` to the cloud |
| empty | below 12% | 18% | Everything in low, plus a critical beep, "ADD WATER" on the screen, and the mister is held off |
| unknown | no readable level for 10 minutes | next readable level | No alert, and the mister is not blocked |

A state change needs three reads in a row that agree, so about 90 s. An unreadable sensor never counts as empty. A chamber with a dead sensor keeps growing.

The mister interlock lives in three places: `humidity_control_manager` (stops the mister and refuses to start it), `humidifier_pwm_control` (writes 0% duty while empty) and the manual `humidifier_fan` switch. When the tank is refilled the normal humidity logic restarts the mister, after the usual minimum off time.

Cloud telemetry carries `water_level`, `water_state`, `water_source` (`sensor`) and `water_low`, and a state change to low, empty or back to ok is sent right away (at most one push every 2 minutes) instead of waiting for the 15 minute check-in.

Before flashing a unit, check the level at empty, half and full. The default dry baselines in `globals.yaml` are averages, and a unit that reads low when full would block its own mister.

Host tests: `python3 scripts/test_water_level.py`.
