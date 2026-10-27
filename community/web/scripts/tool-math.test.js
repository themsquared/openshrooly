import { test } from "node:test";
import assert from "node:assert/strict";
import { airChanges, buildIcs, chamberLiters, compareAch, flowLpm, foldLine, timeline } from "../public/js/tool-math.js";
import { airResult, timelineResult } from "../public/js/tool-render.js";
import { SPECIES } from "./tools/index.js";

const pearl = SPECIES.find((s) => s.id === "pearl-oyster");

test("every species has stages with days, temperature, humidity, and a fan cycle", () => {
  assert.equal(SPECIES.length, 20);
  for (const s of SPECIES) {
    assert.ok(s.latin && s.stages.length >= 3, s.id);
    for (const st of s.stages) {
      assert.ok(st.days > 0 && st.c > 0 && st.rh > 0, `${s.id} ${st.id}`);
      assert.ok(st.fan && st.fan.every > 0, `${s.id} ${st.id} fan`);
    }
  }
});

test("timeline stages run back to back from the start date", () => {
  const plan = timeline(pearl, { start: "2026-11-01" });
  const days = pearl.stages.reduce((n, s) => n + s.days, 0);
  assert.equal(plan.total, days);
  assert.equal(plan.rows[0].from, 1);
  assert.equal(new Date(plan.rows[0].start).toISOString().slice(0, 10), "2026-11-01");
  for (let i = 1; i < plan.rows.length; i++) {
    assert.equal(plan.rows[i].from, plan.rows[i - 1].to + 1);
    assert.equal(plan.rows[i].start, plan.rows[i - 1].end + 86400000);
  }
  assert.equal(plan.harvest.id, "fruiting");
});

test("starting from a colonized kit skips colonization", () => {
  const full = timeline(pearl, {});
  const kit = timeline(pearl, { fromKit: true });
  assert.ok(!kit.rows.some((r) => r.id === "colonization"));
  assert.equal(kit.total, full.total - pearl.stages.find((s) => s.id === "colonization").days);
  assert.equal(kit.rows[0].start, undefined, "no date without a start");
  assert.match(timelineResult(pearl, kit, { fromKit: true }), /<table/);
});

test("the calendar file has one all day event per stage with exclusive end dates", () => {
  const plan = timeline(pearl, { start: "2026-11-01" });
  const ics = buildIcs(pearl, plan, { now: Date.UTC(2026, 9, 27) });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, plan.rows.length);
  assert.match(ics, /DTSTART;VALUE=DATE:20261101\r\n/);
  const firstEnd = new Date(plan.rows[0].end + 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${firstEnd}\r\n`));
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(foldLine("x".repeat(200)).split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
});

test("air changes per hour: a 36 L box with a 5 CFM fan for 40 s every 10 min", () => {
  const liters = chamberLiters(40, 30, 30, "cm");
  assert.equal(liters, 36);
  const lpm = flowLpm(5, "cfm");
  assert.ok(Math.abs(lpm - 141.6) < 0.1);
  const air = airChanges({ liters, lpm, runS: 40, everyMin: 10 });
  assert.ok(Math.abs(air.perHour - 15.7) < 0.1, String(air.perHour));
  assert.equal(compareAch(air.perHour), "above");
  assert.equal(compareAch(5), "within");
  assert.equal(compareAch(2), "below");
  assert.equal(airChanges({ liters: 0, lpm, runS: 40, everyMin: 10 }), null);
  assert.ok(chamberLiters(10, 10, 10, "in") > 16 && chamberLiters(10, 10, 10, "in") < 16.5);
  const fruiting = pearl.stages.find((s) => s.id === "fruiting");
  assert.match(airResult(pearl, fruiting, liters, air), /15\.7/);
});
