# shroom_labs_cloud (opt-in)

Outbound Shroom Labs pairing. Compiled into this firmware, **off until someone turns it on** from the local web page (admin login). Growing does not use this path. A cloud failure does not change local control.

## What it does

1. Generates an ECDSA P-256 key in NVS. The private key never leaves the ESP32-S3, is never logged, and is never sent in a CSR or to the hub.
2. `POST /api/devices/enroll` with `{ hardware_id, public_jwk, name }`.
3. Shows the 6-character claim code and `https://shroomlabs.io/claim.html?code=...` as a QR on the e-paper screen and on the local web page (behind the admin login). The code lasts 15 minutes. Refresh asks for a new one.
4. After the owner claims the code, `POST /api/devices/:id/csr` with the enroll token and proof of possession. Stores the 7-day client cert and schedules a silent rotate at 3.5 days.
5. Local Disconnect stops the cloud link. Revoke on the account is noticed on the next inbox probe or rotate. Reclaim follows the Worker contract.

Telemetry and applying remote commands are not in this ship. `cloud_ready()`, `note_local_change()`, and the inbox probe are the hooks.

## TLS

HTTPS to `api.shroomlabs.io` only. The built-in CA bundle is used. `setInsecure` is not used. Redirects are not followed.

## Storage

The key lives in the `shlcloud` NVS namespace. This build uses encrypted NVS when flash encryption is on. Stock OpenShrooly images do not enable flash encryption, so the key is in ordinary NVS. Treat a dumped flash image as enough to steal the key; signed OTA and physical access still matter.

## Enable

The component is in `esphome/components/cloud.yaml`. Cloud stays off until **Connect to Shroom Labs** is turned on.

See `docs/DEVICES.md`. If that file and the Worker disagree, the Worker wins.
