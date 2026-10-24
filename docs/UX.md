# UX principles

Security and UX are both required. Do not ship a secure flow that feels hostile, or a delightful flow that is unsafe.

## Product feel

Shroom Labs should read as a **2026 product**: Linear / Vercel / Arc polish with an organic, bioluminescent identity — not a generic dashboard and not a 90s serif brochure.

Owners already know the original Shrooly company site (shrooly.com): warm studio photography, a glass-front chamber, calm “grow at home” tone, function-first hardware. **Take inspiration only.** Do not copy their logo, Poppins wordmark, slogans (“grow mushrooms you can’t find anywhere”, Growing Pod, “7 days”), product shots, or trade dress. Familiar cues we *do* use: harvest language, species as beautiful objects, a window-into-the-chamber card, generous hero, no clutter.

- Dark soil, spore-green glow, mycelium gold, terracotta cap.
- Distinctive display face (**Fraunces**, self-hosted) + accessible sans (**Atkinson Hyperlegible**, self-hosted). Hero type is large; the mycelium canvas is the light, not a wallpaper.
- Glassy cards, grain, restrained motion. Respect `prefers-reduced-motion`.
- Species cards use original generated harvest photographs (self-hosted JPEGs, no CDN, not scraped from shrooly.com). On-device stays illustration-free to protect flash.
- Grow stages are timelines, not walls of text.

## Accessibility (WCAG AA)

- Contrast on body text and chips against the dark field.
- Visible `:focus-visible` rings in spore green.
- Skip link, real `<label>`s, semantic headings, `role="search"`.
- Don’t convey state with color alone (online = text + live dot).
- On-device UI stays large-type and thumb-friendly.

## Performance

- Community site: static files, self-hosted fonts with `font-display: swap`, no runtime CDNs.
- Hero canvas pauses offscreen and disables under reduced motion.
- On-device UI: **no webfonts**, no extra images, gzip-embedded. Firmware flash budget wins.

## Surfaces

| Surface | Bar |
| --- | --- |
| shroomlabs.io | Full identity: hero, cards, timelines, account |
| Local hub | Same tokens/fonts, fleet + profile cards |
| On-device | Lightweight cousin: first-run Wi-Fi / empty grow / unreachable, gauges, light timeline, grow strip, system fonts |
| Expo app | Same tokens; scaffold only |

## Grow Coach

- Culinary copy only. Price is $3.99/month, said in plain language. Never pair the page with Off-menu.
- Subscribe is one button (stub checkout). Gated tools stay hidden until paid.
- Chamber picker, learned stats, alerts, then **Approve and send to chamber**. Auto-tune is an explicit checkbox with “inside safe bounds” in the label.
- Chat shows remaining daily caps. Photo checks stay hidden until the photo provider is on, then show their cap too. Photo result always includes confidence and a next step, not color alone.
- Errors name the next action (sign in, pay, daily cap, not your device).

## Cloud claim

- The chamber shows a **large 6-character code** (and a QR that is just `https://shroomlabs.io/claim.html?code=…`). No password typed on the device.
- `/claim.html` is a single field, one button, an error that names the next step (expired → refresh on device; revoked → re-claim).
- Account lists chambers and a **Revoke** action that explains local growing still works.
- Copy: cloud is optional; local controls win if we are down.

## On-device first run

The chamber page must not open on a wall of unlabeled sliders. Wi-Fi setup shows its own network name and password on the screen, then names the next step (captive portal or `/`). Idle offers culinary presets that write `grow_*` plus the existing setpoint numbers. Unreachable says to use the same Wi-Fi or `192.168.4.1`. See [`docs/device-web.md`](device-web.md).

## Copy

Plain language. “Works with Shrooly devices running OpenShrooly.” Never brand the product as Shrooly. Off-menu legality notice is always visible on those pages. The pack is not in the main header; owners open it with the quiet library filter.
