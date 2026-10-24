import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, decide } from "../src/alerts/engine.js";
import { growStage, fruitingDay, inQuietHours, localParts, readPrefs, readRules, updatePrefs, updateRules } from "../src/alerts/rules.js";
import { makeUnsubToken, readUnsubToken } from "../src/alerts/unsub.js";
import { alertCopy, renderEmail, FOOTER_LINE, TEST_COPY } from "../src/alerts/templates.js";
import { trackableProfile } from "../src/alerts/profiles.js";
import { base64url, fromBase64Url } from "../src/crypto.js";

const MIN = 60000;
const NOW = Date.parse("2026-07-15T18:00:00Z");
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const device = { id: "dev1", name: "Kitchen", last_seen_at: iso(NOW - MIN) };
const SET = { temperature_setpoint: 20, humidity_setpoint: 90 };

/** One reading every `step` minutes, oldest first, ending at `end` minutes ago. */
function series(values, { step = 5, end = 0, extra = SET } = {}) {
  return values.map((v, i) => ({
    created_at: iso(NOW - (end + (values.length - 1 - i) * step) * MIN),
    document: JSON.stringify({ ...extra, ...v }),
  }));
}
const temps = (list, opts) => series(list.map((t) => ({ temperature: t, humidity: 90, water_level: 60 })), opts);
const cond = (rows, rules = {}, more = {}) =>
  evaluate({ device, rows, rules, prefs: {}, now: NOW, ...more }).conditions.reduce((m, c) => ({ ...m, [c.rule]: c }), {});

test("temperature opens only after the out of range streak lasts the rule's minutes", () => {
  // set point 20, band 17 to 23. 25 minutes out (6 samples, 5 min apart) is not enough for 30.
  const short = cond(temps([20, 20, 26, 26, 26, 26, 26, 26]));
  assert.equal(short.temperature.known, true);
  assert.equal(short.temperature.open, false);
  const long = cond(temps([20, 26, 26, 26, 26, 26, 26, 26]));
  assert.equal(long.temperature.open, true);
  assert.equal(long.temperature.direction, "high");
  assert.deepEqual([long.temperature.range.min, long.temperature.range.max], [17, 23]);
  const custom = cond(temps([20, 26, 26, 26]), { temperature: { enabled: true, minutes: 10 } });
  assert.equal(custom.temperature.open, true, "shorter rule window opens sooner");
});

test("a single in range blip resets the streak, and thresholds are inclusive", () => {
  const blip = cond(temps([26, 26, 26, 26, 20, 26, 26, 26]));
  assert.equal(blip.temperature.open, false);
  const edge = cond(temps([23, 23, 23, 23, 23, 23, 23, 23]));
  assert.equal(edge.temperature.open, false, "exactly at the limit is in range");
  const low = cond(temps([16.9, 16.9, 16.9, 16.9, 16.9, 16.9, 16.9, 16.9]));
  assert.equal(low.temperature.open, true);
  assert.equal(low.temperature.direction, "low");
});

test("recovery needs ten minutes back in range", () => {
  assert.equal(cond(temps([26, 26, 26, 20])).temperature.recovered, false, "only the newest sample is in range");
  assert.equal(cond(temps([26, 26, 20, 20])).temperature.recovered, false, "5 minutes in range");
  assert.equal(cond(temps([26, 20, 20, 20])).temperature.recovered, true, "10 minutes in range");
});

test("stale or missing readings change nothing", () => {
  const stale = cond(temps([26, 26, 26, 26, 26, 26, 26, 26], { end: 45 }));
  assert.equal(stale.temperature.known, false);
  assert.equal(stale.humidity.known, false);
  const noRange = cond(series([{ temperature: 30 }], { extra: {} }));
  assert.equal(noRange.temperature.known, false);
  assert.equal(cond([{ created_at: iso(NOW), document: "{not json" }]).temperature.known, false);
});

test("humidity uses the margin and a tracked grow overrides chamber set points", () => {
  const rows = series(Array(8).fill({ temperature: 20, humidity: 80, water_level: 60 }));
  assert.equal(cond(rows).humidity.open, true, "80 is below 90 minus 8");
  assert.equal(cond(rows, { humidity: { enabled: true, minutes: 30, margin: 12 } }).humidity.open, false);
  const lions = trackableProfile("lions-mane");
  const fruitStart = fruitingDay(lions);
  const started = new Date(NOW - (fruitStart + 1) * 86400000).toISOString().slice(0, 10);
  const grow = { grow: { profile_id: "lions-mane", started_on: started } };
  const res = evaluate({ device, rows: temps(Array(8).fill(24)), rules: grow, prefs: {}, profile: lions, now: NOW });
  const t = res.conditions.find((c) => c.rule === "temperature");
  assert.equal(res.ranges.stage.id, "fruiting");
  assert.equal(t.range.source, "profile");
  assert.equal(t.open, true, "24 °C is above the lion's mane fruiting warning max");
});

test("water opens at once below the mark and recovers five points above it", () => {
  const w = (level) => cond(series([{ temperature: 20, humidity: 90, water_level: level }])).water;
  assert.equal(w(14).open, true);
  assert.equal(w(15).open, false);
  assert.equal(w(18).recovered, false, "inside the hysteresis band");
  assert.equal(w(20).recovered, true);
  const waterOnly = cond([{ created_at: iso(NOW), document: JSON.stringify({ water_level: 3 }) }]).water;
  assert.equal(waterOnly.open, true, "a water only report counts");
});

test("offline opens after the rule's minutes and recovers when the chamber reports again", () => {
  const at = (ago) => cond([], {}, { device: { ...device, last_seen_at: iso(NOW - ago * MIN) } }).offline;
  assert.equal(at(29).open, false);
  assert.equal(at(30).open, true);
  assert.equal(at(2).recovered, true);
  assert.equal(cond([], {}, { device: { ...device, last_seen_at: null } }).offline.known, false);
});

test("fruiting milestone fires on the right local day, once per grow, never for old grows", () => {
  const lions = trackableProfile("lions-mane");
  const fd = fruitingDay(lions);
  assert.equal(fd, 21, "colonization 16 plus pinning 5");
  const today = localParts(NOW, "America/Los_Angeles").date;
  const startFor = (daysAgo) => new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * 86400000).toISOString().slice(0, 10);
  const run = (daysAgo) =>
    evaluate({ device, rows: [], rules: { grow: { profile_id: "lions-mane", started_on: startFor(daysAgo) } }, prefs: {}, profile: lions, now: NOW })
      .conditions.find((c) => c.rule === "fruiting");
  assert.equal(run(20).event, false);
  assert.equal(run(21).event, true);
  assert.equal(run(23).event, true);
  assert.equal(run(24).event, false, "past the grace window");
  const c = run(21);
  const first = decide(null, c, { now: NOW, cooldownMinutes: 360 });
  assert.equal(first.notices[0].kind, "milestone");
  const again = decide(first.next, c, { now: NOW + 5 * MIN, cooldownMinutes: 360 });
  assert.equal(again.next, null, "same grow does not fire twice");
  assert.equal(growStage(lions, startFor(21), today).stage.id, "fruiting");
});

test("decide: open, dedupe, cooldown, and recovery only after an emailed open", () => {
  const out = { rule: "water", known: true, open: true, recovered: false, since: iso(NOW - 3 * MIN), value: 5 };
  const back = { ...out, open: false, recovered: true, value: 40 };
  const o1 = decide(null, out, { now: NOW, cooldownMinutes: 360 });
  assert.equal(o1.next.status, "open");
  assert.deepEqual(o1.notices.map((n) => [n.kind, n.notify]), [["open", true]]);
  assert.equal(decide(o1.next, out, { now: NOW + 5 * MIN, cooldownMinutes: 360 }).next, null, "still open: no repeat");

  const r1 = decide(o1.next, back, { now: NOW + 60 * MIN, cooldownMinutes: 360 });
  assert.deepEqual(r1.notices.map((n) => [n.kind, n.notify]), [["recovered", true]]);
  assert.equal(r1.notices[0].episode_key, o1.notices[0].episode_key);

  // Flaps again within the cooldown: recorded, not emailed; its recovery is not emailed either.
  const out2 = { ...out, since: iso(NOW + 90 * MIN) };
  const o2 = decide(r1.next, out2, { now: NOW + 95 * MIN, cooldownMinutes: 360 });
  assert.deepEqual(o2.notices.map((n) => [n.kind, n.notify, n.reason]), [["open", false, "cooldown"]]);
  const r2 = decide(o2.next, back, { now: NOW + 120 * MIN, cooldownMinutes: 360 });
  assert.equal(r2.notices[0].notify, false);

  // After the cooldown, a new episode emails again.
  const out3 = { ...out, since: iso(NOW + 400 * MIN) };
  const o3 = decide(r2.next, out3, { now: NOW + 401 * MIN, cooldownMinutes: 360 });
  assert.equal(o3.notices[0].notify, true);
  assert.notEqual(o3.notices[0].episode_key, o1.notices[0].episode_key);

  assert.equal(decide(o1.next, { rule: "water", known: false }, { now: NOW, cooldownMinutes: 360 }).next, null);
});

test("quiet hours follow the person's time zone through both DST changes", () => {
  const la = { timezone: "America/Los_Angeles", quiet: { enabled: true, start: "22:00", end: "07:00" } };
  // Spring forward: 2026-03-08 02:00 PST becomes 03:00 PDT.
  assert.equal(inQuietHours(la, Date.parse("2026-03-08T09:30:00Z")), true, "01:30 PST");
  assert.equal(inQuietHours(la, Date.parse("2026-03-08T13:59:00Z")), true, "06:59 PDT");
  assert.equal(inQuietHours(la, Date.parse("2026-03-08T14:00:00Z")), false, "07:00 PDT");
  assert.equal(inQuietHours(la, Date.parse("2026-03-08T15:00:00Z")), false, "would be 07:00 PST, is 08:00 PDT");
  assert.equal(inQuietHours(la, Date.parse("2026-03-08T05:00:00Z")), false, "21:00 PST the night before");
  // Fall back: 2026-11-01 02:00 PDT becomes 01:00 PST.
  assert.equal(inQuietHours(la, Date.parse("2026-11-01T14:30:00Z")), true, "06:30 PST");
  assert.equal(inQuietHours(la, Date.parse("2026-11-01T15:00:00Z")), false, "07:00 PST");
  assert.equal(inQuietHours(la, Date.parse("2026-11-01T14:00:00Z")), true, "06:00 PST, which was 07:00 PDT the day before");
  assert.equal(inQuietHours(la, Date.parse("2026-10-31T14:00:00Z")), false, "07:00 PDT the day before");
  assert.equal(inQuietHours(la, Date.parse("2026-11-01T05:00:00Z")), true, "22:00 PDT");
  // Europe changes on other dates (2026-10-25).
  const berlin = { timezone: "Europe/Berlin", quiet: { enabled: true, start: "23:00", end: "06:30" } };
  assert.equal(inQuietHours(berlin, Date.parse("2026-10-25T05:00:00Z")), true, "06:00 CET");
  assert.equal(inQuietHours(berlin, Date.parse("2026-10-25T05:30:00Z")), false, "06:30 CET");
  assert.equal(inQuietHours(berlin, Date.parse("2026-10-24T04:30:00Z")), false, "06:30 CEST");
  // Same day window, off, and start equal to end.
  const day = { timezone: "UTC", quiet: { enabled: true, start: "09:00", end: "17:00" } };
  assert.equal(inQuietHours(day, Date.parse("2026-07-15T12:00:00Z")), true);
  assert.equal(inQuietHours(day, Date.parse("2026-07-15T17:00:00Z")), false);
  assert.equal(inQuietHours({ ...day, quiet: { ...day.quiet, enabled: false } }, Date.parse("2026-07-15T12:00:00Z")), false);
  assert.equal(inQuietHours({ ...day, quiet: { enabled: true, start: "09:00", end: "09:00" } }, Date.parse("2026-07-15T09:00:00Z")), false);
});

test("settings validation keeps defaults sane and rejects junk", () => {
  assert.equal(readPrefs(null).cooldown_minutes, 360);
  assert.equal(readPrefs("{bad").timezone, "America/Los_Angeles");
  assert.equal(readPrefs({ timezone: "Mars/Olympus" }).timezone, "America/Los_Angeles");
  assert.throws(() => updatePrefs({}, { timezone: "Mars/Olympus" }), /time zone/);
  assert.throws(() => updatePrefs({}, { cooldown_minutes: 5 }), /cooldown/);
  assert.throws(() => updatePrefs({}, { quiet: { enabled: true, start: "25:00", end: "07:00" } }), /quiet/);
  assert.equal(updatePrefs({ email: false, unsubscribed_at: "x" }, { email: true }).unsubscribed_at, undefined);
  assert.equal(readRules(null).temperature.minutes, 30);
  assert.throws(() => updateRules({}, { temperature: { minutes: 1 } }), /temperature minutes/);
  assert.throws(() => updateRules({}, { water: { below: 100 } }), /water below/);
  assert.throws(() => updateRules({}, { grow: { profile_id: "golden-teacher", started_on: "2026-07-01" } }, (id) => Boolean(trackableProfile(id))), /culinary/);
  assert.throws(() => updateRules({}, { grow: { profile_id: "lions-mane", started_on: "soon" } }, () => true), /date/);
  const ok = updateRules({}, { grow: { profile_id: "lions-mane", started_on: "2026-07-01" }, offline: { enabled: false } }, () => true);
  assert.equal(ok.grow.profile_id, "lions-mane");
  assert.equal(ok.offline.enabled, false);
  assert.equal(trackableProfile("king-oyster-thick-stem"), null, "paid profiles cannot be tracked");
});

const ENV = { COMMUNITY_SECRET: "unit-test-only-secret" };

test("unsubscribe links verify, expire, and refuse any tampering", async () => {
  const token = await makeUnsubToken(ENV, 42, NOW);
  assert.equal(await readUnsubToken(ENV, token, NOW), 42);
  assert.equal(await readUnsubToken(ENV, token, NOW + 59 * 86400000), 42);
  assert.equal(await readUnsubToken(ENV, token, NOW + 61 * 86400000), null, "expired");
  const short = await makeUnsubToken(ENV, 42, NOW, 60);
  assert.equal(await readUnsubToken(ENV, short, NOW + 61000), null);

  const [body, sig] = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  const forge = (p) => `${base64url(new TextEncoder().encode(JSON.stringify(p)))}.${sig}`;
  assert.equal(await readUnsubToken(ENV, forge({ ...payload, u: 43 }), NOW), null, "other user");
  assert.equal(await readUnsubToken(ENV, forge({ ...payload, e: payload.e + 999999 }), NOW), null, "longer expiry");
  const flip = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(await readUnsubToken(ENV, `${body}.${flip}`, NOW), null, "bad signature");
  assert.equal(await readUnsubToken({ COMMUNITY_SECRET: "another" }, token, NOW), null, "other key");
  for (const junk of ["", "abc", "a.b.c", `${body}.`, `${token}x`.repeat(30), "<script>.x"]) {
    assert.equal(await readUnsubToken(ENV, junk, NOW), null, junk.slice(0, 20));
  }
  // Correctly signed but for another purpose.
  const { hmacSha256Hex, fromHex } = await import("../src/crypto.js");
  const key = await hmacSha256Hex(ENV.COMMUNITY_SECRET, "shroomlabs-alerts-unsub-v1");
  const other = base64url(new TextEncoder().encode(JSON.stringify({ ...payload, p: "login" })));
  const otherSig = base64url(fromHex(await hmacSha256Hex(key, other)));
  assert.equal(await readUnsubToken(ENV, `${other}.${otherSig}`, NOW), null, "wrong purpose");
});

const DASHES = /[\u2010-\u2015\u2212-]/;

test("email copy has no dashes, carries the footer, and the one click headers", () => {
  const conds = [
    ["open", { rule: "temperature", direction: "high", value: 27.5, range: { min: 12, max: 22 }, since: iso(NOW - 45 * MIN) }],
    ["recovered", { rule: "temperature", value: 18, range: { min: 12, max: 22 } }],
    ["open", { rule: "humidity", direction: "low", value: 70, range: { min: 82, max: 98 }, since: iso(NOW - 125 * MIN) }],
    ["recovered", { rule: "humidity", value: 90, range: { min: 82, max: 98 } }],
    ["open", { rule: "water", value: 5 }],
    ["recovered", { rule: "water", value: 60 }],
    ["open", { rule: "offline", value: 47 }],
    ["recovered", { rule: "offline" }],
    ["milestone", { rule: "fruiting", value: 21, profile_name: "Lion's Mane" }],
  ];
  const rows = conds.map(([kind, c]) => alertCopy(kind, c, { deviceName: "Kitchen", now: NOW, stage: { name: "Fruiting" } }));
  rows.push(TEST_COPY);
  for (const r of rows) {
    assert.doesNotMatch(`${r.title} ${r.detail}`, DASHES, r.title);
    assert.match(r.title, /^(Kitchen: |Test alert)/);
  }
  assert.match(rows[0].detail, /27\.5\u00a0°C \(82\u00a0°F\) for 45\u00a0minutes/, "numbers and units are held together with a non-breaking space");
  assert.match(rows[2].detail, /2\u00a0hours 5\u00a0minutes/);
  const links = {
    settings: "https://shroomlabs.io/account.html#alerts",
    unsubscribePage: "https://shroomlabs.io/alerts-unsub.html?token=abc",
    unsubscribePost: "https://api.shroomlabs.io/api/alerts/unsubscribe?token=abc",
  };
  const one = renderEmail([rows[4]], links);
  assert.equal(one.subject, "Kitchen: water is low");
  assert.equal(one.headers["List-Unsubscribe"], `<${links.unsubscribePost}>`);
  assert.equal(one.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  for (const part of [one.text, one.html]) {
    assert.ok(part.includes(FOOTER_LINE));
    assert.ok(part.includes(links.unsubscribePage));
  }
  const visible = one.html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visible.replace(/https?:\/\/\S+/g, ""), DASHES);
  assert.doesNotMatch(one.text.replace(/https?:\/\/\S+/g, ""), DASHES);
  assert.match(one.html, /name="viewport"/);
  assert.match(one.html, /max-width:560px/);
  const digest = renderEmail(rows.slice(0, 3), links);
  assert.equal(digest.subject, "3 chamber alerts while quiet hours were on");
  const evil = renderEmail([{ title: "<img src=x onerror=alert(1)>", detail: "&" }], links);
  assert.ok(!evil.html.includes("<img src=x"));
});
