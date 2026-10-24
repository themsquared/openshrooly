# Security

Shroom Labs and OpenShrooly treat **security and UX as non-negotiable**. If a change would weaken either, stop and flag it — do not ship the tradeoff quietly.

## Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| Chamber firmware / OTA | Malicious binary, MITM on update | Signed OTA when the firmware path is used; local web UI has no CDN; device stays usable offline |
| Local hub | LAN attacker applying a profile | Hub binds to the home network; no cloud required; optional community token is a hashed Bearer secret |
| Shroom Labs accounts | Credential stuffing, phishing, session theft | Passwordless default (magic link, OIDC, passkeys); httpOnly `Secure; SameSite=None` host cookies; refresh rotation; verified email before publish/buy/claim |
| Paid culinary items | Charge without entitlement | Checkout stub + entitlement row; psilocybin pack cannot take payments |
| Grow photos | Public object leak | R2 keys, no secrets in git, least-privilege Worker bindings |
| Psilocybin pack | Commerce / affiliate ToS | Validators hard-block paid + affiliates |
| Device identity | Stolen chamber / cloned cert / malicious cloud apply | On-device P-256 key; short-lived client certs; revoke + re-claim; local setpoints win |
| Grow Coach | Unpaid inference, prompt leak of another chamber, restricted-pack coaching | Entitlement + daily caps; device ownership check; culinary-only refusal; slim grounding (no raw telemetry dump); approve or opt-in auto-tune inside hard bounds |

Trust boundaries:

1. **Device** — ESP32-S3 on the LAN. Stock ESPHome REST. Cloud is opt-in: private key in encrypted NVS, outbound mTLS only. No community passwords on the chamber.
2. **Hub** — one process, SQLite. Talks to devices over HTTP on the LAN. Optional Bearer to `api.shroomlabs.io`.
3. **API** — Cloudflare Worker + D1. Cookie sessions for browsers; rotating refresh pairs for the Expo app; hub tokens are opaque hashes.
4. **Frontend** — static Netlify. CSP, no inline scripts, self-hosted fonts.

Out of scope this pass: on-device signed recipe objects, live Stripe keys, compiling the cloud component into the default 1.0.x binary.

## Auth summary

- Sign-in: email magic link (primary), Google OIDC + PKCE, Sign in with Apple (form_post; state cookie is SameSite=None so it survives the cross-site POST; session cookie stays Lax), WebAuthn passkeys.
- Passwords are optional and discouraged. If set: PBKDF2-SHA-256 **600,000** iterations (Workers have no native argon2id/scrypt) + HIBP k-anonymity range API. **Tradeoff flagged:** WASM argon2id would blow Worker CPU/size; we do not cut passwordless.
- Sessions: 30-minute `__Host-sl_session` cookie, rotation via `/api/auth/refresh`, server-side revoke, sign-out-everywhere.
- Verified email required for publish, checkout, fork, rate, report.
- Rate limits on magic/password/WebAuthn begin/TOTP confirm. Turnstile widget on login/register; Worker fails closed without a secret.
- TOTP is enforced on every sign-in path once enabled. Passkeys verify origin, rpIdHash, UP, signCount, and browser DER signatures.
- Audit rows in `security_events`.

Credentials Mike must create: see [`docs/AUTH.md`](docs/AUTH.md). **Never commit secrets.**

## Disclosure

Email security reports to the repository owner (Mike Moore / `themsquared`). Do not file public issues that include exploit details or live credentials.

We will acknowledge a valid report, fix in a private branch when needed, and credit you if you want.

## Firmware / OTA

Stock OpenShrooly OTA remains the device’s own `/update` path. When we add signed firmware later, the hub must refuse unsigned blobs. This PR does not change the coprocessor or signing.

## OWASP ASVS L2 — what we implement vs flag

Implemented: authn, session, CSRF-via-Origin allowlist + cookie flags, headers/CSP, secrets in env, input validation on profiles, least privilege on Worker bindings, audit log.

Flagged (needs live keys / later firmware):

- Live Turnstile / Resend / Google / Apple — widget and fail-closed verify are in; production still needs the Wrangler secret and Netlify site key.
- Signed OTA — firmware work, not this API.
