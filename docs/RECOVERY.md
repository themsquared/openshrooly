# USB recovery

The USB port is the last way back if Wi-Fi updates stop working. It talks to the
ESP32-S3's built-in USB Serial/JTAG unit, so it works even when our firmware is broken: the
chip's ROM handles the reset into download mode, not OpenShrooly.

Use read-only commands first. Only write flash from a backup you have checked.

## What you need

- A USB-C data cable (some cables only carry power) from the Shrooly to the Mac.
- The Shrooly's own power adapter plugged in. Unplugging or replugging USB does not turn it off.
- esptool 4.x: `source ~/.openshrooly-venv/bin/activate`

## 1. Check the port

```bash
ls /dev/cu.usbmodem*                      # expect /dev/cu.usbmodem2101 or similar
system_profiler SPUSBHostDataType | grep -A6 "JTAG"   # "USB JTAG/serial debug unit", Espressif, 0x303a:0x1001
lsof /dev/cu.usbmodem*                    # must print nothing; close any serial monitor
```

## 2. Read-only check

```bash
P=/dev/cu.usbmodem2101
esptool.py --port $P --before default_reset --after hard_reset chip_id
esptool.py --port $P --before default_reset --after hard_reset read_mac
```

A good link prints `Chip is ESP32-S3` and MAC `d8:3b:da:7a:0c:bc` (this unit), then
restarts the Shrooly into its normal firmware. `--after hard_reset` matters: with
`no_reset` the chip stays in download mode and the chamber stops running until it is
reset.

## 3. Full backup (16 MB)

```bash
esptool.py --port $P --before default_reset --after hard_reset \
  read_flash 0 0x1000000 ~/openshrooly-backups/shrooly_backup_$(date +%Y%m%d-%H%M).bin
shasum -a 256 ~/openshrooly-backups/shrooly_backup_*.bin
```

Keep the SHA next to the file. A second read should give the same SHA for the app
partitions; the NVS and OTA data areas can differ between reads because the device writes
settings while it runs.

## If esptool says "No serial data received"

Check the Shrooly's uptime on its web page before and after. If the uptime did not drop,
the reset never reached the chip and the problem is the USB link, not the firmware.

1. **Replug the USB cable** at the Shrooly end, wait 5 seconds, and run step 2 again. This
   fixes a USB link the Mac has stopped talking to. The chamber keeps running on its own
   power. This is the expected fix for what we saw on 2026-10-24: the port still enumerated on the Mac, but
   no bytes came through, even the ROM boot banner during an OTA restart. The firmware was
   ruled out because its only change from the last good build was the embedded dashboard
   files.
2. **Try another cable or Mac port** (a data cable, not charge only; avoid hubs).
3. **Force download mode with the BOOT button** (only if 1 and 2 fail). We have not yet
   confirmed where this board's BOOT (GPIO0) and RESET (EN) buttons or pads are; check
   before opening the case. With the power adapter connected: hold BOOT, tap RESET,
   release BOOT.
   The screen and fan stop; that is expected. Run step 2 with `--before no_reset`.
   Finish with `--after hard_reset` or tap RESET to start the chamber again.

## Restore

Write only a backup made from this unit (its MAC is in the file name), and only after
checking its SHA:

```bash
esptool.py --port $P --before default_reset --after hard_reset write_flash 0 <backup.bin>
```

This replaces everything, including Wi-Fi settings and grow settings saved at the time
of the backup. For a firmware-only fix, prefer the device's own Install from a file page
or the signed USB installer (`docs/INSTALL.md`).
