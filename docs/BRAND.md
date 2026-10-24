# Brand

Shroom Labs is culinary-first. The public product is a library of chamber profiles for OpenShrooly — oyster, lion’s mane, shiitake, and the rest of the kitchen shelf. Marketing, Grow Coach, supplies, and affiliate copy stay on general home cultivation.

## Off-menu

A small educational set of *Psilocybe* climate recipes lives in the catalog under the visitor-facing name **Off-menu**. The internal pack id stays `psilocybin`. Do not call this pack Restricted, back room, or a spore shop.

- **Not in chrome.** Header, footer, homepage sections, and Grow Coach never name or sell the pack. A quiet library filter chip and a footer wink (“A few varieties stay off the printed menu.”) are the only browse affordances.
- **Off by default.** `GET /api/profiles` defaults to `pack=culinary`. Direct `/profiles/{id}.html` URLs load immediately.
- **Fully indexed.** Every Off-menu page is in `sitemap.xml` and `llms.txt`, with a full title, meta description, Open Graph tags, answer-first summary, JSON-LD, and an FAQ link. `robots.txt` allows them.
- **Legal notice, always.** The same non-modal copy sits above grow parameters, in the meta/structured description, and in `llms.txt`:

  > Psilocybin mushrooms are illegal to grow, possess or sell in most countries and in most US states under federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.

- **No commerce.** Off-menu pages stay free. No affiliates, paid items, Grow Coach upsells, or ads. Grow Coach still refuses the pack.

## Microscopy and research resources

Off-menu pages may list a short “Microscopy and research resources” section after the grow parameters. Links are plain outbound URLs with `rel="nofollow noopener"`. No affiliate codes, tracking parameters, or paid placement. Label them as third-party links we do not endorse or profit from. Include one line that spore purchase and possession laws vary by state and country (some US states ban spores outright) and that spores are sold for microscopy only.

Verified live (23 Oct 2026):

- [PNW Spore](https://pnwspore.com/) — Pacific Northwest Spore Co., Spokane
- [Sporeworks](https://sporeworks.com/) — The Spore Works
- [Johns Hopkins CPCR publications](https://www.hopkinspsychedelic.org/publications)

## Voice

“Works with Shrooly devices running OpenShrooly.” Never brand the product as Shrooly. Never sell spores, cultures, or psilocybin products.
