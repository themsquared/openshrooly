# shroom_labs_cloud (opt-in)

Outbound Shroom Labs link. **Not compiled into the default OpenShrooly YAML.** Enable it only when a grower wants SaaS control.

## What it does

1. Generates an ECDSA P-256 key in **encrypted NVS** (flash encryption / NVS encryption when the board has it). The private key never leaves the ESP32-S3.
2. Shows a 6-character claim code (and the claim URL as a QR payload) on the local web UI.
3. After the owner claims the code at shroomlabs.io, submits a CSR and stores the short-lived client cert.
4. Opens **outbound-only** `wss://link.shroomlabs.io/api/devices/inbox` with mTLS. No inbound ports.
5. Applies cloud commands only when `cloud_enabled` is on **and** the last local change is older than the command. Offline, the stock REST UI and hub keep working.

## Enable

```yaml
external_components:
  - source: components

shroom_labs_cloud:
  api_host: link.shroomlabs.io
```

Leave this block out of production firmware if you do not want the TLS client (~22–42 KB heap, ~155 KB flash for mbedTLS if it is not already linked).

See `docs/DEVICES.md` for the threat model and Cloudflare-managed CA.
