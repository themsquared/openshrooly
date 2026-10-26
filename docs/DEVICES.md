# Device identity and cloud control

Cloud control is **opt-in**. A chamber running stock OpenShrooly stays fully usable on the LAN (buttons, local web UI, hub, Home Assistant) with no account and no certificate.

## Decision (verified October 2026)

**Default production: Worker CA + app-layer proof over ordinary TLS.** Keep Cloudflare-managed edge mTLS as an optional first-ninety-devices path. Never hold two Cloudflare slots for one chamber.

| Option | Edge mTLS | Device CSR (key never leaves ESP32) | Scale | Cost | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Worker CA + TLS + D1 + proof of possession** | No: Worker verifies the cert/proof | Yes | Unlimited | **$0** | **Pick this for a growing community** |
| Cloudflare-managed CA + `POST /zones/:id/client_certificates` | Yes, all plans | Yes | **100 active certs / zone** | $0 | Optional for the first ~90 chambers |
| Rotate-without-overlap on Cloudflare only | Yes | Yes | Still 100 devices / zone | $0 | Necessary hygiene; does not grow the community |
| Multi-zone / extra hostnames (100 × N) | Yes | Yes | Linear in zones you operate | $0 + DNS/ops | Rejected: splits identity, mTLS host config, and incident response |
| Worker CA + BYOCA upload | Yes | Yes | Unlimited | Enterprise | Only if we later need edge-enforced mTLS at thousands of devices |
| $5 VPS private CA | Possible via custom origin | Yes | Unlimited | ~$5/mo + ops | Worse than a Worker CA we already run |
| API Shield add-on | Extra schema suite | Same certs | Same 100 unless Enterprise | Paid | Not needed |

Sources: [Client certificates](https://developers.cloudflare.com/ssl/client-certificates/), [Create client certificate](https://developers.cloudflare.com/api/resources/client_certificates/methods/create/), [API Shield plans](https://developers.cloudflare.com/api-shield/plans/).

### Why this is the most secure cheap option that scales

Cloudflare will **not** request or verify a Worker-signed cert at the edge unless that CA is uploaded (BYOCA = Enterprise). The free-plan cap of **100 active client certs per zone** is therefore a hard ceiling for true edge mTLS. Overlap during rotation used to burn two slots per chamber (~50 devices). We now **revoke the predecessor at Cloudflare before issuing the replacement**, so one chamber = one slot: still a 100-device community, not a growing one.

The Worker CA path keeps the important security property: **the P-256 key is born on the ESP32 and never leaves NVS**. The Worker signs a 7-day cert from a CSR. The chamber then talks to `api.shroomlabs.io` (or `link.shroomlabs.io`) over ordinary TLS and presents:

1. `x-device-cert-serial` (and optionally `x-device-cert-fingerprint`) bound to an **active**, unexpired D1 row for an **active** device, and
2. always, proof of possession: `x-device-nonce` + `x-device-proof`, an ECDSA P-256 / SHA-256 signature by the on-device key over a single-use server nonce (see below).

Client-supplied `cf-cert-*` headers are ignored. Edge identity is used only when Cloudflare itself reports `tlsClientAuth.certVerified = SUCCESS`, and proof of possession is still required. Anyone who copies a PEM or a serial from a log cannot mint a fresh proof. Revoke still kills every serial immediately in D1 (faster than waiting on Cloudflare). Local growing still works if we are down.

`GET /api/devices/ca` publishes the Worker CA PEM so firmware can pin it. The CA private key is read only from the `DEVICE_CA_KEY` secret, imported non-extractable, checked against `DEVICE_CA_CERT` at startup, and never returned or logged. If either is missing or they do not match, issuance fails closed (503); there is no ephemeral CA outside local dev stubs.

### Proof of possession (`shroomlabs-device-pop-v1`)

1. `POST /api/devices/:id/nonce` returns `{ nonce, expires_at, ttl_ms }`. Nonces are 32 random bytes, stored only as a SHA-256 hash, live **2 minutes**, are bound to that device, and at most 8 can be outstanding.
2. The device signs these lines joined by `\n`:

```
shroomlabs-device-pop-v1
<device id>
<nonce>
<METHOD>
<path>
<lowercase hex SHA-256 of the exact request body>
```

3. It sends `x-device-nonce: <nonce>` and `x-device-proof: <base64 signature>` (raw 64-byte r||s or DER). The Worker also accepts URL-safe base64.
4. The Worker verifies the signature with the device key on file, then consumes the nonce with one atomic `DELETE ... WHERE nonce_hash = ? AND device_id = ? AND expires_at > ?`. Replays, expired nonces, another device's nonce, and edits to the path or body are all refused.

### CSR rules

- At most 4,096 bytes of PEM, strict DER (definite minimal lengths, no trailing bytes), version 0.
- Key must be EC P-256 and the CSR signature must be ECDSA with SHA-256 and verify.
- The CSR key must equal the enrolled device key (rotate may introduce a new key, proven by the CSR signature plus PoP by the current key).
- Only the device id is bound into the cert (CN). Subject fields and extensions in the CSR are ignored; the Worker rebuilds the SubjectPublicKeyInfo.
- Certs live 7 days, have a 128-bit random serial (unique in D1), `CA:FALSE`, `digitalSignature`, and `clientAuth`. One active cert per device.

### Issuer selection

| `DEVICE_ISSUER` | Behavior |
| --- | --- |
| unset / `auto` | Cloudflare while `active` Cloudflare certs &lt; `CF_CERT_SOFT_CAP` (default **90**). Then Worker CA. Cloudflare API failures also fall back to Worker CA. |
| `worker` | Always Worker CA (CI, local, and the long-term scale path). |
| `cloudflare` | Always Cloudflare; no fallback. Fails if the zone is at quota. |

Rotate validates the new CSR first, so a bad CSR never kills the working cert. On the Worker CA path the new cert is issued and then the old serial is marked `superseded`. On the Cloudflare path the old Cloudflare id is deleted **before** the new cert is minted (zero overlap). The rotate call authenticates with the current serial plus PoP at the app layer, so the device can still prove possession after the Cloudflare slot is freed.

Rate limits: nonce 120 per 10 minutes per client and 60 per 10 minutes per device; claim-status (no nonce) 240 per 15 minutes per device and 720 per 15 minutes per IP; pending-claim CSR polls 240 per 15 minutes (`device-csr-poll`); CSR issue, rotate, reclaim, and self-revoke 10 per hour per device. 429 responses send `Retry-After`. Rotate and self-revoke count the hourly limit only after a valid device proof.

### Why not multi-zone?

Spreading 100-cert shards across `link-a.`, `link-b.`, extra CF zones, or extra accounts multiplies mTLS hostname config, tokens, and “which zone is this chamber in?” support. It does not improve the threat model. Prefer one Worker CA.

## Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| Device private key | Extract from flash / swap firmware | Generated on-device (P-256); stored in the `shlcloud` NVS namespace; never in CSR, logs, or the hub. Stock images do not enable flash encryption, so a USB dump can read the key (same as the Ship 9 admin password). |
| Enrollment | Attacker claims a stranger’s chamber | 6-char code, 15-minute TTL, hashed at rest, rate-limited; verified email required to claim |
| Cloud impersonation | Stolen hub token used as a device | Devices authenticate with a cert serial plus a proof signed by the device key, not the browser session |
| Stolen serial / PEM | Replay headers without the key | Proof is always required, over a single-use 2-minute server nonce, bound to device, method, path, and body |
| Enrollment hijack | Re-enroll a pending hardware id with another key | Another key always gets its own new row and code. The pending row is untouched; CSR, reclaim, and rotate need PoP by the enrolled key |
| Hardware squatting | Enroll (and even claim) a hardware id before its owner | Rows are bound to hardware id plus key (`hardware_id` stores `hw#keythumb`). The real chamber's key gets its own row, so a squat blocks nothing. Rows from before this change keep the bare hardware id and match only the same key |
| Lost / sold chamber | Previous owner still pushes setpoints | Revoke from the account; all serials die; re-claim issues a new code |
| Malicious SaaS command | Cloud applies a profile while you are mid-grow locally | Device applies a command only if cloud is enabled **and** `last_local_change` is older than `issued_at` |
| Offline / CF outage | Grow stops | Cloud is outbound-only and optional. Local REST and the hub keep working |
| Cert theft | Clone the PEM | Key stays on the ESP32. Rotation + revoke. D1 is source of truth |
| mTLS hostname mix-up | Browser hits `link.` and is asked for a cert | People stay on `api.shroomlabs.io`. Devices may use `link.` later if we re-enable optional edge mTLS for the first 90 |

Trust boundaries:

1. **Device**: generates key, shows code, opens outbound HTTPS/WSS. No inbound cloud ports.
2. **SaaS**: claim, issue, rotate, revoke, queue commands, ingest telemetry. Verifies proof/serial in the Worker.
3. **Cloudflare edge**: terminates TLS. Optional managed-CA mTLS only while under the 90-slot soft cap.
4. **Hub / browser**: never see the device key. They call the people API with cookies/Bearer.

## Protocol (short)

1. `POST /api/devices/enroll` `{ hardware_id, public_jwk }` → `claim_code`, `enroll_token`, `claim_url` (QR payload).
2. Owner signs in (verified email) → `POST /api/devices/claim` `{ code }`.
3. Device polls `POST /api/devices/:id/claim-status` `{ enroll_token }` (no nonce) every ~5 s. The reply is only `{ claimed }`. After `claimed: true` it gets a nonce and `POST /api/devices/:id/csr` `{ csr, enroll_token }` with PoP → 7-day client cert (`issuer` is `worker-ca` or `cloudflare-managed`). Optional `GET /api/devices/ca` pins the Worker CA.
4. Device calls `GET /api/devices/:id/inbox` and `POST /api/devices/:id/telemetry` with `x-device-cert-serial` plus a fresh nonce and proof on every request.
5. Silent rotate at ~3.5 days: new CSR + a serial of that device (the active serial, or a superseded serial still inside its 30-day `not_after` grace) plus PoP → new cert, then every other active serial is superseded. Otherwise `relink_required`. Watch `relink_required` volume: a bad serial table could ask every chamber to link again. The chamber confirms that code twice, an hour apart, and keeps its key.
6. Account `POST /api/devices/:id/revoke` (session). Device Disconnect calls `POST /api/devices/:id/self-revoke` with the same nonce + key proof as other device routes. Both set status=revoked, revoke certs, and audit. The chamber then wipes its key. A later Connect enrolls a new key on a new device id (old telemetry is dropped). An unauthenticated enroll never resets an owned row: hardware id alone is not enough. An enroll never deletes anything either: a revoked row keeps its history for its owner, and the slot is freed by renaming its `hardware_id` to `...~<device id>`. Relink after grace proves the registered key and keeps the owner until that owner claims the new code or removes the chamber on the site.
7. Auth errors are distinguishable JSON `code` values: `revoked` (403, wipe the key), `cert_expired` (401, keep the key and renew by proof for 30 days), `relink_required` (401, confirm twice an hour apart within 24 h then show Link again, keep the key), `relink_in_progress` (401, owner + claimed, keep the key), `proof_invalid` (401, back off and retry). Do not treat every 401 as a revoke. A nonce 404 whose body says device not found enrolls again without proof.
8. Claim-status polls do not use a nonce and do not count against the CSR issue limit. The enroll token expires with the 15-minute claim window while unclaimed and is cleared after the first cert. A leftover CSR poll while unclaimed is still capped at 240 / 15 min (`device-csr-poll`). Claim-status IP limits apply only to 404/401, and `Retry-After` is capped at 60 s so several chambers behind one router can still pair.

Rows are bound to the device key, not the hardware id, so a guessed MAC cannot squat a never-seen chamber, and an anonymous enroll of a revoked hardware id no longer deletes that chamber's history. That was the blocker for public `deviceClaiming`. What is left before flipping it on is shipping the firmware that links (B6).

Commands the SaaS may queue: `apply_profile`, `setpoints`, `schedule`, `firmware_notice`. The device decides whether to apply.

Telemetry and `last_seen_at` are the data source for a later **email alerts** ship (plan: [`docs/ALERTS.md`](ALERTS.md)). Do not implement that ship until the device web UI and signed OTA have landed. Push is a later channel, not a second pipeline.

## ESP32-S3 footprint

| Piece | Flash | Heap (idle / handshake) | Notes |
| --- | --- | --- | --- |
| mbedTLS client (already common if HTTPS is on) | ~155 KB if newly linked | ~42 KB default, **~22 KB** with `CONFIG_MBEDTLS_DYNAMIC_BUFFER` + free CA/config | Espressif https_request figures |
| One WSS + TLS |: | ~24 KB idle, ~30 KB under traffic (measured WSS on S2/S3-class) | Keep **one** socket. App-layer proof is one ECDSA sign, not a second handshake |
| P-256 key + cert in NVS | < 2 KB |: | Ordinary NVS on stock images. Encrypted NVS only when flash encryption is on. USB can dump the key. |
| This component vs default firmware | ~49 KB flash when compiled in | 16 KB task + ~22 KB QR canvas | Compiled into the default YAML, **off until Connect to Shroom Labs** |

The component is in the default 1.0.x-sl build (`esphome/components/cloud.yaml`) and stays off until the local admin toggle. That costs flash even while unused. The web UI gzip budget is already ~161 KB.

### Flash layout (proposal, not applied)

The chamber has 16 MB of flash (`docs/RECOVERY.md`). The image still uses ESPHome's 4 MB dual-OTA table: two 1,835,008-byte app slots. After pairing, one slot is about 97.2% full (~50 KB free). OTA still fits. The next feature of this size will not.

Do not flash a new table from this pairing ship. A later layout change needs its own design. Rewriting the table from the running app and writing both slots cannot survive a power cut: a bad table cannot be undone by OTA rollback, and a 6 MB ota_0 would overlap the running image and today's NVS at 0x3A0000.

A safe later plan:

1. Keep the 4 MB table until that dedicated ship.
2. Stage the copy: write the new table and the new image to unused flash above 4 MB first, then flip a single boot field. If power dies mid-write, the old table and running slot are still intact.
3. Keep USB Serial/JTAG recovery as the hard fallback (`docs/RECOVERY.md`): a full 16 MB `read_flash` / `write_flash` of a known-good image, including the old table.
4. Do not move NVS without a migrator: today's NVS lives at 0x3A0000-0x400000. A table that only sets `flash_size: 16MB` would look like a factory reset.

Until that ship, leave the 4 MB table. If an image does not fit, stop and cut scope rather than the OTA slots.

Host tests (`scripts/test_shroom_labs_cloud.py`) compile `cloud_engine.cpp` with ASan/UBSan and drive the real `handle_*()`, `store_*()`, and `loop()` code against a fake HTTPS transport, clock, NVS, and crypto. `IdfTransport` (open / write / fetch_headers / read, plus `idf_headers_ok` and `is_complete_data_received`) is the ESP-IDF adapter. A live mock HTTPS run on the IDF `linux` target or QEMU is not in CI: this tree has no exported ESP-IDF environment and no `qemu-system-xtensa`, and ESPHome's linux target is not part of the firmware workflow. The adapter rules and 16 KB cap are covered on the host.

## Mike’s production checklist

```
# Scale path (default once you outgrow ~90 chambers, or from day one):
npx wrangler secret put DEVICE_CA_KEY    # PKCS8 of the Worker CA (must match the cert)
npx wrangler secret put DEVICE_CA_CERT   # CA:TRUE, keyUsage keyCertSign + cRLSign
# wrangler.toml / dashboard:
#   DEVICE_CA_CN=Shroom Labs Device CA
#   DEVICE_ISSUER=worker
# Point api.shroomlabs.io (and optionally link.shroomlabs.io) at shroomlabs-api.
# Do not enable hostname mTLS unless you also want the optional first-90 path.

# Optional first-90 edge mTLS (leave DEVICE_ISSUER=auto):
npx wrangler secret put CF_API_TOKEN     # Zone SSL and Certificates Edit
#   CF_ZONE_ID=<zone of shroomlabs.io>
#   CF_CERT_SOFT_CAP=90
# Enable mTLS on hostname link.shroomlabs.io only if you turn this on.
```

Local / CI uses the Worker CA (`DEVICE_ISSUER=worker`). Never commit the CA key.

## Commands: capabilities and true state

The site never says "applied" when it queues a change. Every cloud write is a row in `device_commands`, and its state comes from the chamber:

| State | Meaning |
| --- | --- |
| `queued` | Saved in the cloud. The chamber has not polled its inbox since. |
| `delivered` | The chamber polled its inbox (`cloud_devices.last_inbox_at`, migration 0011) or took the command, but has not confirmed it. |
| `applied` | Confirmed: an `ack_status: applied` in telemetry, or a later reading whose targets match the command. |
| `failed` | The chamber acked `failed` or `refused` (for example "No setpoints."), or the site refused the change before sending it. |
| `expired` | Not confirmed within 24 hours (`expires_at`). Commands the firmware can't run say so in the reason. |

`GET /api/fleet/devices/:id/commands` lists recent commands with these states. The device page and fleet page show them and re-check while anything is queued or delivered.

### Capabilities

A chamber may report `firmware_version` and `capabilities` (a list of tokens) in telemetry. Tokens: `setpoints.temperature`, `setpoints.humidity`, `setpoints.fan`, `light.schedule`, `light.color`, `apply_profile`, `firmware_notice`. A chamber that reports none (1.0.4-sl.2 today) is treated as `setpoints.temperature` + `setpoints.humidity`, within the firmware clamp of 10 to 32 °C and 60 to 98 % RH intersected with the chamber's reported min/max.

The API returns `firmware`, `capabilities` and per-control `controls` on each device, and every write is checked against them:

- **Profile apply** on setpoint-only firmware becomes one `setpoints` command with the chosen phase's temperature and RH (plus fan if `setpoints.fan`). Light is skipped with a note unless `light.schedule` is reported. It also sets the chamber's active grow profile and species (Autopilot profile and alert grow tracking), so the Devices card and device page show it. If Autopilot is on and steering, Apply only switches Autopilot's target and sends nothing direct.
- **Fan-only, light, and update-notice changes** are refused with a plain message on firmware that can't take them.
- **Repeat submits**: the same `request_id`, or the same change to the same chamber within 60 seconds, returns the existing command (`deduped: true`) instead of queueing another. The buttons are disabled while a send is in flight.

### Firmware follow-ups (not changed yet)

1.0.4-sl.2's cloud apply (`plan_setpoint_command`) only handles `setpoints` with temperature and humidity. To let the site do more, the firmware needs to:

1. Report `firmware_version` and a `capabilities` list in telemetry.
2. Accept cloud writes to the existing number entities: `air_exchange_speed` (fan), `air_exchange_period_min`, `air_exchange_run_sec`, `sunrise_hour`, `light_hours`, `white_intensity`, `color_r`, `color_g`, `color_b`, plus the `grow_phase` select, and report `setpoints.fan` / `light.schedule` / `light.color` when it does.
3. Optionally handle `apply_profile` natively (and report `apply_profile`), and ack every command kind it ignores with `ack_status: refused` so nothing sits unanswered.

## UX

- Device: large 6-character code + claim URL (QR payload) after Connect to Shroom Labs. No account password on the chamber. The component is in the default 1.0.x-sl build and stays off until that toggle.
- Site: `/claim.html` explains pairing. The code form is shown for `?code=` (camera / typed) or when `deviceClaiming` is on. Account list + revoke.
- Copy: scan the QR code first. Typing the letters is the fallback. The chamber still works on your own network if cloud is off or down. If the cert is past the 30-day grace window the chamber shows Link again: "This chamber was offline too long. Press Connect to link it again."
