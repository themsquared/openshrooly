# Device identity and cloud control

Cloud control is **opt-in**. A chamber running stock OpenShrooly stays fully usable on the LAN (buttons, local web UI, hub, Home Assistant) with no account and no certificate.

## Decision (verified October 2026)

**Use Cloudflare-managed client certificates (CSR API) for production mTLS. Keep a Worker CA for local/tests and as the issuance protocol.**

| Option | Edge mTLS | Device CSR (key never leaves ESP32) | Cost | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Cloudflare-managed CA** + `POST /zones/:id/client_certificates` | Yes, all plans | Yes — API takes a CSR, returns a cert, never a private key | **$0**. API Shield is **not** required | Low: token + enable mTLS on `link.shroomlabs.io` | **Pick this** |
| Worker CA + BYOCA upload | Yes | Yes | Enterprise only (BYOCA) | Medium | Only if we outgrow the 100-cert quota |
| Worker CA without edge mTLS | No — app-layer proof only | Yes | $0 | Low | Tests / local Node. Not production |
| API Shield add-on | Extra schema/security suite | Same certs | Enterprise paid add-on | High | Not needed for mTLS |

Sources: [Client certificates](https://developers.cloudflare.com/ssl/client-certificates/), [Create client certificate](https://developers.cloudflare.com/api/resources/client_certificates/methods/create/), [API Shield plans](https://developers.cloudflare.com/api-shield/plans/).

### Why not “just a Worker CA”?

A Worker can sign certs (we do, for tests). Cloudflare will **not** request or verify those certs at the edge unless the CA is uploaded (BYOCA = Enterprise). Without that, you only have TLS to Cloudflare, not mutual TLS.

### Quota

Cloudflare-managed CA: **100 active client certs per zone** on non-Enterprise. Revoking frees a slot immediately. We keep **one active cert per device** and revoke the previous serial on rotate, so 50 chambers ≈ 50 slots.

If Mike ever needs thousands of devices or sub-day certs at huge churn, move the CA to BYOCA (Enterprise) or a $5 Worker + a tiny VPS issuer. Flag it; do not buy Enterprise for the first fifty chambers.

## Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| Device private key | Extract from flash / swap firmware | Generated on-device (P-256); stored in encrypted NVS; never in CSR, logs, or the hub |
| Enrollment | Attacker claims a stranger’s chamber | 6-char code, 15-minute TTL, hashed at rest, rate-limited; verified email required to claim |
| Cloud impersonation | Stolen hub token used as a device | Devices authenticate with a client cert, not the browser session |
| Lost / sold chamber | Previous owner still pushes setpoints | Revoke from the account; all serials die; re-claim issues a new code |
| Malicious SaaS command | Cloud applies a profile while you are mid-grow locally | Device applies a command only if cloud is enabled **and** `last_local_change` is older than `issued_at` |
| Offline / CF outage | Grow stops | Cloud is outbound-only and optional. Local REST and the hub keep working |
| Cert theft | Clone the PEM | Key stays on the ESP32. Rotation + revoke. CF + D1 both check serial |
| mTLS hostname mix-up | Browser hits `link.` and is asked for a cert | Split hosts: `api.shroomlabs.io` (people), `link.shroomlabs.io` (devices, mTLS) |

Trust boundaries:

1. **Device** — generates key, shows code, opens outbound WSS. No inbound cloud ports.
2. **SaaS** — claim, issue, rotate, revoke, queue commands, ingest telemetry.
3. **Cloudflare edge** — terminates mTLS against the managed CA; Worker still checks D1 (faster revoke than waiting on CF).
4. **Hub / browser** — never see the device key. They call the people API with cookies/Bearer.

## Protocol (short)

1. `POST /api/devices/enroll` `{ hardware_id, public_jwk }` → `claim_code`, `enroll_token`, `claim_url` (QR payload).
2. Owner signs in (verified email) → `POST /api/devices/claim` `{ code }`.
3. Device `POST /api/devices/:id/csr` `{ csr, enroll_token }` → 7-day client cert.
4. Device presents the cert on `GET /api/devices/:id/inbox` and `POST /api/devices/:id/telemetry` (`cf-cert-serial` at the edge, `x-device-cert-*` locally).
5. Silent rotate at ~3.5 days: new CSR + current cert → new cert, old serial superseded and revoked at CF.
6. `POST /api/devices/:id/revoke` (account) or `/reclaim` (device after revoke).

Commands the SaaS may queue: `apply_profile`, `setpoints`, `schedule`, `firmware_notice`. The device decides whether to apply.

## ESP32-S3 footprint

| Piece | Flash | Heap (idle / handshake) | Notes |
| --- | --- | --- | --- |
| mbedTLS client (already common if HTTPS is on) | ~155 KB if newly linked | ~42 KB default, **~22 KB** with `CONFIG_MBEDTLS_DYNAMIC_BUFFER` + free CA/config | Espressif https_request figures |
| One WSS + mTLS | — | ~24 KB idle, ~30 KB under traffic (measured WSS on S2/S3-class) | Keep **one** socket |
| P-256 key + cert in NVS | < 2 KB | — | Encrypted NVS / flash encryption |
| This component vs default firmware | **0** unless `shroom_labs_cloud:` is in YAML | 0 | Default OpenShrooly YAML does not include it |

Do **not** enable the component on the default 1.0.x build. The web UI gzip budget is already ~161 KB.

## Mike’s production checklist

```
npx wrangler secret put CF_API_TOKEN     # Zone SSL and Certificates Edit
# wrangler.toml / dashboard:
#   CF_ZONE_ID=<zone of shroomlabs.io>
# Enable mTLS on hostname link.shroomlabs.io (Cloudflare-managed CA).
# Point link.shroomlabs.io at the same Worker as api.shroomlabs.io.
# Leave DEVICE_ISSUER unset (auto → Cloudflare when the token is present).
```

Local / CI uses the Worker CA (`DEVICE_ISSUER=worker`). Never commit the CA key.

## UX

- Device: large 6-character code + claim URL (QR payload). No account password on the chamber.
- Site: `/claim.html?code=` (camera / typed). Account list + revoke.
- Copy: “Cloud is optional. Your chamber still works if we are down.”
