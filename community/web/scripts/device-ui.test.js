import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  demoDevices,
  deviceTypeLabel,
  growLine,
  renderControls,
  renderDeviceCard,
  renderDeviceCards,
  renderIdentity,
  speciesLine,
  renderCommandList,
  resultMessage,
  commandStatusLabel,
  commandPending,
  newRequestId,
} from "../public/js/device-ui.js";

const DASH = /[\u2013\u2014]/;
const pearl = demoDevices()[0];

test("device type label keeps Shrooly as the hardware name only", () => {
  assert.equal(deviceTypeLabel("shrooly_chamber"), "Shrooly chamber");
  assert.equal(deviceTypeLabel(""), "Shrooly chamber");
});

test("device cards make species and grow identity obvious", () => {
  const html = renderDeviceCards(demoDevices());
  assert.match(html, /Pleurotus ostreatus/);
  assert.match(html, /Pearl Oyster/);
  assert.match(html, /Fruiting/);
  assert.match(html, /Fruiting, day 6 of 15/);
  assert.match(html, /Grow day 20 of 29/);
  assert.match(html, /Shrooly chamber/);
  assert.match(html, /Kitchen chamber/);
  assert.match(html, /device\?id=demo-kitchen/);
  assert.match(html, /species-oyster|pearl-oyster|Pleurotus/);
  assert.doesNotMatch(html, DASH);
  assert.doesNotMatch(html, /setpoint/i);
});

test("empty device list is plain copy", () => {
  assert.match(renderDeviceCards([]), /No devices linked yet/);
});

test("device page identity and controls use chamber names, not product Shrooly", () => {
  const identity = renderIdentity(pearl);
  assert.match(identity, /What is growing/);
  assert.match(identity, /Pleurotus ostreatus/);
  assert.match(identity, /Pearl Oyster/);
  const controls = renderControls(pearl, { profiles: [pearl.profile], canWrite: true, showCoach: true });
  assert.match(controls, /Temperature \(°C\)/);
  assert.match(controls, /Humidity \(%\)/);
  assert.match(controls, /Fan speed/);
  assert.match(controls, /Light/);
  assert.match(controls, /I approve changes/);
  assert.doesNotMatch(controls, /setpoint/i);
  assert.doesNotMatch(identity + controls, DASH);
  const offMenu = renderControls({ ...pearl, off_menu: true, coach: null }, { canWrite: true, showCoach: true });
  assert.doesNotMatch(offMenu, /Coach Autopilot|Coach mode/);
});

test("offline devices keep controls read only", () => {
  const html = renderControls({ ...pearl, online: false, controllable: true }, { canWrite: false });
  assert.match(html, /disabled/);
  assert.match(html, /offline/);
});

test("grow line falls back when no profile is set", () => {
  assert.equal(speciesLine({}), "");
  assert.equal(growLine({}), "No grow selected");
});

test("account page is a short menu of collapsed sections that keeps the old hooks", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/account.html"), "utf8");
  for (const id of ["devices", "alerts", "billing", "security", "community", "your-data", "first-chamber", "who", "verified", "device-cards", "alert-prefs", "sessions", "signout", "signout-all", "mint", "my-profiles", "ents", "coach-billing", "billing-portal"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  // Menu order: Chambers, Email alerts, Billing first, then the rest, each collapsed.
  const titles = [...html.matchAll(/<details class="account-section card" id="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(titles.slice(0, 3), ["devices", "alerts", "billing"]);
  assert.doesNotMatch(html, /<details class="account-section card"[^>]* open/);
  assert.match(html, /Link your first chamber/);
  assert.match(html, />Sign out</);
  assert.doesNotMatch(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "), DASH);
});

test("account page lets people download their data and delete their account", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/account.html"), "utf8");
  for (const id of ["your-data", "export-data", "delete-account", "delete-username"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<details class="account-section card" id="your-data">/);
  // The delete button stays off until the username is typed.
  assert.match(html, /<button type="submit" class="danger" disabled>Delete my account<\/button>/);
  assert.match(html, /can't be undone/);
});

test("public device pages stay dash-free", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../public");
  for (const name of ["devices.html", "device.html"]) {
    const html = readFileSync(join(root, name), "utf8")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
    const text = html.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, DASH, name);
    assert.doesNotMatch(text, /setpoint/i, name);
  }
});

// What the API sends for a 1.0.4-sl.2 chamber: setpoints only, no firmware version reported.
const SL2_CONTROLS = {
  temperature: { supported: true, note: null },
  humidity: { supported: true, note: null },
  fan: { supported: false, note: "This chamber's firmware can't change fan speed from the cloud yet. Set it on the chamber." },
  light: { supported: false, note: "This chamber's firmware can't take light settings from the cloud yet. Set them on the chamber." },
  profile: {
    supported: true,
    mode: "translated",
    note: "This chamber's firmware can't load a whole profile, so Start this grow sends the phase's temperature and humidity targets.",
  },
};
const sl2 = { ...pearl, firmware: null, capabilities: { source: "inferred", list: ["setpoints.temperature", "setpoints.humidity"] }, controls: SL2_CONTROLS };

function tagFor(html, name) {
  return html.match(new RegExp(`<input name="${name}"[^>]*>`))[0];
}

test("controls the firmware can't take are left out, with one plain line", () => {
  const html = renderControls(sl2, { profiles: [pearl.profile], canWrite: true });
  assert.doesNotMatch(html, /name="fan_speed_percent"/);
  assert.doesNotMatch(html, /name="white_led_lux"/);
  assert.doesNotMatch(html, /data-action="light"/);
  assert.doesNotMatch(tagFor(html, "temperature_c"), /disabled/);
  assert.doesNotMatch(tagFor(html, "humidity_percent"), /disabled/);
  assert.match(html, /<button type="submit" data-action="profile">Start this grow/);
  assert.match(html, /takes fan speed and the light schedule on the chamber itself/);
  assert.match(html, /can't load a whole profile/);
  // Nothing to say about an unreported software version.
  assert.doesNotMatch(html, /not reported|Chamber software/);
  assert.doesNotMatch(html, DASH);
});

test("one Save for the climate, and every Save says what happened right under it", () => {
  const html = renderControls(pearl, { profiles: [pearl.profile], canWrite: true });
  assert.equal(html.split('data-action="climate"').length - 1, 1);
  assert.doesNotMatch(html, /data-action="setpoints"/);
  for (const action of ["profile", "climate", "light", "name"]) assert.match(html, new RegExp(`data-msg-for="${action}"`));
  // What's growing comes first and is the one primary button.
  assert.ok(html.indexOf('id="grow"') < html.indexOf('data-action="climate"'));
  assert.match(html, /<button type="submit" data-action="profile">/);
  assert.match(html, /class="secondary" data-action="climate"/);
});

test("an empty chamber gets a small icon and one next step, on the card and the page", async () => {
  const { PICK_GROW_LABEL } = await import("../public/js/device-ui.js");
  const bare = { id: "dev-new", name: "New chamber", online: true, device_type: "shrooly_chamber", reading: null };
  const card = renderDeviceCard(bare);
  assert.match(card, /mushroom-icon/);
  assert.match(card, new RegExp(PICK_GROW_LABEL.replace("'", "(&#39;|')")));
  assert.match(card, /device\?id=dev-new#grow/);
  assert.doesNotMatch(card, /No species selected|No grow selected/);
  const identity = renderIdentity(bare);
  assert.match(identity, /href="#grow"/);
  assert.match(identity, /Nothing picked yet/);
  assert.doesNotMatch(identity, /<img/);
});

test("the chart waits for two readings, and chamber-only settings fold to one line", async () => {
  const { chartReady, renderReadonlyNotes } = await import("../public/js/device-ui.js");
  assert.equal(chartReady([]), false);
  assert.equal(chartReady([{ temperature: 20 }]), false);
  assert.equal(chartReady([{ temperature: 20 }, { humidity: 90 }]), true);
  const notes = renderReadonlyNotes({ local_only: [{ label: "Wi-Fi", note: "Set on the chamber." }, { label: "Fan period", note: "Set on the chamber." }] });
  assert.match(notes, /<details/);
  assert.match(notes, /2 settings stay on the chamber itself/);
  assert.equal(renderReadonlyNotes({ local_only: [] }), "");
});

test("a chamber that reports light support keeps the light controls on", () => {
  const html = renderControls(
    { ...sl2, firmware: "2.0.0", capabilities: { source: "reported" }, controls: { ...SL2_CONTROLS, light: { supported: true, note: null } } },
    { canWrite: true }
  );
  assert.doesNotMatch(tagFor(html, "white_percent"), /disabled/);
  assert.match(html, /Chamber software 2\.0\.0/);
});

const SL5_CONTROLS = {
  ...SL2_CONTROLS,
  fan: { supported: true, note: null },
  air: { supported: true, note: null },
  light: { supported: true, schedule: true, color: true, note: null },
  stage: { supported: true, phase: true, day: true, note: null },
  profile: { supported: true, mode: "full", note: null },
};

test("a 1.0.5 chamber gets fan, fresh air, light in % with a lux preview, and its phase", async () => {
  const { luxPreview } = await import("../public/js/device-ui.js");
  const device = {
    ...sl2,
    firmware: "1.0.5-sl.1",
    controls: SL5_CONTROLS,
    chamber: { air_exchange_period_min: 20, air_exchange_run_sec: 60, grow_phase: "Pinning", grow_day: 9 },
    chamber_light: { sunrise_hour: 7, duration_hours: 12, white_led_lux: 1165, white_percent: 50, red_percent: 0, green_percent: 0, blue_percent: 80 },
  };
  const html = renderControls(device, { canWrite: true });
  assert.match(tagFor(html, "air_exchange_period_min"), /value="20"/);
  assert.match(tagFor(html, "air_exchange_run_sec"), /value="60"/);
  assert.match(tagFor(html, "white_percent"), /value="50"/);
  assert.match(html, /About 1164 lux/);
  assert.match(html, /<option value="Pinning" selected>/);
  assert.match(tagFor(html, "grow_day"), /value="9"/);
  for (const action of ["air", "light", "stage"]) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.doesNotMatch(html, /Fan period and run time stay on the chamber/);
  assert.doesNotMatch(html, /on the chamber itself for now/);
  assert.equal(luxPreview(20), "About 92 lux");
  assert.match(luxPreview(100), /4000 lux \(the most/);
  assert.doesNotMatch(html, DASH);
});

test("air and phase controls stay hidden until the chamber reports them", () => {
  const html = renderControls(sl2, { canWrite: true });
  assert.doesNotMatch(html, /name="air_exchange_period_min"/);
  assert.doesNotMatch(html, /name="grow_phase"/);
  const offline = renderControls({ ...sl2, controls: SL5_CONTROLS, chamber: {} }, { canWrite: false });
  assert.match(tagFor(offline, "air_exchange_run_sec"), /disabled/);
});

test("command states read plainly and queued is never called applied", () => {
  assert.equal(commandStatusLabel("queued"), "Queued, waiting for the chamber");
  assert.equal(commandStatusLabel("delivered"), "Delivered, not confirmed yet");
  assert.equal(commandStatusLabel("applied"), "Applied, confirmed by the chamber");
  assert.equal(commandStatusLabel("expired"), "Expired");
  assert.ok(commandPending({ status: "queued" }));
  assert.ok(commandPending({ status: "delivered" }));
  assert.ok(!commandPending({ status: "applied" }));
  const html = renderCommandList([
    { id: 2, kind: "apply_profile", status: "delivered", summary: "Profile lions-mane, fruiting", reason: "This chamber's firmware can't run profile commands, so it will not be applied.", issued_at: "2026-10-25T19:14:08Z" },
    { id: 1, kind: "setpoints", status: "applied", summary: "17 °C, 90% RH", issued_at: "2026-10-25T19:05:00Z" },
  ]);
  assert.match(html, /Delivered, not confirmed yet/);
  assert.match(html, /can't run profile commands/);
  assert.match(html, /Applied, confirmed by the chamber/);
  assert.match(renderCommandList([]), /Nothing sent from the cloud yet/);
  const queued = resultMessage({ status: "queued", command_id: 5 });
  assert.equal(queued, "Sent. Your chamber picks it up in about 15 minutes.");
  assert.doesNotMatch(queued.replace(/shows as applied only after/, ""), /applied/i);
  assert.match(resultMessage({ status: "queued", deduped: true }), /already sent/);
  assert.match(resultMessage({ status: "failed", error: "No light from the cloud." }), /No light/);
});

test("each submit gets its own request id", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.ok(a && b && a !== b);
});

test("each grow fact shows once on the identity card and the device card", async () => {
  const { growingLabels, deviceMetaLine } = await import("../public/js/device-ui.js");
  const lion = {
    id: "dev-lion",
    name: "Mike's chamber",
    device_type: "shrooly_chamber",
    online: true,
    last_seen_at: new Date().toISOString(),
    profile: { id: "lions-mane", name: "Lion's Mane", species: "Hericium erinaceus", strain: "Standard" },
    stage: { name: "Fruiting" },
    grow: { phase: "Fruiting" },
    reading: { temperature: 21.97, humidity: 88.93, reading_at: new Date().toISOString() },
    setpoints: { temperature_c: 18, humidity_percent: 90 },
  };
  const labels = growingLabels(lion);
  assert.equal(labels.title, "Lion's Mane");
  assert.equal(labels.latin, "Hericium erinaceus (Standard)");
  assert.equal(labels.phase, "Fruiting");
  // Visible text only; image alt text is for screen readers and may name both.
  const count = (html, text) => html.replace(/<[^>]*>/g, " ").split(text).length - 1;
  const identity = renderIdentity(lion);
  assert.equal(count(identity, "Lion&#39;s Mane") + count(identity, "Lion's Mane"), 1);
  assert.equal(count(identity, "Hericium erinaceus"), 1);
  assert.equal(count(identity, "Fruiting"), 1);
  const card = renderDeviceCard(lion);
  assert.equal(count(card, "Hericium erinaceus"), 1);
  assert.equal(count(card, "Fruiting"), 1);
  // The page header says what the hardware is doing, not what is growing again.
  const meta = deviceMetaLine(lion);
  assert.doesNotMatch(meta, /Hericium|Lion|Fruiting/);
  assert.match(meta, /Shrooly chamber/);
  assert.doesNotMatch(meta, /Online|Offline/);
});

test("a just linked chamber reads as waiting for its first check-in, never offline", async () => {
  const { chamberStatus, renderChamberStatus, renderDeviceCard, renderGauges, renderControls, deviceMetaLine } = await import("../public/js/device-ui.js");
  const now = Date.parse("2026-10-26T18:00:00Z");
  const fresh = { id: "d2", name: "Chamber", device_type: "shrooly_chamber", online: false, controllable: true, last_seen_at: null, linked_at: "2026-10-26T17:56:12Z", reading: null, setpoints: {} };
  const st = chamberStatus(fresh, now);
  assert.equal(st.kind, "waiting");
  assert.equal(st.label, "Waiting for first check-in");
  assert.match(st.detail, /about 15 minutes/);
  assert.match(st.detail, /plugged in and connected to Wi-Fi/);
  const late = chamberStatus(fresh, now + 60 * 60 * 1000);
  assert.equal(late.kind, "waiting");
  assert.match(late.detail, /not checked in yet/);
  const all = [renderChamberStatus(fresh, now), renderDeviceCard(fresh), renderGauges(fresh), renderControls(fresh, {}), deviceMetaLine(fresh)].join(" ");
  assert.doesNotMatch(all, /[Oo]ffline|Never seen/);
  assert.doesNotMatch(all, /[\u2013\u2014]/);
  assert.match(renderGauges(fresh), /after the first check-in/);
  assert.equal(chamberStatus({ online: true, last_seen_at: "2026-10-26T17:59:00Z" }, now).label, "Online");
  assert.equal(chamberStatus({ online: false, last_seen_at: "2026-10-26T12:00:00Z" }, now).label, "Offline");
});

test("the page connection badge never shows a status dot or says Live", () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/js/app.js"), "utf8");
  assert.doesNotMatch(app, /live: "Live"/);
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/css/style.css"), "utf8");
  assert.doesNotMatch(css, /\.live-badge\[data-state="live"\]::before/);
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/device.html"), "utf8");
  assert.ok(html.indexOf('id="device-state"') < html.indexOf('id="device-live"'));
});

test("a chamber that does not report water gets no Water tile and never n/a", async () => {
  const { renderGauges, readingLine } = await import("../public/js/device-ui.js");
  const dry = { reading: { temperature: 21.9, humidity: 88.9, reading_at: new Date().toISOString() }, setpoints: { temperature_c: 18, humidity_percent: 90 } };
  const html = renderGauges(dry);
  assert.doesNotMatch(html, /Water</);
  assert.doesNotMatch(html, /n\/a/);
  assert.match(html, /does not report its water level/);
  assert.match(html, /Measured at/);
  const wet = renderGauges({ ...dry, reading: { ...dry.reading, water_level: 64 } });
  assert.match(wet, /Water</);
  assert.match(wet, /64%/);
  const partial = renderGauges({ reading: { humidity: 80 }, setpoints: {} });
  assert.match(partial, /Not reported/);
  assert.doesNotMatch(readingLine({ reading: { humidity: 80 } }), /n\/a/);
  for (const page of ["device.html", "fleet.html", "devices.html"]) {
    assert.doesNotMatch(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public", page), "utf8"), /n\/a/);
  }
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../public/js/app.js"), "utf8");
  assert.doesNotMatch(app.slice(app.indexOf("async function renderDevices"), app.indexOf("function bulkBody")), /n\/a/);
});

test("device pages show a skeleton at once and preload their modules", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../public");
  const device = readFileSync(join(root, "device.html"), "utf8");
  assert.match(device, /id="device-skeleton"/);
  assert.match(device, /id="device-live"/);
  for (const page of ["device.html", "devices.html", "fleet.html"]) {
    const html = readFileSync(join(root, page), "utf8");
    assert.match(html, /rel="modulepreload" href="\/js\/app\.js"/);
    assert.match(html, /rel="modulepreload" href="\/js\/live\.js"/);
  }
});

test("live cache only hands a snapshot back to the same sign-in", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  // Object.keys(localStorage) is how the cache finds its entries; mirror it.
  const keysOf = () => Object.fromEntries(store);
  const realKeys = Object.keys;
  Object.keys = (o) => (o === globalThis.localStorage ? realKeys(keysOf()) : realKeys(o));
  globalThis.window = { SHROOM_LABS: { apiBase: "https://api.shroomlabs.io" } };
  try {
    const { liveCache, liveSocketUrl, ageText } = await import("../public/js/live.js");
    const { setToken } = await import("../public/js/api.js");
    setToken("token-for-alice-aaaaaaaaaaaa");
    liveCache.set("device:x", { device: { id: "x" } });
    assert.equal(liveCache.get("device:x").data.device.id, "x");
    store.set("openshrooly_token", "token-for-bob-bbbbbbbbbbbbbbb");
    assert.equal(liveCache.get("device:x"), null);
    store.set("openshrooly_token", "token-for-alice-aaaaaaaaaaaa");
    setToken("");
    assert.equal(liveCache.get("device:x"), null);
    assert.equal([...store.keys()].some((k) => k.startsWith("sl.live.")), false);
    assert.equal(liveSocketUrl("/api/live/socket", "https://api.shroomlabs.io"), "wss://api.shroomlabs.io/api/live/socket");
    assert.equal(liveSocketUrl("/api/live/socket", "http://127.0.0.1:8787"), "ws://127.0.0.1:8787/api/live/socket");
    assert.equal(ageText(new Date(Date.now() - 5 * 60000).toISOString()), "5 min ago");
  } finally {
    Object.keys = realKeys;
    delete globalThis.localStorage;
    delete globalThis.window;
  }
});

test("site CSP lets the device pages open the live socket", () => {
  const toml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../netlify.toml"), "utf8");
  const main = toml.match(/for = "\/\*"[\s\S]*?Content-Security-Policy = "([^"]+)"/)[1];
  assert.match(main, /connect-src[^;]*wss:\/\/api\.shroomlabs\.io/);
});

test("live pages wait for app.js to finish loading before the cached paint", () => {
  const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  for (const fn of ["renderDevice", "renderDevices", "renderFleet"]) {
    const re = new RegExp(`async function ${fn}\\(\\) \\{\\n(?:\\s*//[^\\n]*\\n)*\\s*await Promise\\.resolve\\(\\);`);
    assert.match(app, re, fn);
  }
});

test("a new grow's phase list defaults to the first stage", async () => {
  const { stageOptionsHtml, phaseLine } = await import("../public/js/device-ui.js");
  const stages = [{ id: "colonization", name: "Colonization" }, { id: "pinning", name: "Pinning" }, { id: "fruiting", name: "Fruiting" }];
  const fresh = stageOptionsHtml(stages, { selectedId: "fruiting", sameProfile: false });
  assert.match(fresh, /value="colonization" selected/);
  assert.match(fresh, /start here/);
  const same = stageOptionsHtml(stages, { selectedId: "fruiting", sameProfile: true });
  assert.match(same, /value="fruiting" selected/);
});

test("grow days count from 1 like the chamber, with stage day and grow day labeled apart", async () => {
  const { phaseLine, growDayLine, growDaysLine } = await import("../public/js/device-ui.js");
  // Thing One style: lion's mane, fruiting starts on grow day 22 of 33.
  const fruiting = { grow: { phase: "Fruiting", grow_day: 23, stage_day: 2, stage_days: 12, total_days: 33 } };
  assert.equal(phaseLine(fruiting), "Fruiting, day 2 of 12");
  assert.equal(growDayLine(fruiting), "Grow day 23 of 33");
  assert.equal(growDaysLine(fruiting), "Fruiting, day 2 of 12. Grow day 23 of 33");
  // The first day is day 1, never day 0, and the chamber's day is not bumped by one.
  assert.equal(phaseLine({ grow: { phase: "Colonization", grow_day: 1, stage_day: 1, stage_days: 16, total_days: 33 } }), "Colonization, day 1 of 16");
  assert.equal(growDayLine({ grow: { grow_day: 2, total_days: 33 } }), "Grow day 2 of 33");
  // A chamber that is not counting (day 0) shows no day at all.
  assert.equal(phaseLine({ grow: { phase: "Fruiting", grow_day: 0, stage_day: null } }), "Fruiting");
  assert.equal(growDayLine({ grow: { phase: "Fruiting", grow_day: 0 } }), "");
  // Past the end of the stage or grow, the count stops at the end.
  assert.equal(phaseLine({ grow: { phase: "Fruiting", stage_day: 15, stage_days: 12 } }), "Fruiting, day 12 of 12");
  assert.doesNotMatch(growDaysLine(fruiting), /[\u2013\u2014\u00b7]/);
});

test("devices empty state gives one clear next step", async () => {
  const { devicesEmptyHtml } = await import("../public/js/device-ui.js");
  const html = devicesEmptyHtml();
  assert.match(html, /href="\/claim">Link your chamber</);
  assert.match(html, /href="\/install"/);
  assert.doesNotMatch(html, /filter/i);
});

test("grow this adapts to sign in and chamber count", async () => {
  const { growThisHtml } = await import("../public/js/device-ui.js");
  assert.match(growThisHtml({ signedIn: false, next: "/profile?id=x" }), /Sign in to grow this/);
  assert.match(growThisHtml({ signedIn: true, devices: [] }), /Link a chamber to grow this/);
  assert.match(growThisHtml({ signedIn: true, devices: [{ id: "a", status: "revoked" }] }), /Link a chamber/);
  const one = growThisHtml({ signedIn: true, devices: [{ id: "a", name: "Kitchen", status: "active" }] });
  assert.match(one, /Grow this in Kitchen/);
  assert.doesNotMatch(one, /<select/);
  const two = growThisHtml({ signedIn: true, devices: [{ id: "a", name: "Kitchen" }, { id: "b", name: "<b>Shed</b>" }] });
  assert.match(two, /<select id="grow-this-device">/);
  assert.match(two, /&lt;b&gt;Shed/);
  assert.match(two, /Start from day 1/);
});

test("Autopilot log line names every knob it moved", async () => {
  const { autopilotSummary } = await import("../public/js/device-ui.js");
  assert.equal(autopilotSummary({ temperature_c: 23, humidity_percent: 93 }), "Set 23 °C and 93% RH");
  assert.equal(
    autopilotSummary({
      temperature_c: 23,
      humidity_percent: 93,
      air_exchange_speed: 30,
      air_exchange_period_min: 15,
      air_exchange_run_sec: 35,
      light_hours: 12,
      white_intensity: 90,
      grow_phase: "Pinning",
    }),
    "Set 23 °C, 93% RH, fan 30%, fresh air 35 s every 15 min, light 12 h at 90 lux and phase Pinning"
  );
});
