#!/usr/bin/env node
// Builds src/mcp-content.json (guide, blog and chamber page titles + descriptions) for the MCP server.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "..", "web", "public");
const pick = (html, re) => (html.match(re)?.[1] || "").replace(/\s*\|\s*Shroom Labs$/, "").replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").trim();
const page = (file, url, kind) => {
  const h = readFileSync(join(pub, file), "utf8");
  return { kind, url: "https://shroomlabs.io" + url, title: pick(h, /<title>([^<]*)/), description: pick(h, /<meta name="description" content="([^"]*)"/) };
};
const out = [];
for (const d of ["guides", "blog"]) for (const f of readdirSync(join(pub, d)).filter((f) => f.endsWith(".html"))) out.push(page(`${d}/${f}`, `/${d}/${f.replace(/\.html$/, "")}`, d === "guides" ? "guide" : "blog"));
for (const f of ["chambers", "install", "terrashroom", "what-happened-to-shrooly", "reuse-your-shrooly", "shrooly-alternatives", "shrooly-faq"]) out.push(page(`${f}.html`, `/${f}`, "chamber"));
writeFileSync(join(here, "..", "src", "mcp-content.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`bundled ${out.length} pages -> community/api/src/mcp-content.json`);
