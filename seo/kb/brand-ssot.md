# Brand SSOT: shroomlabs.io

Last verified: 2026-11-21

Facts below are taken from this repository or from a dated live check. Anything not listed is not a citeable figure.

## Product mechanics (verified)

- Autopilot fan limits, recipe-only decisions, Coach water thresholds, and default Coach alert rules are in `seo/kb/proof/tests/`. The source of truth is `community/api/src/` plus the tests that pin those values.
- The public MCP server is `https://api.shroomlabs.io/mcp` (POST, JSON-RPC 2.0, Streamable HTTP). It is documented in `docs/MCP.md` and implemented in `community/api/src/mcp.js`. It does not take authentication and does not control devices, Coach, or payments.

## Live checks

- A tools/list check on 2026-11-21 is filed under `proof/mcp/` with the saved body in `sources/mcp-tools-list-2026-11-21.json`.

## Pages that may cite these facts

- Live site paths such as `/coach`, `/install`, and `/docs`.
- The `/ai` section in openshrooly pull request 267, once it ships: `/ai`, `/ai/grow-coach`, `/ai/autopilot`, `/ai/photo-check-and-charts`, `/ai/open-firmware`, `/ai/mcp-server`, and the related question pages.

Do not invent hardware that is not in this repository. Do not add customer names.
