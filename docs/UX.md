# UX principles

Security and UX are both required. Do not ship a secure flow that feels hostile, or a delightful flow that is unsafe.

## Product feel

Shroom Labs should read as a **2026 product**: Linear / Vercel / Arc polish with an organic, bioluminescent identity — not a generic dashboard and not a 90s serif brochure.

Owners already know the original Shrooly company site (shrooly.com): warm studio photography, a glass-front chamber, calm “grow at home” tone, function-first hardware. **Take inspiration only.** Do not copy their logo, Poppins wordmark, slogans (“grow mushrooms you can’t find anywhere”, Growing Pod, “7 days”), product shots, or trade dress. Familiar cues we *do* use: harvest language, species as beautiful objects, a window-into-the-chamber card, generous hero, no clutter.

- Dark soil, spore-green glow, mycelium gold, terracotta cap.
- Distinctive display face (**Fraunces**, self-hosted) + accessible sans (**Atkinson Hyperlegible**, self-hosted).
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
| On-device | Lightweight cousin: gauges, light timeline, profile strip, system fonts |
| Expo app | Same tokens; scaffold only |

## Copy

Plain language. “Works with Shrooly devices running OpenShrooly.” Never brand the product as Shrooly. Restricted-pack legality notice is always visible on that pack.
