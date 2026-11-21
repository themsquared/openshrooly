---
id: "mcp-readonly-no-auth"
claim: "The Shroom Labs MCP server is served at POST /mcp (https://api.shroomlabs.io/mcp after deploy). It is JSON-RPC 2.0, with no authentication, no device control, no Coach, and no payments. Unit tests set serverInfo.name to shroom-labs and assert that tools/list returns exactly these five tools: get_chamber_guide, get_profile, grow_timeline, list_profiles, and search_grow_content."
evidence_type: "test"
source:
  - community/api/src/mcp.js (header comment and handleMcp), first added in commit a248a8a on 2026-10-31
  - community/api/test/mcp.test.js (initialize serverInfo.name is shroom-labs; tools/list names match the five public tools)
  - "docs/MCP.md (endpoint https://api.shroomlabs.io/mcp, Streamable HTTP, no authentication)"
date: "2026-10-31"
pages:
  - /ai/mcp-server
  - /ai
  - /docs
  - /install
---

# MCP server: public, read-only, no auth

`community/api/src/mcp.js` states: POST /mcp with JSON-RPC 2.0, no auth, no device control, no Coach, no payments. `community/api/test/mcp.test.js` calls `handleMcp` with no auth header and pins the tool list and server name.

The live 2026-11-21 check is a separate entry (`mcp-live-tools-list-2026-11-21`). Keep the two distinct: this one is what the tests verify in source.
