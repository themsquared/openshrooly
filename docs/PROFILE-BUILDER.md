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

Uploads go through the `PHOTOS` R2 binding. R2 is not enabled on the account yet.

Before production photo uploads work:

1. `npx wrangler r2 bucket create shroomlabs-media`
2. Uncomment the `[[r2_buckets]]` `PHOTOS` binding in `community/api/wrangler.toml`
3. Attach `cdn.shroomlabs.io` in the dashboard if you want a public CDN

Local tests use miniflare R2 or the in-memory store. If the binding is missing in production, photo uploads return 503.

Server checks: 5 MB limit, JPEG/PNG/WebP magic bytes only (no SVG), decode and rewrite to drop EXIF/GPS, max 4096 px, random object keys, 10 uploads per user per hour.

## Off-menu

A psilocybin profile can only publish into Off-menu. It keeps the legal note and cannot include payments, affiliates, or Grow Coach. The moderator queue shows that flag.
