/**
 * Coach <> device end to end. Real Worker handlers, real pairing and signed device requests, a fake
 * chamber per adapter (Lykyn, Shrooly, generic) that applies commands under its own firmware rules and
 * reports state and acks like the real firmware, and a mocked clock so late, stale, offline and
 * reconnect cases run in order. CI job: "Coach device e2e" (platform.yml). ship.sh runs it before a deploy.
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COACH_MANAGES_TARGETS, getAutopilotStatus, runAutopilotPass } from "../src/coach-autopilot.js";
import { deviceAdapter } from "../src/device-adapters.js";
import { humidityBandForStage } from "../src/autopilot-knobs.js";
import { FakeChamber } from "./fake-chamber.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const baseProfile = JSON.parse(readFileSync(join(here, "../../../data/profiles/culinary/black-oyster.json"), "utf8"));
// The same recipe with a 3 day colonization, so a stage can advance by time inside the 7 day device certificate.
const fastProfile = { ...baseProfile, stages: baseProfile.stages.map((s) => (s.id === "colonization" ? { ...s, duration_days: 3 } : s)) };
let profile = baseProfile;
const STAGE = Object.fromEntries(profile.stages.map((s) => [s.id, s]));
const START = Date.parse("2026-11-15T20:00:00Z");
const MIN = 60 * 1000;

let ctx;
let token;
let user;

function tick(ms) {
  mock.timers.tick(ms);
}

beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: START });
});
afterEach(() => {
  mock.timers.reset();
});

async function world(kinds = ["lykyn", "shrooly", "generic"], { coach = false, doc = baseProfile } = {}) {
  profile = doc;
  ctx = testEnv({ GROW_COACH_STUB: "1", FLEET_UI_ENABLED: "1", COACH_AUTOPILOT_ENABLED: "1", DEVICE_ISSUER: "worker" });
  ({ token, user } = await register(ctx, "grower@example.com"));
  const session = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const me = await call(ctx, "GET", "/api/me", { token });
  await signedWebhook(ctx, stripeCheckoutEvent({ sessionId: session.data.id, itemId: session.data.item_id, userId: me.data.user.id }));
  await ctx.db.run("INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    profile.id,
    JSON.stringify(profile),
    user.id,
    1,
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  const out = {};
  for (const kind of kinds) {
    const chamber = await new FakeChamber(ctx, kind).pair(token);
    // The first check-in: reports its state (and for Lykyn its type) so the cloud knows what it is.
    await chamber.report();
    out[kind] = chamber;
  }
  if (coach) for (const c of Object.values(out)) await coachOn(c);
  return out;
}

const apply = (chamber, action, payload) => call(ctx, "POST", "/api/fleet/apply", { token, body: { device_ids: [chamber.id], action, payload } });
const result = (res) => res.data.results[0];

async function growStage(chamber, stage) {
  const res = await apply(chamber, "profile", { profile_id: profile.id, stage });
  assert.equal(result(res).status !== "failed", true, JSON.stringify(res.data));
  return res;
}

async function coachOn(chamber) {
  const res = await apply(chamber, "coach_mode", { mode: "autopilot", profile_id: profile.id });
  assert.equal(result(res).status, "applied", JSON.stringify(res.data));
}

async function coachOff(chamber) {
  const res = await apply(chamber, "coach_mode", { mode: "advisor", profile_id: profile.id });
  assert.equal(result(res).status, "applied", JSON.stringify(res.data));
}

async function coachPass(chamber) {
  const out = await runAutopilotPass(ctx, { now: Date.now(), deviceId: chamber.id });
  return out.results[0] || {};
}

async function commands(chamber) {
  const rows = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? ORDER BY id ASC", [chamber.id]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, issued_at: r.issued_at, consumed_at: r.consumed_at, payload: JSON.parse(r.payload) }));
}

async function mode(chamber) {
  return ctx.db.one("SELECT * FROM coach_device_mode WHERE device_id=?", [chamber.id]);
}

async function rules(chamber) {
  const row = await ctx.db.one("SELECT * FROM alert_rules WHERE device_id=?", [chamber.id]);
  return row ? JSON.parse(row.document) : null;
}

/** A normal firmware cycle at a normal cadence: poll and report, then 15 minutes pass. */
async function cycle(chambers, minutes = 15) {
  for (const c of [].concat(chambers)) await c.cycle();
  tick(minutes * MIN);
}

test("harness: three chambers pair through the real endpoints and report", async () => {
  const { lykyn, shrooly, generic } = await world();
  for (const c of [lykyn, shrooly, generic]) assert.match(c.id, /^sldev_/);
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [lykyn.id]);
  assert.equal(row.device_type, "lykyn_chamber");
  assert.equal(row.status, "active");
});

// ---- Select a profile and Grow ---------------------------------------------------------------

const RECIPE_KEYS = ["air_exchange_period_min", "air_exchange_run_sec", "sunrise_hour", "light_hours", "color_r", "color_g", "color_b"];

function assertRecipe(chamber, stageId, label = chamber.kind, { skipFan = false } = {}) {
  const s = STAGE[stageId];
  const adapter = deviceAdapter(chamber.kind === "lykyn" ? "lykyn_chamber" : "shrooly_chamber");
  assert.equal(chamber.targets.temperature_c, s.temperature_c, `${label} temperature`);
  assert.equal(chamber.targets.humidity_percent, s.humidity_percent, `${label} humidity`);
  if (chamber.kind === "generic") return;
  assert.equal(chamber.knobs.air_exchange_period_min, s.fan.period_min, `${label} fresh air period`);
  assert.equal(chamber.knobs.air_exchange_run_sec, s.fan.run_duration_s, `${label} fresh air run`);
  assert.equal(chamber.knobs.sunrise_hour, s.light.sunrise_hour, `${label} sunrise`);
  assert.equal(chamber.knobs.light_hours, s.light.duration_hours, `${label} light hours`);
  assert.equal(chamber.knobs.color_b, s.light.blue_percent, `${label} blue`);
  // Fan: the profile percent, raised only to what this chamber's fan can do.
  const floor = chamber.p.ranges.air_exchange_speed[0];
  if (!skipFan) assert.equal(chamber.knobs.air_exchange_speed, Math.max(floor, s.fan.speed_percent), `${label} fan`);
  // White: percent of this chamber's maximum, in this chamber's own unit.
  const white = s.light.white_led_lux;
  if (chamber.kind === "lykyn") assert.equal(chamber.knobs.white_intensity, adapter.white.fromLux(white), `${label} white percent`);
  else assert.equal(chamber.knobs.white_intensity, Math.round(adapter.white.fromLux(white) / 5) * 5, `${label} white lux`);
}

/** The fan is on the recipe, or one step the right way for how far humidity was outside the stage band. Never the wrong way. */
function assertFanSteered(chamber, stageId, rh, label) {
  const s = STAGE[stageId];
  const floor = chamber.p.ranges.air_exchange_speed[0];
  const recipe = Math.max(floor, s.fan.speed_percent);
  const band = humidityBandForStage(s);
  const fan = chamber.knobs.air_exchange_speed;
  if (rh == null) return assert.equal(fan, recipe, `${label}: Coach never acted on humidity, so the fan is the recipe`);
  if (rh >= band.lo && rh <= band.hi) return; // a step held from earlier is allowed inside the band
  if (rh != null && rh < band.lo) assert.ok(fan <= recipe, `${label}: too dry (${rh}) but the fan is ${fan}, above the recipe ${recipe}`);
  if (rh != null && rh > band.hi) assert.ok(fan >= recipe, `${label}: too wet (${rh}) but the fan is ${fan}, below the recipe ${recipe}`);
  assert.ok(Math.abs(fan - recipe) <= 10, `${label}: fan ${fan} is more than one step from the recipe ${recipe}`);
}

for (const stage of ["colonization", "pinning", "fruiting"]) {
  test(`Grow at ${stage} puts the exact ${stage} recipe on every chamber and names the stage the way each one does`, async () => {
    const { lykyn, shrooly, generic } = await world();
    for (const c of [lykyn, shrooly, generic]) await growStage(c, stage);
    for (const c of [lykyn, shrooly, generic]) await c.cycle();
    const phase = { colonization: ["Colonization", "Colonizing"], pinning: ["Pinning", "Pinning"], fruiting: ["Fruiting", "Fruiting"] }[stage];
    assert.equal(lykyn.knobs.grow_phase, phase[0]);
    assert.equal(shrooly.knobs.grow_phase, phase[1]);
    for (const c of [lykyn, shrooly, generic]) {
      assertRecipe(c, stage);
      assert.equal(c.appliedLog.every((a) => a.status === "applied"), true, `${c.kind} refused something: ${JSON.stringify(c.appliedLog)}`);
    }
    for (const c of [lykyn, shrooly, generic]) {
      const row = await rules(c);
      assert.equal(row.grow.profile_id, profile.id, "the grow is tracked");
      assert.ok(row.grow.started_on, "with a start date");
    }
  });
}

// ---- Coach stage always equals the chamber's stage -------------------------------------------

const CANON = { Colonization: "colonization", Colonizing: "colonization", Pinning: "pinning", Fruiting: "fruiting" };

function drift(chamber, { dt = 0, dh = 0 } = {}) {
  const t = chamber.targets;
  chamber.sensor = { temperature: t.temperature_c + dt, humidity: t.humidity_percent + dh };
}

for (const stage of ["colonization", "pinning", "fruiting"]) {
  test(`Coach steers ${stage} and the chamber shows ${stage}, on every cycle, Colonizing and Colonization alike`, async () => {
    const { lykyn, shrooly, generic } = await world(["lykyn", "shrooly", "generic"]);
    for (const c of [lykyn, shrooly, generic]) {
      await growStage(c, stage);
      await c.cycle();
      await coachOn(c);
    }
    const lastRh = new Map();
    for (let i = 0; i < 6; i += 1) {
      tick(15 * MIN);
      for (const c of [lykyn, shrooly, generic]) {
        // Readings wander around the target, both ways.
        drift(c, { dt: i % 2 ? 1.5 : -1.5, dh: i % 3 === 0 ? -6 : 4 });
        await c.cycle();
        // Humidity swings above and below the band every cycle. Everything but the fan must stay on the recipe,
        // and the fan may only be where steering for the humidity Coach last saw would put it.
        assertRecipe(c, stage, `${c.kind} on cycle ${i}`, { skipFan: true });
        if (c.kind !== "generic") assertFanSteered(c, stage, lastRh.get(c.kind), `${c.kind} on cycle ${i}`);
        const out = await coachPass(c);
        if (out.applied) lastRh.set(c.kind, c.sensor.humidity); // the humidity Coach acted on
        if (c.kind !== "generic") {
          assert.equal(CANON[c.knobs.grow_phase], stage, `${c.kind} device stage on cycle ${i}`);
        }
        if (out.stage) assert.equal(out.stage, stage, `${c.kind} Coach stage on cycle ${i}: ${JSON.stringify(out)}`);
        assert.notEqual(out.paused, true, JSON.stringify(out));
        assert.equal((await mode(c)).mode, "autopilot", `${c.kind} Coach stayed on`);
      }
    }
    for (const c of [lykyn, shrooly, generic]) assert.equal(c.appliedLog.some((a) => a.status === "refused"), false, `${c.kind}: ${JSON.stringify(c.appliedLog.filter((a) => a.status === "refused"))}`);
  });
}

test("stage advance by time sends the whole recipe in one change and keeps the start date", async () => {
  const { shrooly } = await world(["shrooly"], { doc: fastProfile });
  await growStage(shrooly, "colonization");
  await shrooly.cycle();
  await coachOn(shrooly);
  const before = await rules(shrooly);
  // Three days of colonization go by. The chamber counts its own days: day 4 is the first pinning day.
  tick(3 * 24 * 60 * MIN);
  shrooly.setLocal({ grow_day: 4 });
  shrooly.sensor = { temperature: STAGE.pinning.temperature_c, humidity: STAGE.pinning.humidity_percent };
  await shrooly.report();
  const sent = (await commands(shrooly)).length;
  const out = await coachPass(shrooly);
  assert.equal(out.applied, true, JSON.stringify(out));
  assert.equal(out.stage, "pinning");
  const all = await commands(shrooly);
  assert.equal(all.length, sent + 1, "one change, not a staircase");
  const cmd = all.at(-1).payload;
  const s = STAGE.pinning;
  assert.equal(cmd.grow_phase, "Pinning");
  assert.equal(cmd.temperature_c, s.temperature_c);
  assert.equal(cmd.humidity_percent, s.humidity_percent);
  assert.equal(cmd.air_exchange_period_min, s.fan.period_min);
  assert.equal(cmd.air_exchange_run_sec, s.fan.run_duration_s);
  assert.equal(cmd.light_hours, s.light.duration_hours);
  assert.equal(cmd.color_b, s.light.blue_percent);
  assert.ok(cmd.air_exchange_speed != null && cmd.white_intensity != null);
  await shrooly.cycle();
  assert.equal(shrooly.knobs.grow_phase, "Pinning");
  assertRecipe(shrooly, "pinning");
  assert.deepEqual((await rules(shrooly)).grow, before.grow, "start date and profile untouched");
});

test("a grower who moves the grow back to an earlier stage is not pushed forward again by the grow day", async () => {
  const { shrooly } = await world(["shrooly"]);
  await growStage(shrooly, "fruiting");
  await shrooly.cycle();
  // Day 25 of the grow; the grower picks Colonization again (for example a re-spawn). The day says fruiting.
  shrooly.setLocal({ grow_day: 25 });
  await growStage(shrooly, "colonization");
  await shrooly.cycle();
  shrooly.setLocal({ grow_day: 25 });
  await coachOn(shrooly);
  for (let i = 0; i < 4; i += 1) {
    tick(15 * MIN);
    await shrooly.cycle();
    const out = await coachPass(shrooly);
    if (out.stage) assert.equal(out.stage, "colonization", JSON.stringify(out));
  }
  assert.equal(shrooly.knobs.grow_phase, "Colonizing");
});

test("a Coach pass waits for a stage the grower just applied instead of steering around it", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  await growStage(lykyn, "fruiting"); // queued, the chamber has not pulled it yet
  const before = (await commands(lykyn)).length;
  const out = await coachPass(lykyn);
  assert.equal(out.skipped, "pending_grower", JSON.stringify(out));
  assert.equal((await commands(lykyn)).length, before, "Coach queued nothing");
  await lykyn.cycle();
  assertRecipe(lykyn, "fruiting");
  tick(15 * MIN);
  const after = await coachPass(lykyn);
  assert.notEqual(after.skipped, "pending_grower");
  if (after.stage) assert.equal(after.stage, "fruiting");
});

// ---- Coach drives to the target, never moves it, never nudges and idles ----------------------

for (const kind of ["lykyn", "shrooly"]) {
  test(`${kind}: Coach puts the profile targets back straight away after a local change, and never sends another number`, async () => {
    const { [kind]: c } = await world([kind]);
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
    const s = STAGE.colonization;
    // Hands-on change at the chamber: wrong targets, readings far off.
    c.setLocal({ temperature_c: 22, humidity_percent: 80 });
    c.sensor = { temperature: 21, humidity: 78 };
    tick(15 * MIN);
    await c.cycle();
    const first = await coachPass(c);
    assert.equal(first.applied, true, JSON.stringify(first));
    await c.cycle();
    assert.equal(c.targets.temperature_c, s.temperature_c, "temperature back on the profile in one change");
    assert.equal(c.targets.humidity_percent, s.humidity_percent, "humidity back on the profile in one change");
    // Many cycles of readings all over the place: every command carries the profile's number or none.
    const ups = [60, 99, 72, 94, 85, 97, 70];
    for (let i = 0; i < ups.length; i += 1) {
      tick(15 * MIN);
      c.sensor = { temperature: 15 + i * 2, humidity: ups[i] };
      await c.cycle();
      await coachPass(c);
    }
    for (const cmd of await commands(c)) {
      if (cmd.payload.source !== "grow-coach-autopilot") continue;
      if (cmd.payload.temperature_c != null) assert.equal(cmd.payload.temperature_c, s.temperature_c, `command ${cmd.id} temperature`);
      if (cmd.payload.humidity_percent != null) assert.equal(cmd.payload.humidity_percent, s.humidity_percent, `command ${cmd.id} humidity`);
    }
    assert.equal(c.targets.temperature_c, s.temperature_c);
    assert.equal(c.targets.humidity_percent, s.humidity_percent);
  });
}

test("a stale local change is corrected within the next pass even right after Coach's last change (no hour of idling)", async () => {
  const { shrooly } = await world(["shrooly"], { coach: false });
  await growStage(shrooly, "pinning");
  await shrooly.cycle();
  await coachOn(shrooly);
  shrooly.setLocal({ humidity_percent: 80 });
  tick(MIN);
  await shrooly.cycle();
  const a = await coachPass(shrooly);
  assert.equal(a.applied, true, JSON.stringify(a));
  await shrooly.cycle();
  shrooly.setLocal({ humidity_percent: 70 }); // changed again a minute later
  tick(MIN);
  await shrooly.cycle();
  const b = await coachPass(shrooly);
  assert.equal(b.applied, true, `Coach did not wait out an interval: ${JSON.stringify(b)}`);
  await shrooly.cycle();
  assert.equal(shrooly.targets.humidity_percent, STAGE.pinning.humidity_percent);
});

// ---- Stale, expired, late and superseded commands --------------------------------------------

async function coachCommand(chamber) {
  // Hands-on drift makes Coach queue a correction.
  chamber.setLocal({ temperature_c: 22 });
  chamber.sensor = { temperature: 21, humidity: chamber.targets.humidity_percent };
  await chamber.report();
  const out = await coachPass(chamber);
  assert.equal(out.applied, true, JSON.stringify(out));
  return out.command_id;
}

for (const kind of ["lykyn", "shrooly"]) {
  test(`${kind}: a Coach change the chamber could not pull in time is never applied, even when it shows up later`, async () => {
    const { [kind]: c } = await world([kind]);
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
    tick(MIN);
    const id = await coachCommand(c);
    const targetsBefore = { ...c.targets };
    // The chamber is offline for 40 minutes (queued Autopilot changes live for 35), then reconnects.
    c.offline = true;
    tick(40 * MIN);
    c.offline = false;
    const handed = await c.poll();
    assert.deepEqual(handed.map((h) => h.id), [], "nothing stale is handed to the chamber");
    assert.deepEqual(c.targets, targetsBefore, "the chamber still runs what it had");
    const row = (await commands(c)).find((x) => x.id === id);
    assert.equal(row.payload._ack.status, "expired");
  });
}

test("a Coach change queued before the grower picks a stage is dropped, not applied after it", async () => {
  const { shrooly } = await world(["shrooly"]);
  await growStage(shrooly, "fruiting");
  await shrooly.cycle();
  await coachOn(shrooly);
  tick(MIN);
  const staleId = await coachCommand(shrooly); // a fruiting change, not pulled yet
  await growStage(shrooly, "colonization"); // grower moves the grow back before it is pulled
  const handed = await shrooly.poll();
  assert.equal(handed.some((h) => h.id === staleId), false, "the older Coach change is not handed out");
  await shrooly.report();
  assertRecipe(shrooly, "colonization");
  assert.equal(shrooly.knobs.grow_phase, "Colonizing");
  const row = (await commands(shrooly)).find((x) => x.id === staleId);
  assert.equal(row.payload._ack?.status, "expired");
});

test("a change the chamber pulled in time but reported one check-in later is recorded as applied, not expired", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  tick(MIN);
  lykyn.sensor = { temperature: 24, humidity: 85 }; // humidity low: Coach wants the fan down
  lykyn.setLocal({ air_exchange_speed: 60 });
  await lykyn.report();
  const out = await coachPass(lykyn);
  assert.equal(out.applied, true, JSON.stringify(out));
  const id = out.command_id;
  tick(34 * MIN);
  const handed = await lykyn.poll(); // pulled at minute 34, applied, report not sent yet
  assert.deepEqual(handed.map((h) => h.id), [id]);
  tick(2 * MIN);
  // The cloud's sweep runs past the 35 minute mark while the report is still on its way.
  const sweep = await coachPass(lykyn);
  assert.notEqual(sweep.error, true);
  assert.equal((await commands(lykyn)).find((x) => x.id === id).payload._ack?.status, undefined, "not written off while the chamber holds it");
  const again = await lykyn.poll();
  assert.equal(again.some((h) => h.id === id), false, "never handed out twice");
  tick(13 * MIN);
  await lykyn.report(); // the next check-in carries the ack
  const finished = (await commands(lykyn)).find((x) => x.id === id);
  assert.equal(finished.payload._ack.status, "applied");
  assert.equal(JSON.parse((await mode(lykyn)).last_setpoints).air_exchange_speed ?? JSON.parse((await mode(lykyn)).last_setpoints).fan_speed_percent, lykyn.knobs.air_exchange_speed);
});

test("an ack that arrives after the cloud wrote the command off is recorded truthfully", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  tick(MIN);
  lykyn.sensor = { temperature: 24, humidity: 85 };
  lykyn.setLocal({ air_exchange_speed: 60 });
  await lykyn.report();
  const out = await coachPass(lykyn);
  const id = out.command_id;
  tick(14 * MIN);
  await lykyn.poll(); // applied at minute 14
  // No report for a long time: past the wait for a delivered change, the cloud writes it off.
  tick(60 * MIN);
  await coachPass(lykyn);
  assert.equal((await commands(lykyn)).find((x) => x.id === id).payload._ack?.status, "expired");
  await lykyn.report(); // the ack finally arrives
  const row = (await commands(lykyn)).find((x) => x.id === id);
  assert.equal(row.payload._ack.status, "applied", "the chamber did apply it; the record says so");
  assert.match(row.payload._ack.reason, /late/i);
});

// ---- Offline and reconnect --------------------------------------------------------------------

test("an offline chamber leaves Coach on and locked; on reconnect Coach puts the profile back", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  for (const c of [lykyn, shrooly]) {
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
  }
  for (const c of [lykyn, shrooly]) {
    c.offline = true;
    c.setLocal({ humidity_percent: 80 });
  }
  const sent = { lykyn: (await commands(lykyn)).length, shrooly: (await commands(shrooly)).length };
  for (let i = 0; i < 4; i += 1) {
    tick(15 * MIN);
    for (const c of [lykyn, shrooly]) {
      const out = await coachPass(c);
      // Readings are only called stale after 20 minutes; before that the cloud simply sees nothing to fix.
      if (i > 0) assert.equal(out.skipped, "waiting", JSON.stringify(out));
      assert.equal((await mode(c)).mode, "autopilot", `${c.kind}: Coach is still on after ${(i + 1) * 15} minutes offline`);
      const edit = await apply(c, "setpoints", { temperature_c: 20 });
      assert.equal(result(edit).status, "failed");
      assert.equal(result(edit).error, COACH_MANAGES_TARGETS, "targets stay locked while Coach is waiting");
    }
  }
  assert.equal((await commands(lykyn)).length, sent.lykyn, "nothing queued blind");
  for (const c of [lykyn, shrooly]) {
    c.offline = false;
    await c.cycle();
    const out = await coachPass(c);
    assert.equal(out.applied, true, `${c.kind} reconnect: ${JSON.stringify(out)}`);
    await c.cycle();
    assert.equal(c.targets.humidity_percent, STAGE.colonization.humidity_percent);
    assert.equal(CANON[c.knobs.grow_phase], "colonization");
  }
});

test("a chamber whose Coach was switched on keeps being reported as Coach on through a long outage", async () => {
  const { shrooly } = await world(["shrooly"]);
  await growStage(shrooly, "pinning");
  await shrooly.cycle();
  await coachOn(shrooly);
  shrooly.offline = true;
  for (let i = 0; i < 8; i += 1) {
    tick(30 * MIN);
    await coachPass(shrooly);
  }
  const status = await getAutopilotStatus(ctx.db, ctx, user, shrooly.id);
  assert.equal(status.mode, "autopilot");
  assert.notEqual(status.status, "paused");
});

// ---- Values the firmware refuses -------------------------------------------------------------

test("fan 33 is a valid value everywhere: the cloud snaps it to what each chamber's fan can take, nothing is refused", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  for (const [c, expected] of [[lykyn, 33], [shrooly, 35]]) {
    const res = await apply(c, "setpoints", { fan_speed_percent: 33 });
    assert.notEqual(result(res).status, "failed", JSON.stringify(res.data));
    await c.cycle();
    assert.equal(c.knobs.air_exchange_speed, expected, `${c.kind} fan`);
    assert.equal(c.appliedLog.at(-1).status, "applied");
  }
  // Below what the fan can do: raised to its floor, not refused.
  for (const [c, floor] of [[lykyn, 33], [shrooly, 15]]) {
    const res = await apply(c, "setpoints", { fan_speed_percent: 5 });
    assert.notEqual(result(res).status, "failed", JSON.stringify(res.data));
    await c.cycle();
    assert.equal(c.knobs.air_exchange_speed, floor);
  }
});

test("temperature and humidity follow each chamber's own range and step with no refusals", async () => {
  const { lykyn, shrooly, generic } = await world();
  for (const c of [lykyn, shrooly, generic]) {
    const res = await apply(c, "setpoints", { temperature_c: 21.3, humidity_percent: 88.7 });
    assert.notEqual(result(res).status, "failed", `${c.kind}: ${JSON.stringify(res.data)}`);
    await c.cycle();
    assert.equal(c.appliedLog.at(-1).status, "applied", `${c.kind}: ${JSON.stringify(c.appliedLog.at(-1))}`);
    assert.ok(Math.abs(c.targets.temperature_c - 21.3) <= 0.25, `${c.kind} temperature ${c.targets.temperature_c}`);
    assert.ok(Math.abs(c.targets.humidity_percent - 88.7) <= 0.25, `${c.kind} humidity ${c.targets.humidity_percent}`);
  }
});

test("when the chamber refuses a stage change, Coach does not retry it, steer another stage, or call the chamber in sync", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  tick(MIN);
  await growStage(lykyn, "fruiting");
  const queued = (await commands(lykyn)).at(-1);
  lykyn.refuseIds.set(queued.id, "phase change refused");
  await lykyn.cycle();
  assert.equal(CANON[lykyn.knobs.grow_phase], "colonization", "the chamber stayed where it was");
  const status = (await commands(lykyn)).find((x) => x.id === queued.id).payload._ack.status;
  assert.equal(status, "refused");
  const before = (await commands(lykyn)).length;
  tick(30 * MIN);
  await lykyn.cycle();
  const out = await coachPass(lykyn);
  assert.equal(out.skipped, "phase_apply_failed", JSON.stringify(out));
  assert.equal((await commands(lykyn)).length, before, "Coach queued nothing around the refusal");
  assert.equal(CANON[lykyn.knobs.grow_phase], "colonization");
});

// ---- Percent is a share of that chamber's own maximum -----------------------------------------

test("light percent means the same share of each chamber's maximum, in each chamber's own unit", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  const light = { sunrise_hour: 8, duration_hours: 12, white_percent: 50, red_percent: 0, green_percent: 0, blue_percent: 25 };
  for (const c of [lykyn, shrooly]) {
    const res = await apply(c, "light", { light });
    assert.notEqual(result(res).status, "failed", `${c.kind}: ${JSON.stringify(res.data)}`);
    await c.cycle();
    const type = c.kind === "lykyn" ? "lykyn_chamber" : "shrooly_chamber";
    assert.equal(deviceAdapter(type).white.toPercent(c.knobs.white_intensity), 50, `${c.kind} white reads back as 50 percent`);
    assert.equal(c.knobs.color_b, 25, `${c.kind} blue percent`);
    assert.equal(c.knobs.light_hours, 12);
    assert.equal(c.appliedLog.at(-1).status, "applied");
  }
  assert.equal(lykyn.knobs.white_intensity, 50, "Lykyn stores percent");
  assert.equal(shrooly.knobs.white_intensity, 2000, "Shrooly stores lux: 50 percent of 4000");
});

test("a profile's physical light target becomes each chamber's own percent and says so when a chamber tops out", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  await growStage(lykyn, "pinning");
  await growStage(shrooly, "pinning");
  await lykyn.cycle();
  await shrooly.cycle();
  const lux = STAGE.pinning.light.white_led_lux;
  assert.equal(lykyn.knobs.white_intensity, deviceAdapter("lykyn_chamber").white.fromLux(lux));
  assert.equal(shrooly.knobs.white_intensity, Math.round(lux / 5) * 5);
  const lykynPct = deviceAdapter("lykyn_chamber").white.toPercent(lykyn.knobs.white_intensity);
  const shroolyPct = deviceAdapter("shrooly_chamber").white.toPercent(shrooly.knobs.white_intensity);
  assert.ok(lykynPct > shroolyPct * 5, "the same lux is a much bigger share of the small Lykyn ring");
});

// ---- Manual edits while Coach is on, and getting control back ---------------------------------

const MANUAL_EDITS = [
  ["setpoints", { temperature_c: 20 }],
  ["setpoints", { humidity_percent: 80 }],
  ["setpoints", { fan_speed_percent: 33 }],
  ["light", { light: { sunrise_hour: 8, duration_hours: 12, white_percent: 50, red_percent: 0, green_percent: 0, blue_percent: 0 } }],
  ["stage", { grow_phase: "Fruiting" }],
];

test("every manual slider edit is refused while Coach is on, nothing is queued, and the chamber is untouched", async () => {
  const { lykyn, shrooly, generic } = await world(["lykyn", "shrooly", "generic"]);
  for (const c of [lykyn, shrooly, generic]) {
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
    const before = (await commands(c)).length;
    const targets = { ...c.targets };
    for (const [action, payload] of MANUAL_EDITS) {
      // A chamber with no fan control says so first; that is still a refusal, nothing is queued.
      const res = await apply(c, action, payload);
      assert.equal(result(res).status, "failed", `${c.kind} ${action}: ${JSON.stringify(res.data)}`);
      if (!(c.kind === "generic" && (payload.fan_speed_percent != null || payload.light))) assert.equal(result(res).error, COACH_MANAGES_TARGETS);
    }
    assert.equal((await commands(c)).length, before);
    await c.cycle();
    assert.deepEqual(c.targets, targets);
  }
});

test("picking what is growing stays open while Coach is on and Coach then steers that recipe", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  const res = await growStage(lykyn, "pinning");
  assert.notEqual(result(res).status, "failed");
  await lykyn.cycle();
  assertRecipe(lykyn, "pinning");
  tick(15 * MIN);
  const out = await coachPass(lykyn);
  if (out.stage) assert.equal(out.stage, "pinning");
});

test("turning Coach off hands control back: sliders work again and Coach stops sending", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  for (const c of [lykyn, shrooly]) {
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
    assert.equal(result(await apply(c, "setpoints", { temperature_c: 20 })).status, "failed");
    await coachOff(c);
    assert.equal((await mode(c)).mode, "advisor");
    const res = await apply(c, "setpoints", { temperature_c: 20, humidity_percent: 85, fan_speed_percent: 40 });
    assert.notEqual(result(res).status, "failed", JSON.stringify(res.data));
    await c.cycle();
    assert.equal(c.targets.temperature_c, 20);
    assert.equal(c.targets.humidity_percent, 85);
    const sent = (await commands(c)).length;
    tick(30 * MIN);
    const out = await coachPass(c);
    assert.equal(out.skipped, undefined === out.skipped ? undefined : "advisor");
    assert.equal((await commands(c)).length, sent, "Coach sends nothing while off");
    assert.equal(c.targets.temperature_c, 20, "the grower's number stays");
  }
});

test("Coach on, off, and on again leaves one consistent stage and no stale command behind", async () => {
  const { shrooly } = await world(["shrooly"]);
  await growStage(shrooly, "pinning");
  await shrooly.cycle();
  await coachOn(shrooly);
  await coachOff(shrooly);
  await apply(shrooly, "stage", { grow_phase: "Fruiting" });
  await shrooly.cycle();
  assert.equal(shrooly.knobs.grow_phase, "Fruiting");
  await coachOn(shrooly);
  tick(15 * MIN);
  await shrooly.cycle();
  const out = await coachPass(shrooly);
  assert.ok(!out.paused);
  for (let i = 0; i < 3; i += 1) {
    tick(15 * MIN);
    await shrooly.cycle();
    const o = await coachPass(shrooly);
    if (o.stage) assert.equal(o.stage, CANON[shrooly.knobs.grow_phase]);
  }
  const open = (await commands(shrooly)).filter((x) => !x.consumed_at);
  assert.equal(open.length <= 1, true);
});

// ---- When Coach may act: only when climate is out of range, and only the right way -----------------

async function coachCommandsAfter(chamber, count) {
  return (await commands(chamber)).filter((x) => x.payload.source === "grow-coach-autopilot").slice(count);
}

test("inside the stage band Coach changes nothing: no commands, no fan move, targets stay the recipe", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  for (const c of [lykyn, shrooly]) {
    await growStage(c, "colonization");
    await c.cycle();
    c.sensor = { temperature: STAGE.colonization.temperature_c, humidity: STAGE.colonization.humidity_percent };
    await c.cycle();
    await coachOn(c);
    const band = humidityBandForStage(STAGE.colonization);
    const before = (await coachCommandsAfter(c, 0)).length;
    const targets = { ...c.targets };
    const knobs = { ...c.knobs };
    for (let i = 0; i < 10; i += 1) {
      tick(15 * MIN);
      // Wander across the whole band, both ways, and the temperature around its target.
      c.sensor = { temperature: STAGE.colonization.temperature_c + (i % 2 ? 0.8 : -0.8), humidity: i % 2 ? band.hi - 0.1 : band.lo + 0.1 };
      await c.cycle();
      const out = await coachPass(c);
      assert.ok(!out.applied, `${c.kind} cycle ${i}: Coach acted inside the band: ${JSON.stringify(out)}`);
    }
    assert.equal((await coachCommandsAfter(c, 0)).length, before, `${c.kind}: no Coach commands`);
    assert.deepEqual(c.targets, targets);
    assert.deepEqual(c.knobs, knobs);
  }
});

test("too dry: Coach slows the fan (less air), one step, straight there, targets untouched, and goes back to the recipe once humidity is at target", async () => {
  const { lykyn, shrooly } = await world(["lykyn", "shrooly"]);
  for (const c of [lykyn, shrooly]) {
    await growStage(c, "colonization");
    await c.cycle();
    await coachOn(c);
    const s = STAGE.colonization;
    const band = humidityBandForStage(s);
    const recipe = Math.max(c.p.ranges.air_exchange_speed[0], s.fan.speed_percent);
    const targets = { ...c.targets };
    c.sensor = { temperature: s.temperature_c, humidity: band.lo - 2 };
    const seen = [];
    for (let i = 0; i < 6; i += 1) {
      tick(15 * MIN);
      await c.cycle();
      await coachPass(c);
      seen.push(c.knobs.air_exchange_speed);
    }
    assert.ok(seen.every((f) => f <= recipe), `${c.kind}: the fan went the wrong way while too dry: ${seen}`);
    const low = Math.min(...seen);
    assert.equal(low, Math.max(c.p.ranges.air_exchange_speed[0], recipe - 10, 15), `${c.kind}: one step slower, straight there: ${seen}`);
    assert.deepEqual(c.targets, targets, `${c.kind}: Coach never moved a target`);
    // Humidity recovers to the target: the fan goes back to the recipe and stays.
    c.sensor = { temperature: s.temperature_c, humidity: s.humidity_percent };
    for (let i = 0; i < 6; i += 1) {
      tick(15 * MIN);
      await c.cycle();
      await coachPass(c);
    }
    assert.equal(c.knobs.air_exchange_speed, recipe, `${c.kind}: back on the recipe`);
    assert.deepEqual(c.targets, targets);
  }
});

test("too wet: Coach speeds the fan up, never down", async () => {
  const { shrooly } = await world(["shrooly"]);
  await growStage(shrooly, "pinning");
  await shrooly.cycle();
  await coachOn(shrooly);
  const s = STAGE.pinning;
  const band = humidityBandForStage(s);
  const recipe = Math.max(shrooly.p.ranges.air_exchange_speed[0], s.fan.speed_percent);
  shrooly.sensor = { temperature: s.temperature_c, humidity: band.hi + 3 };
  for (let i = 0; i < 6; i += 1) {
    tick(15 * MIN);
    await shrooly.cycle();
    await coachPass(shrooly);
    assert.ok(shrooly.knobs.air_exchange_speed >= recipe, `fan ${shrooly.knobs.air_exchange_speed} fell below the recipe ${recipe} while too wet`);
  }
  assert.equal(shrooly.knobs.air_exchange_speed, recipe + 10);
});

test("a cold chamber does not make Coach change the temperature target or the fan: it keeps driving the profile target", async () => {
  const { lykyn } = await world(["lykyn"]);
  await growStage(lykyn, "colonization");
  await lykyn.cycle();
  await coachOn(lykyn);
  const s = STAGE.colonization;
  const targets = { ...lykyn.targets };
  const fan = lykyn.knobs.air_exchange_speed;
  lykyn.sensor = { temperature: s.temperature_c - 2.5, humidity: s.humidity_percent }; // out of the temperature band, humidity fine
  for (let i = 0; i < 8; i += 1) {
    tick(15 * MIN);
    await lykyn.cycle();
    await coachPass(lykyn);
    assert.deepEqual(lykyn.targets, targets, `cycle ${i}: the temperature target stays the profile's`);
    assert.equal(lykyn.knobs.air_exchange_speed, fan, `cycle ${i}: the fan stays on the recipe for a temperature problem`);
  }
  assert.equal((await mode(lykyn)).mode, "autopilot");
});
