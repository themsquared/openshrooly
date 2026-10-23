# Expo iOS — phase plan

Scaffold only. No App Store binary.

1. **Auth** — Sign in with Apple + Google, passkey where iOS allows, magic-link fallback. Store rotating refresh tokens in the OS keychain, never in AsyncStorage plaintext.
2. **Fleet + live status** — discover hub on LAN, show gauges using the same tokens as the site.
3. **Apply profiles** — list entitled/free profiles from `api.shroomlabs.io`, apply via the hub.
4. **Browse / purchase** — culinary catalog; Stripe stub until live keys.
5. **Grow journal** — camera photos, later upload to `cdn.shroomlabs.io`.
6. **Push** — Expo notifications for stage auto-advance (hub-originated). Not implemented.
7. **Review** — privacy nutrition labels, Sign in with Apple (mandatory if Google is present), no tracking SDK.
