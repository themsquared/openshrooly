/** Local Autopilot delivery. Re-validates queued setpoints before a LAN write. */

import { commandExpired, FLEET_COMMAND_TTL_MS } from "./fleet.js";
import { clampAutopilotSetpoints, limitAutopilotStep, setpointsMismatch, stageFromProfile } from "./coach-autopilot.js";
import { validateStageLight } from "./profile.js";
import { REACHABILITY_MS } from "../scripts/coach-readings.js";

export const BRIDGE_RATE_MS = 10 * 60 * 1000;
export const BRIDGE_COMMAND_TTL_MS = FLEET_COMMAND_TTL_MS;
export const BRIDGE_KILL_FILE = ".wrangler/coach-local/BRIDGE_OFF";
export const BRIDGE_STATE_FILE = ".wrangler/coach-local/bridge-state.json";
export const PENDING_COMMAND_SQL =
  "SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT ?";

const NUMBER_ENTITIES = {
  temperature_target: ["temperature_target", "temperature__target"],
  target_humidity: ["target_humidity"],
  sunrise_hour: ["sunrise_hour", "lights__sunrise_hour"],
  duration_hours: ["light_hours", "lights__duration__hours_"],
  white_led_lux: ["white_intensity", "white_led_intensity"],
  red_percent: ["color_r", "red_led_intensity"],
  green_percent: ["color_g", "green_led_intensity"],
  blue_percent: ["color_b", "blue_led_intensity"],
};

function parsePayload(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function bridgeMode(env = process.env) {
  if (String(env.COACH_BRIDGE_LIVE || "") === "1" && String(env.DRY_RUN || "") !== "1") return "live";
  return "dry-run";
}

export function rateLimited(state = {}, now = Date.now(), windowMs = BRIDGE_RATE_MS) {
  const last = Number(state.last_live_write_at || 0);
  return Number.isFinite(last) && last > 0 && now - last < windowMs;
}

export function bridgeCommandExpired(command, now = Date.now()) {
  const payload = parsePayload(command?.payload);
  if (commandExpired(payload, now)) return true;
  if (payload.expires_at) return false;
  const issued = Date.parse(command?.issued_at || "");
  if (!Number.isFinite(issued)) return false;
  return now - issued > BRIDGE_COMMAND_TTL_MS;
}

function writeFor(field, value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return { field, value: Number(value), entityIds: NUMBER_ENTITIES[field] || [field] };
}

export function planBridgeCommand({ command, stage = {}, reading, now = Date.now() } = {}) {
  if (!command) return { ok: false, status: "empty", reason: "No pending command.", mark: false };
  if (bridgeCommandExpired(command, now)) {
    return { ok: false, status: "failed", reason: "Command expired.", mark: true };
  }
  const kind = String(command.kind || "");
  if (kind !== "setpoints" && kind !== "schedule") {
    return { ok: false, status: "failed", reason: `Refusing command kind ${kind}.`, mark: true };
  }
  const payload = parsePayload(command.payload);
  const plannedFrom = payload.from || payload.planned_from || null;
  if (plannedFrom && reading && setpointsMismatch(reading, plannedFrom, { now })) {
    return { ok: false, status: "failed", reason: "Chamber setpoint changed; manual override wins.", mark: true };
  }

  if (kind === "setpoints") {
    const proposed = {
      temperature_c: payload.temperature_c ?? payload.temperature_target,
      humidity_percent: payload.humidity_percent ?? payload.target_humidity,
    };
    const clamped = clampAutopilotSetpoints(proposed, stage);
    const current = {
      temperature_c: reading?.temperature_setpoint,
      humidity_percent: reading?.humidity_setpoint,
    };
    const stepped = limitAutopilotStep(current, clamped);
    const writes = [
      writeFor("temperature_target", stepped.temperature_c),
      writeFor("target_humidity", stepped.humidity_percent),
    ].filter(Boolean);
    if (!writes.length) {
      return { ok: false, status: "failed", reason: "No allowed setpoints after clamp.", mark: true };
    }
    return { ok: true, status: "ready", writes, applied: stepped, payload, kind };
  }

  let light;
  try {
    light = validateStageLight(payload.light || payload);
  } catch (err) {
    return { ok: false, status: "failed", reason: err.message || "Invalid light recipe.", mark: true };
  }
  const writes = [
    writeFor("sunrise_hour", light.sunrise_hour),
    writeFor("duration_hours", light.duration_hours),
    writeFor("white_led_lux", light.white_led_lux),
    writeFor("red_percent", light.red_percent),
    writeFor("green_percent", light.green_percent),
    writeFor("blue_percent", light.blue_percent),
  ].filter(Boolean);
  if (!writes.length) {
    return { ok: false, status: "failed", reason: "Light payload is empty.", mark: true };
  }
  return { ok: true, status: "ready", writes, applied: light, payload, kind };
}

export function withBridgeResult(command, result) {
  const payload = parsePayload(command.payload);
  return { ...payload, _bridge: result };
}

export async function httpApplyWrites(baseUrl, writes, { fetchImpl = fetch, timeoutMs = REACHABILITY_MS } = {}) {
  const applied = [];
  const failed = [];
  for (const write of writes) {
    let ok = false;
    let entityId = null;
    for (const id of write.entityIds) {
      const url = `${String(baseUrl).replace(/\/$/, "")}/number/${id}/set?value=${encodeURIComponent(write.value)}`;
      try {
        const res = await fetchImpl(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          ok = true;
          entityId = id;
          break;
        }
      } catch {
        // try the next firmware id
      }
    }
    (ok ? applied : failed).push({ field: write.field, value: write.value, entity_id: entityId });
  }
  return { ok: failed.length === 0, applied, failed };
}

export async function runBridgeCycle({
  listPending,
  markCommand,
  loadStage,
  readChamber,
  applyWrites,
  env = process.env,
  now = Date.now(),
  killSwitch = false,
  state = {},
  saveState,
  log = () => {},
  stage,
} = {}) {
  const mode = bridgeMode(env);
  if (killSwitch) {
    log({ action: "skip", reason: "kill switch" });
    return { skipped: "kill_switch", mode };
  }

  const pending = await listPending();
  const command = Array.isArray(pending) ? pending[0] : pending;
  if (!command) {
    log({ action: "skip", reason: "no pending commands" });
    return { skipped: "empty", mode };
  }

  const before = await readChamber();
  const resolvedStage = stage || (loadStage ? await loadStage() : {}) || {};
  const plan = planBridgeCommand({ command, stage: resolvedStage, reading: before, now });
  if (!plan.ok) {
    log({ action: plan.status, reason: plan.reason, command_id: command.id, before });
    if (mode === "live" && plan.mark) {
      await markCommand(command, {
        status: "failed",
        reason: plan.reason,
        before,
        after: null,
        at: new Date(now).toISOString(),
      });
    }
    return { ...plan, mode, command_id: command.id, sent: false, before };
  }

  if (mode !== "live") {
    log({ action: "dry-run", writes: plan.writes, command_id: command.id, before });
    return { ok: true, mode: "dry-run", writes: plan.writes, sent: false, command_id: command.id, before };
  }

  if (rateLimited(state, now)) {
    log({ action: "skip", reason: "rate limit", command_id: command.id });
    return { skipped: "rate_limit", mode, command_id: command.id, sent: false };
  }

  const apply = await applyWrites(plan.writes);
  const after = await readChamber();
  const status = apply.ok ? "sent" : "failed";
  const result = {
    status,
    reason: apply.ok ? "applied" : apply.error || "chamber write failed",
    writes: plan.writes,
    applied: plan.applied,
    before,
    after,
    chamber: apply,
    at: new Date(now).toISOString(),
  };
  await markCommand(command, result);
  await saveState?.({ last_live_write_at: now });
  log({ action: status, command_id: command.id, ...result });
  return { ok: apply.ok, mode: "live", status, sent: apply.ok, writes: plan.writes, before, after, command_id: command.id };
}

export { stageFromProfile };
