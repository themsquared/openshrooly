# OpenShrooly local hub

A single lightweight process that manages one or more devices running OpenShrooly on your LAN. Designed to run on a Raspberry Pi (or any always-on computer) without a cloud account.

Works with Shrooly devices running OpenShrooly. The firmware stays offline-first: if this hub is stopped, each device still works from its local web UI, buttons, and Home Assistant. Optional library sync goes to **Shroom Labs** (`https://api.shroomlabs.io`).

## What it does

- Add devices by IP / `.local` hostname, or scan mDNS for ESPHome (`_esphomelib._tcp`)
- Poll temperature, humidity, water, and status text sensors
- Apply a mushroom profile stage through the **existing** ESPHome REST API (`/number/.../set`, `/switch/.../turn_on`)
- Keep grow history and poll samples in SQLite
- Import / export profiles as JSON
- Push / pull the library to Shroom Labs when `COMMUNITY_TOKEN` is set

It does **not** flash firmware or replace the on-device dashboard.

## Requirements

- Python 3.11+
- Devices already running OpenShrooly 1.0.x on the same network

## Run locally

```bash
cd /path/to/openshrooly
python3 -m venv .venv
source .venv/bin/activate
pip install -r hub/requirements.txt
PYTHONPATH=shared python -m uvicorn hub.app:app --host 127.0.0.1 --port 8090
```

Open http://127.0.0.1:8090

## Docker (Pi-friendly)

```bash
docker build -f hub/Dockerfile -t openshrooly-hub .
docker run --rm -p 8090:8090 \
  -e HUB_ENABLE_PSILOCYBIN=0 \
  -v hub-data:/app/hub/data \
  openshrooly-hub
```

On a Pi, `--network host` makes mDNS discovery more reliable.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HUB_DATA_DIR` | `hub/data` | SQLite location |
| `OPENSHROOLY_DATA_DIR` | repo `data/` | Seed profiles |
| `HUB_ENABLE_PSILOCYBIN` | `0` | Load the restricted pack |
| `COMMUNITY_URL` | `http://127.0.0.1:8787` | Shroom Labs API (`https://api.shroomlabs.io` in production) |
| `COMMUNITY_TOKEN` | empty | Hub API token from a Shroom Labs account |
| `HUB_POLL_SECONDS` | `60` | Sensor history interval |

The psilocybin pack is **off** unless you opt in. Even then, those profiles stay free and never carry affiliate links.

## Device API used

Stock firmware `web_server` v3 (see `esphome/components/webserver.yaml` and `webapp/lib/esphome-api.ts`):

- `GET /sensor/{id}`, `GET /number/{id}`, `GET /text_sensor/{id}`
- `POST /number/{id}/set?value=`
- `POST /switch/{id}/turn_on` or `turn_off`

No firmware changes are required for this hub.
