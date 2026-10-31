# Shroom Labs MCP server

Public, read-only MCP server so Gemini, Google Search and other agents can answer mushroom growing questions with Shroom Labs data.

- Endpoint (after deploy): `https://api.shroomlabs.io/mcp`
- Transport: MCP Streamable HTTP. `POST` JSON-RPC 2.0, JSON responses, no session, no SSE stream (`GET` returns 405, which the spec allows).
- Auth: none. Every tool is read-only.
- Code: `community/api/src/mcp.js`, routed first in `handleRequest` (no D1 needed). Data comes from the bundled profile seeds (`data/profiles`) and `src/mcp-content.json`, which `npm run bundle-seeds` builds from page titles and meta descriptions in `community/web/public`.
- Not in v1: Coach chat, device control, accounts, payments.

## Tools

| Tool | What it does |
|---|---|
| `list_profiles` | Culinary grow profiles with slug, species, total days, URL. `include_off_menu` adds Off-menu profiles; any response with one carries the legal notice. `query` filters. |
| `get_profile` | One profile by slug or name: every stage with days, temperature C and F, humidity, fan (fresh air) and light hours, chamber tips, sources. |
| `search_grow_content` | Searches culinary profiles, guides, blog posts and chamber pages. Returns title, description, canonical URL. Never returns Off-menu profiles. |
| `get_chamber_guide` | Chambers hub, Shrooly install, what happened to Shrooly, Terrashroom, reuse, alternatives, FAQ. Omit `topic` to list all. |
| `grow_timeline` | Start and end day per stage and total days to harvest. |

Off-menu rule: educational only. No affiliates, prices or Coach in any Off-menu response; `legal_notice` is always included.

## Test locally

```sh
cd community/api
npm run bundle-seeds
node --test test/mcp.test.js
npx wrangler dev            # then, in another shell:
curl -s localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"grow_timeline","arguments":{"slug":"pearl-oyster"}}}'
npx @modelcontextprotocol/inspector   # Streamable HTTP, URL http://localhost:8787/mcp
```

## Google Connected Apps next steps

1. Deploy with `ship.sh` (Worker + Netlify). Check `https://api.shroomlabs.io/mcp` answers `tools/list`.
2. In the Google console, add the app with server URL `https://api.shroomlabs.io/mcp`, auth type **No authentication**.
3. Domain verification: Google gives a token. Put it in the `verification_tokens` array in both places, then redeploy:
   - `community/api/src/mcp.js` (`WELL_KNOWN_GOOGLE`), served at `https://api.shroomlabs.io/.well-known/google-connected-apps`
   - `community/web/public/.well-known/google-connected-apps`, served at `https://shroomlabs.io/.well-known/google-connected-apps`
   Both start as `{"verification_tokens":[]}`.
4. Fill in listing details (name Shroom Labs, description below, icon `community/web/public/favicon.png`, privacy `https://shroomlabs.io/privacy`, terms `https://shroomlabs.io/tos`) and submit for review.

## Directories to submit (after the endpoint is live)

Paste this everywhere:

- Name: Shroom Labs
- URL: `https://api.shroomlabs.io/mcp` (Streamable HTTP, no auth)
- Short: Mushroom grow profiles, timelines and troubleshooting guides for home growers and smart grow chambers.
- Long: Read-only MCP server from Shroom Labs. Look up grow recipes for 30+ culinary mushrooms (temperature, humidity, fresh air and light per stage), get day by day grow timelines, search troubleshooting guides, and find guides for Shrooly and Terrashroom chambers. Free, no account.
- Repo: `https://github.com/themsquared/openshrooly` (path `docs/MCP.md`)
- Category: Knowledge / Home / Science

| Directory | Where to submit | Notes |
|---|---|---|
| mcpservers.org | https://mcpservers.org/submit | Web form. Pick "remote" server. |
| Official MCP Registry | https://registry.modelcontextprotocol.io | Publish with the `mcp-publisher` CLI and a `server.json` with a `remotes` entry. Namespace `io.shroomlabs/shroom-labs` needs DNS or HTTP verification of shroomlabs.io. Many directories sync from here, so do this one first. |
| mcp.so | https://mcp.so/submit | Web form (GitHub login). |
| Glama | https://glama.ai/mcp/servers | "Add server" from the page; supports remote servers. |
| PulseMCP | https://www.pulsemcp.com/submit | Form blocked automated checks; open in a browser. Also ingests the official registry. |
| Smithery | https://smithery.ai | Publish an existing remote URL from the dashboard. |
