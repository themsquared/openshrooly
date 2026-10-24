# Seed mushroom profiles

JSON files in this tree are the source of truth for both the **local hub** and the **community API**.

| Directory | Pack | Hub default | Commerce |
| --- | --- | --- | --- |
| `culinary/` | gourmet / medicinal | loaded | free, except `king-oyster-thick-stem` ($2.99 Stripe stub). Affiliate example links allowed. |
| `psilocybin/` | Off-menu (internal id `psilocybin`) | **disabled** (`HUB_ENABLE_PSILOCYBIN=0`) | **free only**, no affiliates, no payment providers |

Each file is schema version 1: species/strain, stages (humidity, temp, light, fan, duration, notes), and `source_notes`.

Regenerate after editing `data/generate_seeds.py`:

```bash
python3 data/generate_seeds.py
```

Do not attach paid items or affiliate links to the Off-menu pack. Psilocybin mushrooms are illegal to grow, possess, or sell in most countries and under US federal law.
