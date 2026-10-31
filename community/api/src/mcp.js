// Shroom Labs public MCP server (read-only). Streamable HTTP transport, JSON responses.
// POST /mcp with JSON-RPC 2.0. No auth, no device control, no Coach, no payments.
import seeds from "./seeds.json" with { type: "json" };
import pages from "./mcp-content.json" with { type: "json" };

const SITE = "https://shroomlabs.io";
const PROTOCOL = "2025-06-18";
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const OFF_MENU_NOTICE =
  "Off-menu profiles are educational only. Psilocybin mushrooms are illegal to grow, possess, or sell in most countries and under US federal law. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.";

const offMenu = (p) => p.pack !== "culinary" || p.restricted;
const profileUrl = (p) => `${SITE}/profiles/${p.id}`;
const c2f = (c) => Math.round((c * 9) / 5 + 32);

function stageView(s) {
  return {
    stage: s.name,
    days: s.duration_days,
    temperature_c: s.temperature_c,
    temperature_f: c2f(s.temperature_c),
    humidity_percent: s.humidity_percent,
    fresh_air: { fan_every_min: s.fan?.period_min, run_seconds: s.fan?.run_duration_s, speed_percent: s.fan?.speed_percent },
    light: { hours_per_day: s.light?.duration_hours, white_lux: s.light?.white_led_lux },
    notes: s.notes || undefined,
  };
}
function summary(p) {
  return { slug: p.id, name: p.name, species: p.species, strain: p.strain, off_menu: offMenu(p), summary: p.summary, total_days: totalDays(p), url: profileUrl(p) };
}
const totalDays = (p) => Math.round(p.stages.reduce((n, s) => n + (Number(s.duration_days) || 0), 0));
function findProfile(slug) {
  const k = String(slug || "").trim().toLowerCase().replace(/['\s_]+/g, "-");
  return seeds.find((p) => p.id === k) || seeds.find((p) => p.name.toLowerCase().replace(/['\s]+/g, "-") === k);
}
function withNotice(obj, includesOffMenu) {
  return includesOffMenu ? { legal_notice: OFF_MENU_NOTICE, ...obj } : obj;
}

const CHAMBER_GUIDES = {
  chambers: "/chambers",
  install: "/install",
  "what-happened-to-shrooly": "/what-happened-to-shrooly",
  terrashroom: "/terrashroom",
  "reuse-your-shrooly": "/reuse-your-shrooly",
  "shrooly-alternatives": "/shrooly-alternatives",
  "shrooly-faq": "/shrooly-faq",
};

export const TOOLS = [
  {
    name: "list_profiles",
    title: "List mushroom grow profiles",
    description:
      "List Shroom Labs mushroom grow profiles (species and strains such as lion's mane, pearl oyster, shiitake). Each has a slug for get_profile, total grow days and a canonical URL. Culinary only by default; set include_off_menu to also list educational Off-menu profiles (always returned with a legal notice).",
    inputSchema: {
      type: "object",
      properties: {
        include_off_menu: { type: "boolean", description: "Also include educational Off-menu profiles. Default false." },
        query: { type: "string", description: "Optional filter on name, species or tag, e.g. 'oyster' or 'beginner'." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_profile",
    title: "Get a mushroom grow profile",
    description:
      "Get the full grow recipe for one mushroom by slug (e.g. 'lions-mane', 'pearl-oyster', 'shiitake'): every stage with days, temperature (C and F), humidity, fresh air exchange (fan) and light hours, plus chamber tips and sources.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Profile slug from list_profiles, e.g. 'lions-mane'. A plain name like 'Lion's Mane' also works." } },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "search_grow_content",
    title: "Search mushroom growing guides",
    description:
      "Search Shroom Labs grow profiles, troubleshooting guides (not pinning, contamination, leggy stems, humidity and fresh air) and blog posts. Returns titles, short descriptions and canonical URLs to cite.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for, e.g. 'mushrooms not pinning' or 'oyster kit'." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Max results. Default 8." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_chamber_guide",
    title: "Get a grow chamber guide",
    description:
      "Get Shroom Labs guides for automated mushroom grow chambers: which chambers work ('chambers'), installing free OpenShrooly firmware on a Shrooly chamber ('install'), what happened to the Shrooly app ('what-happened-to-shrooly'), keeping a Terrashroom running ('terrashroom'), and more. Omit topic to list all.",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", enum: Object.keys(CHAMBER_GUIDES), description: "Which guide. Omit to list all topics." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "grow_timeline",
    title: "Mushroom grow timeline",
    description:
      "Day by day timeline for growing one mushroom: each stage with its start day, end day and conditions, and the total days from start to harvest. Use for 'how long does X take to grow'.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Profile slug or name, e.g. 'pearl-oyster'." } },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
function score(q, text) {
  const t = String(text).toLowerCase();
  return q.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
}

function notFound(slug) {
  throw new ToolError(`No profile '${slug}'. Call list_profiles for valid slugs.`);
}
class ToolError extends Error {}

export function callTool(name, args = {}) {
  switch (name) {
    case "list_profiles": {
      const inc = !!args.include_off_menu;
      const q = words(args.query);
      const list = seeds
        .filter((p) => inc || !offMenu(p))
        .filter((p) => !q.length || score(q, [p.id, p.name, p.species, ...(p.tags || [])].join(" ")) === q.length)
        .map(summary);
      return withNotice({ count: list.length, profiles: list, browse: `${SITE}/profiles` }, list.some((p) => p.off_menu));
    }
    case "get_profile": {
      const p = findProfile(args.slug) || notFound(args.slug);
      return withNotice(
        { ...summary(p), chamber_tips: p.chamber_notes || undefined, stages: p.stages.map(stageView), sources: (p.source_notes || []).map((s) => s.title) },
        offMenu(p),
      );
    }
    case "grow_timeline": {
      const p = findProfile(args.slug) || notFound(args.slug);
      let day = 0;
      const stages = p.stages.map((s) => {
        const start = day;
        day += Number(s.duration_days) || 0;
        return { stage: s.name, start_day: Math.round(start), end_day: Math.round(day), days: s.duration_days, temperature_c: s.temperature_c, humidity_percent: s.humidity_percent };
      });
      return withNotice({ name: p.name, slug: p.id, total_days: Math.round(day), stages, url: profileUrl(p) }, offMenu(p));
    }
    case "search_grow_content": {
      const q = words(args.query);
      if (!q.length) throw new ToolError("query is required");
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
      const hits = [
        ...seeds.filter((p) => !offMenu(p)).map((p) => ({ kind: "profile", title: `${p.name} grow profile`, description: p.summary, url: profileUrl(p), s: score(q, `${p.id} ${p.name} ${p.species} ${(p.tags || []).join(" ")} ${p.summary}`) * 2 })),
        ...pages.map((g) => ({ ...g, s: score(q, `${g.title} ${g.description} ${g.url}`) })),
      ]
        .filter((h) => h.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map(({ s, ...h }) => h);
      return { query: args.query, count: hits.length, results: hits };
    }
    case "get_chamber_guide": {
      const all = Object.entries(CHAMBER_GUIDES).map(([topic, path]) => {
        const g = pages.find((x) => x.url === SITE + path) || {};
        return { topic, title: g.title, description: g.description, url: SITE + path };
      });
      if (!args.topic) return { guides: all };
      const one = all.find((g) => g.topic === args.topic);
      if (!one) throw new ToolError(`Unknown topic. Use one of: ${Object.keys(CHAMBER_GUIDES).join(", ")}`);
      return one;
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}
class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function handleRpc(msg) {
  const { id, method, params = {} } = msg || {};
  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } };
  if (id === undefined) return null; // notification
  try {
    let result;
    if (method === "initialize") {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL;
      result = {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shroom-labs", title: "Shroom Labs", version: "1.0.0", websiteUrl: SITE },
        instructions: "Read-only mushroom growing data from Shroom Labs: grow profiles with stage by stage temperature, humidity, fresh air and light, grow timelines, troubleshooting guides and grow chamber guides. Cite the returned URLs.",
      };
    } else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: TOOLS };
    else if (method === "tools/call") {
      try {
        const data = callTool(params.name, params.arguments || {});
        result = { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false };
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        result = { content: [{ type: "text", text: e.message }], isError: true };
      }
    } else if (method === "resources/list") result = { resources: [] };
    else if (method === "prompts/list") result = { prompts: [] };
    else throw new RpcError(-32601, `Method not found: ${method}`);
    return { jsonrpc: "2.0", id, result };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: e.code || -32603, message: e.code ? e.message : "Internal error" } };
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};
const out = (body, status = 200, extra = {}) =>
  new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...extra } });

export const WELL_KNOWN_GOOGLE = { verification_tokens: [] };

/** Returns a Response for /mcp and /.well-known/google-connected-apps, or null. */
export async function handleMcp(request, path) {
  const method = request.method.toUpperCase();
  if (path === "/.well-known/google-connected-apps" && (method === "GET" || method === "HEAD")) return out(WELL_KNOWN_GOOGLE, 200, { "cache-control": "public, max-age=300" });
  if (path !== "/mcp" && path !== "/mcp/") return null;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (method === "GET") return out({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST. This server does not open an SSE stream." } }, 405, { allow: "POST, OPTIONS" });
  if (method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (method !== "POST") return out(null, 405, { allow: "POST, OPTIONS" });
  let body;
  try {
    body = await request.json();
  } catch {
    return out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(body)) {
    const res = body.map(handleRpc).filter(Boolean);
    return res.length ? out(res) : new Response(null, { status: 202, headers: CORS });
  }
  const res = handleRpc(body);
  return res ? out(res) : new Response(null, { status: 202, headers: CORS });
}
