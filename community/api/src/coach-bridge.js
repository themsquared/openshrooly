/** Local Autopilot delivery. Re-validates queued setpoints before a LAN write. */

import { commandExpired } from "./fleet.js";
import {
  AUTOPILOT_LIMITS,
  clampAutopilotSetpoints,
  cloudDeliveryActive,
  limitAutopilotStep,
  setpointsMismatch,
  stageFromProfile,
} from "./coach-autopilot.js";
import { REACHABILITY_MS } from "../scripts/coach-readings.js";

export const BRIDGE_RATE_MS = 10 * 60 * 1000;
export const BRIDGE_COMMAND_TTL_MS = AUTOPILOT_LIMITS.commandTtlMs;
export const BRIDGE_STALE_MS = 30 * 60 * 1000;
export const BRIDGE_KILL_FILE = ".wrangler/coach-local/BRIDGE_OFF";
export const BRIDGE_STATE_FILE = ".wrangler/coach-local/bridge-state.json";
export const PENDING_COMMAND_SQL =
  "SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT ?";

const NUMBER_ENTITIES = {
  temperature_target: ["temperature__target", "temperature_target"],
  target_humidity: ["target_humidity"],
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

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

export function missingFromSnapshot(payload = {}) {
  const from = payload.from || payload.planned_from;
  if (!from || typeof from !== "object") return "Command is missing a from snapshot.";
  const temp = finite(from.temperature_c ?? from.temperature_target);
  const rh = finite(from.humidity_percent ?? from.target_humidity);
  if (temp == null && rh == null) return "Command is missing a from snapshot.";
  return null;
}

export function chamberSetpointsUnreadable(reading, payload = {}) {
  if (!reading) return "Chamber setpoints could not be read.";
  const needTemp = payload.temperature_c != null || payload.temperature_target != null;
  const needRh = payload.humidity_percent != null || payload.target_humidity != null;
  const checkTemp = needTemp || !needRh;
  const checkRh = needRh || !needTemp;
  if (checkTemp && finite(reading.temperature_setpoint) == null) {
    return "Chamber temperature setpoint could not be read.";
  }
  if (checkRh && finite(reading.humidity_setpoint) == null) {
    return "Chamber humidity setpoint could not be read.";
  }
  return null;
}

function writeFor(field, value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return { field, value: Number(value), entityIds: NUMBER_ENTITIES[field] || [field] };
}

export function planBridgeCommand({ command, stage = {}, reading, now = Date.now(), device, state } = {}) {
  if (!command) return { ok: false, status: "empty", reason: "No pending command.", mark: false };
  if (cloudDeliveryActive({ device, state, command })) {
    return {
      ok: false,
      status: "skipped",
      reason: "Cloud delivery is active for this device. The local bridge will not write.",
      mark: false,
    };
  }
  if (bridgeCommandExpired(command, now)) {
    return { ok: false, status: "failed", reason: "Command expired.", mark: true };
  }
  const kind = String(command.kind || "");
  if (kind !== "setpoints") {
    return {
      ok: false,
      status: "failed",
      reason: "Bridge accepts only setpoints until lights have step and override checks.",
      mark: true,
    };
  }
  const payload = parsePayload(command.payload);
  const unread = chamberSetpointsUnreadable(reading, payload);
  if (unread) {
    return { ok: false, status: "failed", reason: unread, mark: true };
  }
  const missingFrom = missingFromSnapshot(payload);
  if (missingFrom) {
    return { ok: false, status: "failed", reason: missingFrom, mark: true };
  }
  const plannedFrom = payload.from || payload.planned_from;
  if (setpointsMismatch(reading, plannedFrom, { now })) {
    return { ok: false, status: "failed", reason: "Chamber setpoint changed; manual override wins.", mark: true };
  }

  const proposed = {
    temperature_c: payload.temperature_c ?? payload.temperature_target,
    humidity_percent: payload.humidity_percent ?? payload.target_humidity,
  };
  const clamped = clampAutopilotSetpoints(proposed, stage);
  const current = {
    temperature_c: reading.temperature_setpoint,
    humidity_percent: reading.humidity_setpoint,
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

export function withBridgeResult(command, result) {
  const payload = parsePayload(command.payload);
  return { ...payload, _bridge: result };
}

export async function expireStaleOnLiveStart({
  listPendingAll,
  markCommand,
  now = Date.now(),
  staleMs = BRIDGE_STALE_MS,
  log = () => {},
} = {}) {
  const pending = (await listPendingAll?.()) || [];
  let expired = 0;
  for (const command of pending) {
    const issued = Date.parse(command.issued_at || "");
    if (!Number.isFinite(issued) || now - issued <= staleMs) continue;
    const result = {
      status: "failed",
      reason: "Expired on live start (older than 30 minutes).",
      at: new Date(now).toISOString(),
    };
    await markCommand(command, result);
    log({ action: "failed", reason: result.reason, command_id: command.id });
    expired += 1;
  }
  return expired;
}

export function chamberAuthHeader(env = {}) {
  const password = env.COACH_CHAMBER_PASSWORD;
  if (!password) return null;
  const user = env.COACH_CHAMBER_USER || "admin";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function writeFailureReason(failed = []) {
  return failed.find((item) => item?.error)?.error || "chamber write failed";
}

export async function httpApplyWrites(baseUrl, writes, { fetchImpl = fetch, timeoutMs = REACHABILITY_MS, auth = null } = {}) {
  const applied = [];
  const failed = [];
  const headers = auth ? { authorization: auth } : {};
  for (const write of writes) {
    let ok = false;
    let entityId = null;
    let error = null;
    for (const id of write.entityIds) {
      const url = `${String(baseUrl).replace(/\/$/, "")}/number/${id}/set?value=${encodeURIComponent(write.value)}`;
      try {
        const res = await fetchImpl(url, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          ok = true;
          entityId = id;
          error = null;
          break;
        }
        error = res.status === 401 ? "chamber web password missing or wrong (401)" : `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) break;
      } catch (err) {
        error = err?.name || "network error";
      }
    }
    (ok ? applied : failed).push({ field: write.field, value: write.value, entity_id: entityId, ...(ok ? {} : { error }) });
  }
  return { ok: failed.length === 0, applied, failed, error: failed.length ? writeFailureReason(failed) : undefined };
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
  device,
  deviceMode,
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
  const plan = planBridgeCommand({
    command,
    stage: resolvedStage,
    reading: before,
    now,
    device,
    state: deviceMode,
  });
  if (!plan.ok) {
    log({ action: plan.status, reason: plan.reason, command_id: command.id, before });
    if (plan.mark) {
      await markCommand(command, {
        status: "failed",
        reason: plan.reason,
        before,
        after: null,
        sent: false,
        at: new Date(now).toISOString(),
      });
    }
    return { ...plan, mode, command_id: command.id, sent: false, before };
  }

  if (mode !== "live") {
    await markCommand(command, {
      status: "dry_run",
      reason: "Dry-run; not sent.",
      writes: plan.writes,
      applied: plan.applied,
      before,
      after: null,
      sent: false,
      at: new Date(now).toISOString(),
    });
    log({ action: "dry_run", writes: plan.writes, command_id: command.id, before });
    return { ok: true, mode: "dry-run", status: "dry_run", writes: plan.writes, sent: false, command_id: command.id, before };
  }

  if (rateLimited(state, now)) {
    log({ action: "skip", reason: "rate limit", command_id: command.id });
    return { skipped: "rate_limit", mode, command_id: command.id, sent: false };
  }

  await saveState?.({ last_live_write_at: now });
  const apply = await applyWrites(plan.writes);
  const after = await readChamber();
  const status = apply.ok ? "sent" : "failed";
  const result = {
    status,
    reason: apply.ok ? "applied" : apply.error || writeFailureReason(apply.failed),
    writes: plan.writes,
    applied: plan.applied,
    before,
    after,
    chamber: apply,
    sent: apply.ok,
    at: new Date(now).toISOString(),
  };
  await markCommand(command, result);
  log({ action: status, command_id: command.id, ...result });
  return { ok: apply.ok, mode: "live", status, sent: apply.ok, writes: plan.writes, before, after, command_id: command.id };
}

export { stageFromProfile };
