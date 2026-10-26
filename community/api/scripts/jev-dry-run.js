#!/usr/bin/env node
/**
 * Dry run: replay a chamber's recent D1 telemetry through both Autopilot deciders and print
 * what each would have sent. Read-only: one SELECT per table through `wrangler d1 execute`,
 * nothing is written to D1 and no command is queued. Jev is called only when TYPESAFE_API_KEY
 * is set; without it the Jev column is skipped and the script still exits 0.
 *
 *   node scripts/jev-dry-run.js [--device sldev_...] [--hours 12] [--every 60] [--json]
 *
 * Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) for the remote read.
 * Prints usage and payload bytes per call; never prints the key.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandStage,
  latestDoc,
  planAutopilotChange,
  runJevDecider,
  withKnobs,
} from "../src/coach-autopilot.js";
import { pickAutopilotStage, recipeChanges, recipeKnobs, steerFan } from "../src/autopilot-knobs.js";
import { buildDeviceModel, latestReading, suggestSetpoints } from "../src/coach-learn.js";
import { chamberKnobs, deviceCapabilities, knobSupported } from "../src/device-capabilities.js";
import { JEV_MODEL, jevCost } from "../src/jev.js";
import { isPsilocybin } from "../src/profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const DEVICE = opt("device", "sldev_1ea27b29fd076427");
const HOURS = Number(opt("hours", 12));
const EVERY_MIN = Number(opt("every", 60));
const AS_JSON = args.includes("--json");

if (!/^sldev_[0-9a-f]+$/.test(DEVICE)) {
  console.error("bad --device");
  process.exit(2);
}

function d1(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error("dry run is read-only");
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "shroomlabs", "--remote", "-c", "wrangler.deploy.toml", "--json", "--command", sql],
    { cwd: join(here, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(out)[0]?.results || [];
}

const since = new Date(Date.now() - (HOURS + 24) * 3600000).toISOString().replace(/\.\d+Z$/, "Z");
const rows = d1(
  `SELECT device_id, document, created_at FROM device_telemetry WHERE device_id='${DEVICE}' AND created_at>='${since}' ORDER BY created_at ASC`
);
const mode = d1(`SELECT profile_id FROM coach_device_mode WHERE device_id='${DEVICE}'`)[0] || {};
const device = d1(`SELECT id, name, device_type, status FROM cloud_devices WHERE id='${DEVICE}'`)[0] || { id: DEVICE };
if (!rows.length) {
  console.log(`No telemetry for ${DEVICE} in the last ${HOURS + 24}h. Nothing to replay.`);
  process.exit(0);
}

function loadProfile(id) {
  const local = join(here, "../../../data/profiles/culinary", `${id}.json`);
  if (id && existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
  const row = d1(`SELECT document FROM profiles WHERE id='${id}'`)[0];
  return row ? JSON.parse(row.document) : null;
}
const profile = loadProfile(mode.profile_id || "lions-mane");
if (!profile || isPsilocybin(profile)) {
  console.log("The chamber's profile is missing or Off-menu, so Autopilot would not act. Nothing to replay.");
  process.exit(0);
}

const keyed = Boolean(process.env.TYPESAFE_API_KEY);
const jevEnv = {
  AUTOPILOT_DECIDER: "jev",
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY || "",
  JEV_MODEL: process.env.JEV_MODEL || JEV_MODEL,
  JEV_MIN_CALL_INTERVAL_MIN: "0",
  // Measure the request body exactly as the Worker sends it.
  JEV_FETCH: async (url, init) => {
    lastBody = Buffer.byteLength(init.body);
    const state = JSON.parse(init.body).state;
    lastState = Buffer.byteLength(JSON.stringify(state));
    return globalThis.fetch(url, init);
  },
};
let lastBody = 0;
let lastState = 0;
// A throwaway db so the decider's caps and log reads never touch D1.
const scratch = { one: async () => null, all: async () => [], run: async () => ({}) };

function decideAt(t) {
  const samples = rows.filter((r) => Date.parse(r.created_at) <= t && Date.parse(r.created_at) > t - 24 * 3600000);
  if (!samples.length) return null;
  const doc = latestDoc(samples);
  const caps = deviceCapabilities(doc, device.device_type || "shrooly_chamber");
  const knobs = chamberKnobs(doc);
  const current = withKnobs(latestReading(samples, t), doc);
  const pick = pickAutopilotStage(profile, knobs, caps, {});
  const stage = expandStage(pick.stage);
  const model = buildDeviceModel(samples, []);
  const suggestion = suggestSetpoints(model, stage, { reading: current });
  const fanKnob = knobSupported(caps, "air_exchange_speed");
  const fanSteer = fanKnob ? steerFan(stage, current, caps) : null;
  if (fanSteer) suggestion.fan_speed_percent = fanSteer.fan;
  const recipe = caps.multi ? recipeKnobs(stage, pick.stageId, caps) : {};
  const extras = caps.multi ? recipeChanges(recipe, knobs) : {};
  const currentSetpoints = {
    temperature_c: current.temperature_setpoint,
    humidity_percent: current.humidity_setpoint,
    fan_speed_percent: fanKnob ? knobs.air_exchange_speed : suggestion.fan_speed_percent,
  };
  return { t, samples, caps, knobs, current, pick, stage, suggestion, fanSteer, recipe, extras, currentSetpoints };
}

const fmt = (o = {}) =>
  ["temperature_c", "humidity_percent", "fan_speed_percent", "white_intensity"]
    .map((k) => (o[k] == null ? "-" : String(o[k])))
    .join("/");

const out = [];
const end = Date.parse(rows.at(-1).created_at);
let totalTokens = 0;
let calls = 0;
let bytes = [];
for (let t = end - HOURS * 3600000; t <= end; t += EVERY_MIN * 60000) {
  const s = decideAt(t);
  if (!s) continue;
  const rules = planAutopilotChange({ suggestion: s.suggestion, currentSetpoints: s.currentSetpoints, stage: s.stage, state: {}, now: t, fanRange: s.fanSteer?.range, extras: s.extras });
  const row = {
    at: new Date(t).toISOString(),
    reading: `${s.current.temperature ?? "-"}C ${s.current.humidity ?? "-"}%`,
    setpoints: fmt({ ...s.currentSetpoints, white_intensity: s.knobs.white_intensity }),
    rules: rules.ok ? fmt(rules.next) : `no change (${rules.reason})`,
  };
  if (keyed) {
    const suggestion = { ...s.suggestion, reasons: [...(s.suggestion.reasons || [])] };
    const extras = { ...s.extras };
    const jev = await runJevDecider(scratch, jevEnv, {
      device: { id: DEVICE },
      state: {},
      now: t,
      samples: s.samples,
      stage: s.stage,
      pick: s.pick,
      profile,
      caps: s.caps,
      knobs: s.knobs,
      current: s.current,
      suggestion,
      currentSetpoints: s.currentSetpoints,
      fanRange: s.fanSteer?.range,
      recipe: s.recipe,
    });
    if (jev.audit.decider === "jev") {
      calls += 1;
      totalTokens += Number(jev.audit.usage?.input_tokens) || 0;
      for (const k of ["temperature_c", "humidity_percent", "fan_speed_percent"]) if (jev.suggestion?.[k] != null) suggestion[k] = jev.suggestion[k];
      if (jev.light != null) {
        if (Number(s.knobs.white_intensity) === jev.light) delete extras.white_intensity;
        else extras.white_intensity = jev.light;
      }
      const plan = jev.pause
        ? { ok: false, reason: "PAUSE: abnormal readings" }
        : planAutopilotChange({ suggestion, currentSetpoints: s.currentSetpoints, stage: s.stage, state: {}, now: t, fanRange: s.fanSteer?.range, extras });
      row.jev = plan.ok ? fmt(plan.next) : `no change (${plan.reason})`;
      row.answers = Object.entries(jev.audit.knobs)
        .map(([k, v]) => `${k}:${v.choice}@${v.confidence.toFixed(2)}${v.used === "rules" ? "*" : ""}`)
        .join(" ");
      row.abnormal = jev.audit.abnormal;
      row.tokens = jev.audit.usage?.input_tokens ?? null;
      row.ms = jev.audit.ms;
      row.request_bytes = lastBody;
      row.state_bytes = lastState;
      bytes = [lastBody, lastState];
    } else {
      row.jev = `fallback (${jev.audit.fallback})`;
    }
  }
  out.push(row);
}

if (AS_JSON) {
  console.log(JSON.stringify({ device: DEVICE, profile: profile.id, keyed, rows: out, calls, totalTokens, request_bytes: bytes[0], state_bytes: bytes[1] }, null, 2));
} else {
  console.log(`Dry run: ${device.name || DEVICE} (${profile.id}), last ${HOURS}h every ${EVERY_MIN} min, ${rows.length} telemetry rows read.`);
  console.log("Columns are temp/RH/fan/white. * = under the confidence threshold, so the rules value was kept.\n");
  for (const r of out) {
    console.log(`${r.at}  reading ${r.reading}  set ${r.setpoints}`);
    console.log(`   rules: ${r.rules}`);
    if (keyed) console.log(`   jev:   ${r.jev}${r.answers ? `  [${r.answers} abnormal:${r.abnormal?.toFixed(2)}] ${r.tokens} tok ${r.ms}ms` : ""}`);
  }
  if (!keyed) console.log("\nTYPESAFE_API_KEY is not set, so the Jev column was skipped.");
  else if (calls) {
    const avg = totalTokens / calls;
    console.log(`\nJev calls: ${calls}, input tokens ${totalTokens} (avg ${avg.toFixed(0)}/call).`);
    console.log(`Cost at $0.042/M input: $${jevCost(avg).toFixed(7)} per call; 24 calls/day = $${jevCost(avg * 24).toFixed(5)}/chamber/day; 48/day cap = $${jevCost(avg * 48).toFixed(5)}.`);
  }
  if (bytes.length) console.log(`Last request body ${bytes[0]} bytes (state ${bytes[1]} bytes).`);
}
