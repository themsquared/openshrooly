/**
 * What a chamber can run from the cloud, and the true state of each command we sent it.
 *
 * Firmware may report `capabilities` (a list of the tokens below) and `firmware_version` in
 * telemetry. Firmware that does not (1.0.4-sl.x) runs only `setpoints` with temperature and
 * humidity targets: see esphome/external_components/shroom_labs_cloud/cloud_format.cpp
 * plan_setpoint_command. Everything else it ignores without an ack.
 */

export const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

/** Capability tokens firmware can report. Each names the chamber entities it writes. */
export const CAPABILITY_TOKENS = {
  "setpoints.temperature": "temperature_target number",
  "setpoints.humidity": "target_humidity number",
  "setpoints.fan": "air_exchange_speed number",
  "light.schedule": "sunrise_hour and light_hours numbers",
  "light.color": "white_intensity, color_r, color_g, color_b numbers",
  apply_profile: "whole profile and grow_phase select",
  firmware_notice: "update notice on the chamber screen",
};

/** What every Shroom Labs cloud firmware so far can run. */
export const BASELINE_CAPABILITIES = ["setpoints.temperature", "setpoints.humidity"];

/** The firmware's own cloud clamp (cloud_format.h SETPOINT_*). */
export const FIRMWARE_SETPOINT_LIMITS = { temperature_c: [10, 32], humidity_percent: [60, 98] };

export const COMMAND_STATUSES = ["queued", "delivered", "applied", "failed", "expired"];

const NOTES = {
  fan: "This chamber can't change fan speed from the site yet. Set it on the chamber.",
  light: "This chamber can't take light settings from the site yet. Set them on the chamber.",
  firmware_notice: "This chamber can't show update notices from the site yet.",
  profile_translated:
    "This chamber can't load a whole profile, so Apply sends the phase's temperature and humidity targets.",
};

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function hasSetpointFields(doc = {}) {
  return ["temperature_target", "temperature_setpoint", "target_humidity", "humidity_setpoint"].some((k) => doc[k] != null);
}

function intersect([lo, hi], min, max) {
  const a = num(min);
  const b = num(max);
  const out = [a != null ? Math.max(lo, a) : lo, b != null ? Math.min(hi, b) : hi];
  return out[0] <= out[1] ? out : [lo, hi];
}

/** Capabilities from the latest telemetry document (or {} when the chamber has not reported). */
export function deviceCapabilities(doc = {}) {
  const raw = doc && typeof doc === "object" ? doc : {};
  const reported = Array.isArray(raw.capabilities) ? raw.capabilities.map(String).filter((t) => t in CAPABILITY_TOKENS) : null;
  const list = reported || BASELINE_CAPABILITIES.slice();
  const has = new Set(list);
  const firmware = raw.firmware_version || raw.firmware || raw.version || null;
  return {
    source: reported ? "reported" : hasSetpointFields(raw) ? "inferred" : "assumed",
    firmware: firmware ? String(firmware) : null,
    list,
    ranges: {
      temperature_c: intersect(FIRMWARE_SETPOINT_LIMITS.temperature_c, raw.temperature_target_min, raw.temperature_target_max),
      humidity_percent: intersect(FIRMWARE_SETPOINT_LIMITS.humidity_percent, raw.target_humidity_min, raw.target_humidity_max),
    },
    temperature: has.has("setpoints.temperature"),
    humidity: has.has("setpoints.humidity"),
    fan: has.has("setpoints.fan"),
    light_schedule: has.has("light.schedule"),
    light_color: has.has("light.color"),
    apply_profile: has.has("apply_profile"),
    firmware_notice: has.has("firmware_notice"),
  };
}

/** Per-control support for the UI. Server-side changes (name, Coach mode, grow day) always work. */
export function controlSupport(caps) {
  const light = caps.light_schedule || caps.light_color;
  return {
    temperature: { supported: caps.temperature, note: caps.temperature ? null : "This chamber can't change the temperature target from the site." },
    humidity: { supported: caps.humidity, note: caps.humidity ? null : "This chamber can't change the humidity target from the site." },
    fan: { supported: caps.fan, note: caps.fan ? null : NOTES.fan },
    light: { supported: light, note: light ? null : NOTES.light },
    profile: {
      supported: caps.apply_profile || caps.temperature || caps.humidity,
      mode: caps.apply_profile ? "native" : "translated",
      note: caps.apply_profile ? null : NOTES.profile_translated,
    },
    name: { supported: true, note: null },
    coach_mode: { supported: true, note: null },
    grow: { supported: true, note: null },
  };
}

function clip(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value));
}

/** Drop setpoint fields the chamber cannot write, clamped to its ranges. */
export function supportedSetpoints(payload = {}, caps, requested = payload) {
  const out = {};
  const skipped = [];
  const t = num(payload.temperature_c);
  const h = num(payload.humidity_percent);
  const f = num(payload.fan_speed_percent);
  if (t != null) {
    if (caps.temperature) out.temperature_c = Math.round(clip(t, caps.ranges.temperature_c) * 10) / 10;
    else if (num(requested.temperature_c) != null) skipped.push({ field: "temperature_c", note: controlSupport(caps).temperature.note });
  }
  if (h != null) {
    if (caps.humidity) out.humidity_percent = Math.round(clip(h, caps.ranges.humidity_percent) * 10) / 10;
    else if (num(requested.humidity_percent) != null) skipped.push({ field: "humidity_percent", note: controlSupport(caps).humidity.note });
  }
  if (f != null) {
    if (caps.fan) out.fan_speed_percent = f;
    else if (num(requested.fan_speed_percent) != null) skipped.push({ field: "fan_speed_percent", note: NOTES.fan });
  }
  return { payload: out, skipped };
}

/**
 * Turn a validated plan into commands this chamber can run.
 * Returns { ok, commands: [{kind, payload}], skipped, translated, error }.
 */
export function planForCapabilities(plan, caps, { stage = {}, requested = {} } = {}) {
  if (plan.kind === "setpoints") {
    const { payload, skipped } = supportedSetpoints(plan.payload, caps, requested);
    const asked = ["temperature_c", "humidity_percent", "fan_speed_percent"].filter((k) => num(requested[k]) != null);
    const sendable = asked.filter((k) => payload[k] != null);
    if (!sendable.length) {
      return { ok: false, error: skipped[0]?.note || "This chamber can't take that change from the cloud.", skipped };
    }
    return { ok: true, commands: [{ kind: "setpoints", payload }], skipped, translated: false };
  }
  if (plan.kind === "apply_profile") {
    if (caps.apply_profile) return { ok: true, commands: [{ kind: "apply_profile", payload: plan.payload }], skipped: [], translated: false };
    const targets = {
      temperature_c: num(stage.temperature_c),
      humidity_percent: num(stage.humidity_percent),
      fan_speed_percent: num(stage.fan?.speed_percent ?? stage.fan_speed_percent),
    };
    const { payload, skipped } = supportedSetpoints(targets, caps, targets);
    const commands = [];
    if (payload.temperature_c != null || payload.humidity_percent != null) {
      commands.push({
        kind: "setpoints",
        payload: { ...payload, profile_id: plan.payload.profile_id, stage: plan.payload.stage, translated_from: "apply_profile" },
      });
    }
    if (stage.light && Object.keys(stage.light).length) {
      if (caps.light_schedule || caps.light_color) commands.push({ kind: "schedule", payload: { light: stage.light } });
      else skipped.push({ field: "light", note: NOTES.light });
    }
    if (!commands.length) return { ok: false, error: "This profile phase has no targets this chamber can take from the cloud.", skipped };
    return { ok: true, commands, skipped, translated: true };
  }
  if (plan.kind === "schedule") {
    if (caps.light_schedule || caps.light_color) return { ok: true, commands: [{ kind: "schedule", payload: plan.payload }], skipped: [], translated: false };
    return { ok: false, error: NOTES.light, skipped: [{ field: "light", note: NOTES.light }] };
  }
  if (plan.kind === "firmware_notice") {
    if (caps.firmware_notice) return { ok: true, commands: [{ kind: "firmware_notice", payload: plan.payload }], skipped: [], translated: false };
    return { ok: false, error: NOTES.firmware_notice, skipped: [] };
  }
  return { ok: false, error: "Unknown change.", skipped: [] };
}

/** Whether a stored command is one this chamber's firmware will act on. */
export function commandRunnable(kind, caps) {
  if (kind === "setpoints") return caps.temperature || caps.humidity || caps.fan;
  if (kind === "apply_profile") return caps.apply_profile;
  if (kind === "schedule") return caps.light_schedule || caps.light_color;
  if (kind === "firmware_notice") return caps.firmware_notice;
  return false;
}

export function commandExpiresAt(command) {
  const payload = parseJson(command?.payload, {});
  if (payload.expires_at && Number.isFinite(Date.parse(payload.expires_at))) return payload.expires_at;
  const issued = Date.parse(command?.issued_at || "");
  return Number.isFinite(issued) ? new Date(issued + COMMAND_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

const KIND_LABEL = {
  setpoints: "climate targets",
  apply_profile: "profile",
  schedule: "light",
  firmware_notice: "update notice",
};

/**
 * The true state of a command: applied/failed only on a device ack or a matching reading,
 * delivered once the chamber has pulled its inbox after the command was issued.
 */
export function commandState(command, { device = {}, caps = deviceCapabilities({}), now = Date.now() } = {}) {
  const payload = parseJson(command?.payload, {});
  const ack = payload._ack && typeof payload._ack === "object" ? payload._ack : null;
  const expiresAt = commandExpiresAt(command);
  const runnable = commandRunnable(command.kind, caps);
  let status = "queued";
  let reason = null;
  let at = null;
  if (ack) {
    const s = String(ack.status || "");
    status = s === "applied" ? "applied" : s === "expired" ? "expired" : "failed";
    reason = ack.reason || null;
    at = ack.at || command.consumed_at || null;
  } else if (command.consumed_at) {
    status = "delivered";
    reason = "The chamber picked this up but did not report a result.";
    at = command.consumed_at;
  } else if (expiresAt && Date.parse(expiresAt) <= now) {
    status = "expired";
    reason = runnable
      ? "The chamber didn't confirm this before it expired."
      : `This chamber can't take ${KIND_LABEL[command.kind] || command.kind} changes yet, so this one expired unused.`;
    at = expiresAt;
  } else {
    const inbox = Date.parse(device.last_inbox_at || "");
    const issued = Date.parse(command.issued_at || "");
    if (Number.isFinite(inbox) && Number.isFinite(issued) && inbox >= issued) {
      status = "delivered";
      at = device.last_inbox_at;
    }
    if (!runnable) {
      reason = `This chamber can't take ${KIND_LABEL[command.kind] || command.kind} changes yet, so this one was not sent.`;
    } else if (status === "delivered") {
      reason = "Waiting for the chamber to confirm.";
    } else {
      reason = "Waiting for the chamber to check in (about every 15 minutes).";
    }
  }
  return {
    id: Number(command.id),
    kind: command.kind,
    status,
    reason,
    at,
    issued_at: command.issued_at,
    expires_at: expiresAt,
    source: payload.source || null,
    summary: commandSummary(command.kind, payload),
    runnable,
  };
}

export function commandSummary(kind, payload = {}) {
  if (kind === "setpoints") {
    const parts = [];
    if (payload.temperature_c != null) parts.push(`${payload.temperature_c} °C`);
    if (payload.humidity_percent != null) parts.push(`${payload.humidity_percent}% RH`);
    if (payload.fan_speed_percent != null) parts.push(`fan ${payload.fan_speed_percent}%`);
    const base = parts.length ? `Set ${parts.join(", ")}` : "Set climate targets";
    return payload.translated_from === "apply_profile" && payload.profile_id
      ? `${base} (from ${payload.profile_id}${payload.stage ? ` ${payload.stage}` : ""})`
      : base;
  }
  if (kind === "apply_profile") return `Load profile ${payload.profile_id || "?"}${payload.stage ? ` (${payload.stage})` : ""}`;
  if (kind === "schedule") return "Set light schedule";
  if (kind === "firmware_notice") return "Show update notice";
  return kind;
}

/** Payload with bookkeeping keys stripped, for comparing two submits. */
export function commandIntent(kind, payload = {}) {
  const clean = {};
  for (const key of Object.keys(payload || {}).sort()) {
    if (key.startsWith("_") || ["expires_at", "source", "request_id", "from", "approved"].includes(key)) continue;
    clean[key] = payload[key];
  }
  return `${kind}:${JSON.stringify(clean)}`;
}
