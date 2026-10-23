# Shroom Labs iOS app (scaffold)

Expo / React Native shell. **Not submitted to the App Store.**

- Design tokens: `src/theme/tokens.js` (from `/design/tokens.js`)
- Cloudflare API: `src/api/cloud.js` (access + refresh rotation)
- Local hub: `src/api/hub.js` (LAN only)
- Auth: Sign in with Apple is required once Google is offered — see `docs/AUTH.md`

```bash
cd mobile
# when you are ready to run a simulator:
npx expo start
```

Planned screens and push notifications: [`ROADMAP.md`](ROADMAP.md).
