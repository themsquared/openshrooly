# Profile builder and community review

The hub and the community site share one graphical profile builder. People no longer paste a profile document as the main path. Advanced import and export of a profile file stays available.

## Where it is used

- Hub `/profiles` and `/profiles/{id}/edit`
- Community `/publish.html` (private save and library submit)
- Community account list of your profiles
- Moderator queue at `/moderate.html`

Device dashboards do not create profiles, so they do not host the builder.

## Two states

A private profile is usable on your chambers immediately and is visible only to you. Sending it to the community library requires a photo, a title, and a description, then a moderator approves it.

Publish states in the builder: Draft, In review, Published, or Not approved with the reason.

## What stays private

Pending and rejected profiles never appear on public profile pages, the sitemap, `llms.txt`, search, or public API lists. Their photos are never served on a public URL. Only approved profiles get static pages and indexing.

## Photo storage

Uploads go through the `PHOTOS` R2 binding (`shroomlabs-photos`). The Worker config is wired; uploads stay off until `PHOTOS_ENABLED=1`.

Before production photo uploads work:

1. `npx wrangler r2 bucket create shroomlabs-photos`
2. Deploy the Worker so the `PHOTOS` binding attaches. Do **not** enable public listing or map this bucket on a public hostname.
3. Flip `[vars] PHOTOS_ENABLED = "1"` in `community/api/wrangler.toml` (or set the same var in the dashboard) and redeploy.

User photos are served only through `/api/media`. `cdn.shroomlabs.io` is not used for grow-report, profile, or coach uploads. Pending objects live under `pending/` and are copied off that prefix on approve.

Local tests use miniflare R2 or the in-memory store. If the flag is off or storage is missing, photo uploads return 503.

Server checks: 8 MB limit, JPEG/PNG/WebP magic bytes only (no SVG/GIF), rewrite to drop EXIF/GPS, max 8192 px, random object keys, no public listing, 10 uploads per user per hour. Pending photos are served only to the uploader and moderators.

## Off-menu

A psilocybin profile can only publish into Off-menu. It keeps the legal note and cannot include payments, affiliates, or Grow Coach. The moderator queue shows that flag.
