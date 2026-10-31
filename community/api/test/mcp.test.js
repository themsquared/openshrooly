import test from "node:test";
import assert from "node:assert/strict";
import { handleMcp, TOOLS } from "../src/mcp.js";

const rpc = async (method, params, id = 1) => {
  const r = await handleMcp(new Request("https://api.shroomlabs.io/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }), "/mcp");
  return r.json();
};
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;

test("initialize and tools/list", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.serverInfo.name, "shroom-labs");
  const list = await rpc("tools/list", {});
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ["get_chamber_guide", "get_profile", "grow_timeline", "list_profiles", "search_grow_content"]);
});

test("culinary list hides Off-menu; Off-menu always carries notice", async () => {
  const r = await call("list_profiles", {});
  assert.ok(r.structuredContent.profiles.every((p) => !p.off_menu));
  assert.equal(r.structuredContent.legal_notice, undefined);
  const all = await call("list_profiles", { include_off_menu: true });
  assert.ok(all.structuredContent.legal_notice);
  const gt = await call("get_profile", { slug: "golden-teacher" });
  assert.ok(gt.structuredContent.legal_notice);
  const tl = await call("grow_timeline", { slug: "golden-teacher" });
  assert.ok(tl.structuredContent.legal_notice);
});

test("profile, timeline, search, chambers", async () => {
  const p = (await call("get_profile", { slug: "Lion's Mane" })).structuredContent;
  assert.equal(p.slug, "lions-mane");
  assert.ok(p.stages[0].temperature_f);
  const t = (await call("grow_timeline", { slug: "pearl-oyster" })).structuredContent;
  assert.equal(t.stages.at(-1).end_day, t.total_days);
  const s = (await call("search_grow_content", { query: "not pinning" })).structuredContent;
  assert.ok(s.results.some((h) => h.url.endsWith("/guides/mushrooms-not-pinning")));
  assert.ok(s.results.every((h) => !/golden-teacher|psilocybin/.test(h.url)));
  const c = (await call("get_chamber_guide", { topic: "install" })).structuredContent;
  assert.equal(c.url, "https://shroomlabs.io/install");
  assert.equal((await call("get_profile", { slug: "nope" })).isError, true);
});

test("no em or en dashes in tool text", () => {
  assert.doesNotMatch(JSON.stringify(TOOLS), /[\u2013\u2014]/);
});

test("well-known and notifications", async () => {
  const w = await handleMcp(new Request("https://api.shroomlabs.io/.well-known/google-connected-apps"), "/.well-known/google-connected-apps");
  assert.deepEqual(await w.json(), { verification_tokens: [] });
  const n = await handleMcp(new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }), "/mcp");
  assert.equal(n.status, 202);
});
