# First-hand proof knowledge base

This folder is the source of truth for claims shroomlabs.io pages may cite. Agents writing or editing public pages must pull Autopilot limits, water and Coach alert thresholds, and MCP endpoint facts from here (or from the files these entries point at). Do not invent testing, ratings, or numbers.

## Layout

- `proof/tests/`: facts that tests verify against source
- `proof/mcp/`: MCP endpoint tests and dated live checks
- `sources/`: raw snapshots of live checks, such as a tools/list body
- `pages-index.md`: which pages may cite which entries
- `brand-ssot.md`: short, verified product facts

## Entry format

Every file under `proof/` is Markdown with YAML front matter, or a `.yaml` file, and must include:

- `claim`: the exact fact a page may state
- `evidence_type`: for example `test` or `live_mcp_check`
- `source`: a file, commit, test, or dated snapshot (string or list)
- `date`: `YYYY-MM-DD`
- `pages`: paths that may cite this entry

`scripts/lint-proof-kb.py` fails CI if an entry is missing a source or a date. Run `python3 scripts/test-proof-kb-lint.py` and `python3 scripts/lint-proof-kb.py` before you push.

## How to add or update an entry

1. Use only evidence that already exists: source in this repo, a test that asserts it, or a dated live check you actually ran.
2. Keep the original date on a historical snapshot. When you re-check the live MCP endpoint, add a new dated snapshot under `sources/` and a new proof file (or update the date and snapshot together).
3. Rebuild `pages-index.md`.
4. Do not add a number that is not in the source or the test.
