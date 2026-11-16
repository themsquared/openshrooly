// Real device page in headless Chrome (phone size) against the real API handlers and a fake Lykyn and Shrooly.
// Checks the page a grower actually sees: the 24 hour graph is always there, the status is just a dot.
// Run: node scripts/device-page-render.e2e.mjs [--shots dir]. Exits 1 on any failure. Skips (exit 0) with no Chrome.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEB_PUBLIC || path.join(here, "../public");
const API = path.join(here, "../../api");
const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.log("device page render: skipped (no Chrome)");
  process.exit(0);
}
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const { default: puppeteer } = await import("puppeteer-core");
const { handleRequest } = await import(`${API}/src/handlers.js`);
const { call, register, signedWebhook, stripeCheckoutEvent, testEnv } = await import(`${API}/test/helpers.js`);
const { FakeChamber } = await import(`${API}/test/fake-chamber.js`);
const MIN = 60000;

async function build({ history, coach } = {}) {
  mock.timers.enable({ apis: ["Date"], now: Date.now() - 24 * 60 * MIN });
  const ctx = testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", DEVICE_ISSUER: "worker" });
  const { token, user } = await register(ctx, "grower@example.com");
  const sub = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token });
  await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: sub.data.id, itemId: sub.data.item_id, userId: me.data.user.id }));
  const seeds = JSON.parse(fs.readFileSync(`${API}/src/seeds.json`, "utf8"));
  const find = (o) => {
    if (o && typeof o === "object") {
      if (o.id === "black-oyster" && o.stages) return o;
      for (const v of Object.values(o)) {
        const r = find(v);
        if (r) return r;
      }
    }
  };
  const prof = find(seeds);
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [prof.id, JSON.stringify(prof), user.id, 1, new Date().toISOString(), new Date().toISOString()]);
  const chambers = {};
  for (const kind of ["lykyn", "shrooly"]) {
    const c = await new FakeChamber(ctx, kind).pair(token);
    await c.report();
    await call(ctx, "POST", "/api/fleet/apply", { token, body: { device_ids: [c.id], action: "apply_profile", payload: { profile_id: prof.id, stage_id: "colonization" } } });
    chambers[kind] = c;
  }
  if (history) {
    for (let i = 0; i < 96; i += 1) {
      for (const c of Object.values(chambers)) {
        c.sensor = { temperature: 21.5 + Math.sin(i / 8), humidity: 87 + Math.cos(i / 6) * 2 };
        await c.cycle();
      }
      mock.timers.tick(15 * MIN);
    }
  }
  mock.timers.reset();
  if (coach === "on") {
    for (const c of Object.values(chambers)) {
      const res = await call(ctx, "POST", "/api/fleet/apply", { token, body: { device_ids: [c.id], action: "coach_mode", payload: { mode: "autopilot", profile_id: prof.id } } });
      if (res.status >= 400) throw new Error(`coach on failed for ${c.id}: ${JSON.stringify(res.data)}`);
    }
  }
  return { ctx, token, chambers };
}

function serve(ctx, apiPort) {
  const origin = (req) => req.headers.origin || "*";
  const api = http.createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": origin(req), "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-allow-credentials": "true" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await handleRequest(r, ctx);
    const h = {};
    out.headers.forEach((v, k) => (h[k] = v));
    res.writeHead(out.status, { ...h, ...cors });
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  const web = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/js/config.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end(`window.SHROOM_LABS = { siteName: "Shroom Labs", apiBase: "http://127.0.0.1:${apiPort}", mediaBase: "", deviceClaiming: true };`);
    }
    let p = path.join(WEB, url);
    if (fs.existsSync(p + ".html")) p += ".html";
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    const type = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" }[path.extname(p)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(p));
  });
  return new Promise((resolve) => api.listen(apiPort, "127.0.0.1", () => web.listen(0, "127.0.0.1", () => resolve({ api, web, webPort: web.address().port }))));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"], headless: true });
let failures = 0;
let apiPort = 18790;

async function scenario(name, { history, unit, coach }, check) {
  const { ctx, token, chambers } = await build({ history, coach });
  const srv = await serve(ctx, apiPort++);
  try {
    for (const [kind, c] of Object.entries(chambers)) {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 1400, deviceScaleFactor: 2, isMobile: true });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.evaluateOnNewDocument((t, u) => {
        localStorage.setItem("openshrooly_token", t);
        if (u === "C" || u === "F") localStorage.setItem("sl-temp-unit", u);
      }, token, unit || "");
      await page.goto(`http://127.0.0.1:${srv.webPort}/device?id=${c.id}`, { waitUntil: "networkidle2" });
      await sleep(2500);
      // A controls-only repaint (catalog load, a Coach status update, a unit change) must not lose the graph.
      await page.evaluate(() => document.querySelector("#device-controls")?.dispatchEvent(new Event("input", { bubbles: true })));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("sl-temp-unit")));
      await sleep(500);
      const info = await page.evaluate(() => {
        const box = document.querySelector("#reading-chart-box");
        const slot = document.querySelector("#device-chart-slot");
        return {
          inSlot: Boolean(box && slot && slot.contains(box)),
          svgs: document.querySelectorAll("#reading-chart svg").length,
          height: box ? Math.round(box.getBoundingClientRect().height) : 0,
          state: document.querySelector("#device-state")?.innerText || "",
          emptyText: document.querySelector(".device-chart-state:not(.hidden)")?.innerText || "",
          skeleton: Boolean(document.querySelector(".device-chart-state:not(.hidden) .device-chart-skeleton")),
          pageText: document.body.innerText,
          legendClutter: document.querySelectorAll(".rc-key, .rc-events").length,
          statusBanner: Boolean(document.querySelector("#device-status")),
          rangeButtons: document.querySelectorAll("#reading-chart [data-hours]").length,
          liveText: document.querySelector(".sheet-live")?.innerText || "",
          tempValue: document.querySelector('input[name="temperature_c"]')?.value || "",
          tempUnitBtn: document.querySelector(".temp-unit-toggle")?.textContent || "",
        };
      });
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-${kind}.png`) });
      try {
        assert.deepEqual(errors, [], `${kind} page errors`);
        assert.ok(info.inSlot, `${kind}: the chart box is in the page between the grow and the sliders`);
        assert.ok(info.height > 60, `${kind}: the chart area has height, ${info.height}`);
        assert.doesNotMatch(info.state, /Checked in|about every 15 minutes/, `${kind}: no check-in noise at the top`);
        assert.doesNotMatch(info.pageText, /Hover or tap|No events in this range|Events in this range|Stage target\s+Setpoint|Email alerts are off/i, `${kind}: no helper text, legend or alert banner on the device page`);
        assert.equal(info.legendClutter, 0, `${kind}: no key or event list under the graph`);
        assert.equal(info.statusBanner, false, `${kind}: the email alerts banner is not on the device page`);
        check(kind, info);
        console.log(`ok   ${name} ${kind}`);
      } catch (err) {
        failures += 1;
        console.log(`FAIL ${name} ${kind}: ${err.message}`);
      }
      await page.close();
    }
  } finally {
    srv.api.close();
    srv.web.close();
  }
}

await scenario("with-history", { history: true }, (kind, info) => {
  assert.ok(info.svgs >= 1, `${kind}: the 24 hour graph is drawn`);
  assert.ok(info.rangeButtons >= 2, `${kind}: the range toggle is there`);
  assert.match(info.state, /Online/);
});
await scenario("no-history", { history: false }, (kind, info) => {
  assert.equal(info.svgs, 0);
  assert.ok(info.skeleton, `${kind}: a skeleton stands in for the graph`);
  assert.match(info.emptyText, /Readings show up here|Loading the last 24 hours/);
});
await scenario("fahrenheit", { history: true, unit: "F" }, (kind, info) => {
  assert.ok(info.svgs >= 1, `${kind}: the graph is drawn in F`);
  // The page paint uses the chamber's last reported target (20 C at first check-in in this fixture).
  assert.equal(info.tempValue, "68", `${kind}: 20 C shows as 68 F on the slider, got ${info.tempValue}`);
  assert.equal(info.tempUnitBtn, "°F", `${kind}: the unit toggle reads °F`);
  assert.match(info.liveText, /°F/);
  assert.doesNotMatch(info.liveText, /°C/);
});

await scenario("coach-on", { history: true, coach: "on" }, (kind, info) => {
  assert.ok(info.svgs >= 1, `${kind}: the 24 hour graph is drawn with Coach on`);
  assert.ok(info.rangeButtons >= 2, `${kind}: the range toggle is there with Coach on`);
  assert.ok(info.inSlot && info.height > 60, `${kind}: the graph stays visible with Coach on after a controls repaint`);
});
await scenario("coach-off", { history: true, coach: "off" }, (kind, info) => {
  assert.ok(info.svgs >= 1, `${kind}: the 24 hour graph is drawn with Coach off`);
  assert.ok(info.inSlot && info.height > 60, `${kind}: the graph stays visible with Coach off after a controls repaint`);
});
await browser.close();
console.log(failures ? `device page render: ${failures} failing` : "device page render: all passing");
process.exit(failures ? 1 : 0);
