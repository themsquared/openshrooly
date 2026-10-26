# shroom_labs_cloud (opt-in)

Outbound Shroom Labs pairing. Compiled into this firmware, **off until someone turns it on** from the local web page (admin login). Growing does not use this path. A cloud failure does not change local control.

## What it does

1. Generates an ECDSA P-256 key in NVS. The private key never leaves the ESP32-S3, is never logged, and is never sent in a CSR or to the hub.
2. `POST /api/devices/enroll` with `{ hardware_id, public_jwk, name }`.
3. Shows the 6-character claim code and `https://shroomlabs.io/claim.html?code=...` as a QR on the e-paper screen and on the local web page (behind the admin login). The code lasts 15 minutes. Refresh asks for a new one.
4. After the owner claims the code, `POST /api/devices/:id/csr` with the enroll token and proof of possession. Stores the 7-day client cert and schedules a silent rotate at 3.5 days.
5. Local Disconnect calls `POST /api/devices/:id/self-revoke` with the device key proof, then wipes the `shlcloud` NVS namespace and zeroes the key. Account revoke is noticed on the next inbox probe as `403 {"code":"revoked"}`. The chamber wipes the cert and key and shows Unlinked. An expired cert (`cert_expired`) keeps the key and renews by proof for 30 days. A bad proof (`proof_invalid`) backs off and retries. Refresh then enrolls again once the row is revoked.

From 1.0.4-sl.1 the chamber applies Autopilot `setpoints` from the inbox when `apply` is true, writes `temperature_target` / `temperature__target` and `target_humidity` (clamped 10-32 C, 60-98% RH), and POSTs telemetry with `ack_command_id` / `ack_status`. Inbox is polled about every 15 minutes. Telemetry is sent when acking, or on that same 15 minute cadence. Each authenticated call is nonce plus request (2 HTTPS). Typical budget is 16 connects/hour, well under 20. From 1.0.4-sl.2, after a reboot while linked, the first inbox poll and heartbeat go out together 30 to 60 s after boot, then the normal 15 minute cadence resumes (before that, a rebooted chamber sent no heartbeat until it acked a command). Errors back off. A local setpoint change after `issued_at` is acked `refused`. Turn remote apply off with `remote_apply: false`, the `SHL_CLOUD_REMOTE_APPLY=0` build flag, or POST `/cloud` `action=remote_apply_off`. Cert rotation, revoke, and relink are unchanged. `cloud_ready()` and `note_local_change()` stay the hooks.

## TLS

HTTPS to `api.shroomlabs.io` only. The built-in CA bundle is used. `setInsecure` is not used. Redirects are not followed.

## Storage

The key lives in the `shlcloud` NVS namespace. This build uses encrypted NVS when flash encryption is on. Stock OpenShrooly images do not enable flash encryption, so the key is in ordinary NVS. Treat a dumped flash image as enough to steal the key; signed OTA and physical access still matter.

## Enable

The component is in `esphome/components/cloud.yaml`. Cloud stays off until **Connect to Shroom Labs** is turned on.

See `docs/DEVICES.md`. If that file and the Worker disagree, the Worker wins.

## OTA to 1.0.4-sl.1

Signed update from 1.0.3-sl.2 or later. See `docs/INSTALL.md`.

1. `device_version` is `1.0.4-sl.1` in `esphome/openshrooly.yaml`.
2. Build the OTA and factory bins.
3. Sign with the release key (`scripts/sign_release.py` / INSTALL.md).
4. Publish to the stable channel.
5. On the chamber use Update, or install the signed file.

Identity NVS is unchanged (same SHL4 layout). A chamber that is already linked keeps its cert and starts applying inbox setpoints on the next 15 minute probe. Remote apply stays on unless you turn it off.
