# Shroom Labs design system

Shared visual language for the on-device OpenShrooly dashboard, the local hub, shroomlabs.io, and the Expo iOS scaffold.

- `tokens.css` — CSS custom properties (dark mycelial default)
- `tokens.js` — same values for React Native / Expo

No webfonts, no CDN, no image sprites. Surfaces copy or import these files.

| Surface | How tokens land |
| --- | --- |
| On-device `webapp/` | `app/tokens.css` imported by `globals.css` |
| Local hub | `/design/tokens.css` (FastAPI mount) |
| Shroom Labs site | `community/web/public/css/tokens.css` |
| Expo app | `mobile/src/theme/tokens.js` |

Identity: dark soil, spore-green glow, mycelium gold, terracotta cap. Community/hub also use self-hosted Fraunces + Atkinson. On-device uses system fonts so the ESP32-S3 build stays offline and tiny.

Inspiration (not a copy): the original Shrooly company site at shrooly.com — glass chamber, warm harvest photography, calm home-grow tone. We do **not** use their logo, Poppins, slogans, or photos. Community and hub cards use original generated harvest JPEGs under `community/web/public/img/species/` and `hub/static/img/species/` — not firmware-embedded, not scraped from shrooly.com.
