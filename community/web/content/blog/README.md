# Blog posts

One markdown file per post in this folder. The file name is the URL: `do-mushrooms-need-light.md` is served at `/blog/do-mushrooms-need-light`.

`node scripts/generate-seo.js` builds `/blog`, every post page, `/blog/feed.xml`, and adds posts to `sitemap.xml`, `llms.txt`, `llms-full.txt` (not Off-menu) and `_redirects`. A post with a `date` after today (Pacific time) or `draft: true` is not built.

## Front matter

```
---
title: Do mushrooms need light? Hours, lux and color for 20 species
h1: Do mushrooms need light to grow?
description: One or two sentences, 50 to 160 characters. Used for meta and the index.
date: 2026-10-27
updated: 2026-10-27
category: Grow guide
answer: The answer-first paragraph shown under the title. Plain answer with the key numbers.
species: pearl-oyster, lions-mane
related:
  - Why your mushrooms are not pinning | /guides/mushrooms-not-pinning
howto: How to set up light for a grow
---
```

- `title` (required): page title, under about 65 characters before " | Shroom Labs".
- `h1`: on-page heading, defaults to `title`.
- `description`, `date`, `answer` (required). `updated` defaults to `date` and cannot be earlier.
- `species`: profile ids from `community/profiles/*`. Builds the species links box and JSON-LD `about`.
- `related`: `Label | /path` rows. Links to pages that do not exist yet render as plain text and print a `blog:` warning, then link up on a later build once the page exists.
- `howto`: the exact text of an `##` heading followed by a numbered list. Adds HowTo JSON-LD.
- `offmenu: true` plus `legal: Legal status checked YYYY-MM-DD: ...` for Off-menu research posts. Those get no GA and no Coach link, and the build fails on links to /coach, /chefs-line, /checkout, /buy or /account, on `$` prices and on affiliate links.
- `draft: true` keeps a post out of the build.

## Body

- `## Heading` and `### Heading`. No single `#`, the page already has the h1.
- Paragraphs, `- ` lists, `1. ` lists, `| a | b |` tables (first row is the header), `> ` notes.
- `**bold**`, `_italic_`, `` `code` ``, `[label](/path)` or `[label](https://...)`.
- An `## FAQ` (or a heading with "questions") whose `###` questions are followed by paragraphs becomes FAQPage JSON-LD.
- `## Sources` with a list of https links is required. Every number in the post should trace to a profile or a source.

The build fails on em dashes, en dashes, arrow characters and `->`, `<-`, `=>`. Write plain sentences.

## OG card

`npm run blog:og` renders `public/og/blog/<slug>.jpg` for posts without one (needs `npm ci` and Chrome). Run the generator again after it so the post points at its card.
