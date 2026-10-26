# On-device dashboard size (ESP32-S3 flash)

Measured after the lightweight Shroom Labs restyle. Assets are gzip-embedded by `embed_static_files.py`. No webfonts, no CDN, no new images.

| | Before this UI pass | After |
| --- | --- | --- |
| Embedded gzip payload | 157,974 bytes (8 files) | 160,840 bytes (8 files) |
| `static_files.cpp` on disk | 949,739 bytes | 966,936 bytes |
| `webapp/out` uncompressed | (prior Next export) | 883,296 bytes |

**Delta: +2,866 bytes gzip (~+1.8%).** Firmware control loops are unchanged. The extra weight is CSS + a few small React chunks (gauges, light timeline, profile strip, `?demo=1` preview). Still well inside typical ESP32-S3 flash for this project.

Stability: same ESPHome REST and SSE. No new firmware entities. Demo mode is query-string only and never talks to hardware.
