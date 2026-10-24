# Brand and voice

Shroom Labs is the product. OpenShrooly is the firmware. Shrooly is the hardware we work with, never our name.

## Tagline

Chamber profiles for OpenShrooly.

## Product description

Shroom Labs is a library of researched mushroom grow profiles. Apply them from a Hub to a chamber running OpenShrooly.

## Positioning line

Works with Shrooly devices running OpenShrooly.

Use that line on every public surface. Never brand the product as Shrooly. Never say we sell chambers, spores, cultures, or psilocybin products.

## Names

| Name | Use |
| --- | --- |
| Profiles | Chamber recipes (humidity, temperature, FAE, light, days) |
| Hub | Local app that stores Profiles and talks to a chamber |
| Grow Coach | $3.99/month culinary coaching |
| Community | The public site and the people who rate, fork, and report |

Do not invent extra product names. Culinary is the default library browse.

## Off-menu

A small educational set of *Psilocybe* climate recipes lives in the catalog under the visitor-facing name **Off-menu**. The internal pack id stays `psilocybin`. Do not call this pack Restricted, back room, or a spore shop.

- **Not in chrome.** Header, footer nav, homepage sections, and Grow Coach never sell the pack. A quiet library filter chip and a footer wink ("A few varieties stay off the printed menu.") are the only browse affordances.
- **Off by default.** `GET /api/profiles` defaults to `pack=culinary`. Direct `/profiles/{id}.html` URLs load immediately.
- **Fully indexed.** Every Off-menu page is in `sitemap.xml` and `llms.txt`, with a full title, meta description, Open Graph tags, answer-first summary, JSON-LD, and an FAQ link. `robots.txt` allows them.
- **Legal notice, always.** The same non-modal copy sits above grow parameters, in the meta/structured description, and in `llms.txt`:

  > Psilocybin mushrooms are illegal to grow, possess or sell in most countries and in most US states under federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.

- **No commerce.** Off-menu pages stay free. No affiliates, paid items, Grow Coach upsells, or ads. Grow Coach still refuses the pack.

## Microscopy and research resources

Off-menu pages list a short "Microscopy and research resources" section after the grow parameters. Links are plain outbound URLs with `rel="nofollow noopener"`. No affiliate codes, tracking parameters, or paid placement. Label them as third-party links we do not endorse or profit from. Include one line that spore purchase and possession laws vary by state and country (some US states ban spores outright) and that spores are sold for microscopy only.

Verified live (23 Oct 2026):

- [PNW Spore](https://pnwspore.com/). Pacific Northwest Spore Co., Spokane
- [Sporeworks](https://sporeworks.com/). The Spore Works
- [Johns Hopkins CPCR publications](https://www.hopkinspsychedelic.org/publications)

Do not use em dashes or en dashes on Off-menu pages or in visitor chrome.

## Voice

Plain, direct, confident. Short sentences. Say what the thing does.

Do not use em dashes or en dashes. Do not use arrows. Do not use leverage, spearhead, excited to, unlock, seamless, or revolutionize.

Affiliate links carry this FTC disclosure:

> Some links are affiliate links. We may earn a commission if you buy through them, at no extra cost to you.

No internal or developer-facing copy on visitor pages. No env vars, token header names, or file paths in the footer.

## Social proof

Real only. Open source and MIT are real. Do not invent testimonials, ratings, or user counts.
