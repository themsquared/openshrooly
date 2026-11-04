import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyStage, configFromEnv, createAcInfinityClient, stagePortSettings, speedLevel, MODE, HOST, CONTROL_KEYS, AcInfinityError } from "../src/adapters/ac-infinity.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const lions = JSON.parse(readFileSync(join(ROOT, "data", "profiles", "culinary", "lions-mane.json"), "utf8"));
const fruiting = lions.stages.find((s) => s.id === "fruiting");
const PORTS = { humidifier: 1, fan: 2, heater: 3 };

/** A fake AC Infinity cloud. Records every call. Never touches the network. */
function fakeCloud({ loginCode = 200, existing = { devId: "C1", onSpead: 4, speak: 1, devSetting: { a: 1 }, isOpenAutomation: true, surplus: null } } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, query: u.searchParams, headers: init.headers, body: init.body ? new URLSearchParams(init.body) : null, method: init.method });
    const reply = (j) => ({ status: 200, json: async () => j });
    if (u.pathname === "/api/user/appUserLogin") return reply(loginCode === 200 ? { code: 200, data: { appId: "user-123" } } : { code: loginCode, msg: "bad" });
    if (u.pathname === "/api/user/devInfoListAll") return reply({ code: 200, data: [{ devId: "C1", devName: "Tent" }] });
    if (u.pathname === "/api/dev/getdevModeSettingList") return reply({ code: 200, data: existing });
    if (u.pathname === "/api/dev/addDevMode") return reply({ code: 200, data: null });
    return { status: 404, json: async () => ({}) };
  };
  return { calls, fetch };
}

test("a fruiting stage maps to humidifier, heater, and fan port settings", () => {
  const plan = stagePortSettings(fruiting, PORTS);
  const by = Object.fromEntries(plan.map((p) => [p.device, p]));
  assert.deepEqual(by.humidifier.values, { atType: MODE.AUTO, activeLh: 1, devLh: 90, activeHh: 0, activeHt: 0, activeLt: 0, onSpead: 8, offSpead: 0 });
  assert.equal(by.heater.values.atType, MODE.AUTO);
  assert.equal(by.heater.values.devLt, 16, "target 17 minus 1 degree hysteresis");
  assert.equal(by.heater.values.devLtf, 61);
  assert.equal(by.fan.values.atType, MODE.CYCLE);
  assert.equal(by.fan.values.activeCycleOn, 60, "25 s rounds up to one minute");
  assert.equal(by.fan.values.activeCycleOff, 17 * 60);
  assert.equal(by.fan.values.onSpead, 3);
  assert.match(by.fan.notes[0], /rounded up/);
});

test("devices without a port are skipped, and heat follows the stage switch", () => {
  assert.deepEqual(stagePortSettings(fruiting, { fan: 4 }).map((p) => p.device), ["fan"]);
  assert.equal(stagePortSettings({ ...fruiting, temperature_control_enabled: false }, PORTS).some((p) => p.device === "heater"), false);
  assert.throws(() => stagePortSettings(fruiting, { fan: 2, heater: 2 }), /assigned twice/);
  assert.throws(() => stagePortSettings(fruiting, { fan: 9 }), /1 to 8/);
  assert.equal(speedLevel(0), 1);
  assert.equal(speedLevel(250), 10);
});

test("every shipped profile stage maps cleanly", () => {
  const seeds = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "seeds.json"), "utf8"));
  const profiles = Array.isArray(seeds) ? seeds : seeds.profiles || Object.values(seeds).flat();
  let n = 0;
  for (const p of profiles) for (const s of p.stages || []) {
    for (const port of stagePortSettings(s, PORTS)) {
      n++;
      for (const v of Object.values(port.values)) assert.ok(Number.isInteger(v), `${p.id} ${s.id} ${port.device}`);
      if (port.values.devLh !== undefined) assert.ok(port.values.devLh >= 0 && port.values.devLh <= 100);
    }
  }
  assert.ok(n > 20, `mapped ${n} ports`);
});

test("login sends the form the app sends and keeps the user id as the token", async () => {
  const cloud = fakeCloud();
  const c = createAcInfinityClient({ email: "a@b.c", password: "x".repeat(30), fetch: cloud.fetch });
  await c.login();
  const [login] = cloud.calls;
  assert.equal(login.path, "/api/user/appUserLogin");
  assert.equal(login.body.get("appEmail"), "a@b.c");
  assert.equal(login.body.get("appPasswordl"), "x".repeat(25), "password cut to 25 characters");
  assert.equal(login.headers["User-Agent"], "okhttp/4.12.0");
  assert.equal(login.headers.token, undefined);
  assert.deepEqual(await c.controllers(), [{ devId: "C1", devName: "Tent" }]);
  assert.equal(cloud.calls[1].headers.token, "user-123");
  assert.equal(cloud.calls[1].body.get("userId"), "user-123");
});

test("a bad sign in is a clear error", async () => {
  const c = createAcInfinityClient({ email: "a@b.c", password: "p", fetch: fakeCloud({ loginCode: 10001 }).fetch });
  await assert.rejects(c.login(), (e) => e instanceof AcInfinityError && /sign in failed/.test(e.message));
  assert.throws(() => createAcInfinityClient({ email: "", password: "" }), /required/);
});

test("a port write reads first, keeps other fields, and sends the full set in the query", async () => {
  const cloud = fakeCloud();
  const c = createAcInfinityClient({ email: "a@b.c", password: "p", fetch: cloud.fetch });
  await c.login();
  await c.updatePort("C1", 2, { atType: MODE.CYCLE, activeCycleOn: 60 });
  const [read, write] = cloud.calls.slice(1);
  assert.equal(read.path, "/api/dev/getdevModeSettingList");
  assert.equal(read.body.get("devId"), "C1");
  assert.equal(read.body.get("port"), "2");
  assert.equal(write.path, "/api/dev/addDevMode");
  assert.equal(write.body, null);
  assert.equal(write.query.get("atType"), "6");
  assert.equal(write.query.get("activeCycleOn"), "60");
  assert.equal(write.query.get("speak"), "1", "unchanged field kept");
  assert.equal(write.query.get("surplus"), "0", "null becomes 0");
  assert.equal(write.query.get("isOpenAutomation"), "true");
  assert.equal(write.query.get("devSetting"), '{"a":1}');
  assert.equal([...write.query.keys()].length, CONTROL_KEYS.length);
});

test("applyStage is a dry run unless told to apply", async () => {
  const cloud = fakeCloud();
  const client = createAcInfinityClient({ email: "a@b.c", password: "p", fetch: cloud.fetch });
  const dry = await applyStage({ client, controllerId: "C1", ports: PORTS, stage: fruiting });
  assert.equal(dry.applied, false);
  assert.equal(cloud.calls.length, 0);
  const wet = await applyStage({ client, controllerId: "C1", ports: PORTS, stage: fruiting, apply: true });
  assert.equal(wet.applied, true);
  assert.equal(cloud.calls.filter((c) => c.path === "/api/dev/addDevMode").length, 3);
  assert.ok(cloud.calls.every((c) => new URL(HOST).pathname === "/" && c.path.startsWith("/api/")));
  await assert.rejects(applyStage({ client, ports: PORTS, stage: fruiting, apply: true }), /controller id/);
});

test("config comes from the environment and no credentials are in the repo", () => {
  const cfg = configFromEnv({ AC_INFINITY_EMAIL: "e", AC_INFINITY_PASSWORD: "p", AC_INFINITY_CONTROLLER_ID: "C1", AC_INFINITY_PORT_FAN: "2" });
  assert.deepEqual(cfg, { email: "e", password: "p", controllerId: "C1", ports: { fan: 2 } });
  const src = readFileSync(join(import.meta.dirname, "..", "src", "adapters", "ac-infinity.js"), "utf8");
  assert.doesNotMatch(src, /appPasswordl:\s*"[^"]/);
  assert.doesNotMatch(src, /@[a-z0-9-]+\.(com|net|org)/i);
});
