/** Cloud chamber list, groups, and central apply. Users only see their own devices. */

import { laterIso, nowIso } from "./crypto.js";
import { requireVerified, userFromRequest } from "./auth.js";
import { isPsilocybin, ValidationError, validateStageLight } from "./profile.js";
import {
  compareReadingToStage,
  latestReading,
  downsampleHistory,
  loadRecentTelemetry,
  refuseRestrictedPack,
  TELEMETRY_HISTORY_LIMIT,
} from "./coach-learn.js";
import {
  clampAutopilotSetpoints,
  coachAutopilotAvailable,
  coachAutopilotFlagOn,
  getDeviceMode,
  noteManualSetpointCommand,
  rememberDeviceProfile,
  setDeviceAutopilotMode,
} from "./coach-autopilot.js";
import { fleetUiEnabled } from "./providers.js";
import { SQL as ALERT_SQL } from "./alerts/store.js";
import { growStage, readRules } from "./alerts/rules.js";

export const FLEET_ONLINE_MS = 15 * 60 * 1000;
export const FLEET_COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DEVICE_TYPE = "shrooly_chamber";

/** Commands the local chamber UI can do that the cloud channel cannot send yet. */
export const LOCAL_ONLY_CONTROLS = [
  { id: "water_calibration", label: "Water calibration", note: "Empty-tank calibration has to run on the chamber." },
  { id: "humidifier_speed", label: "Humidifier speed", note: "Cloud writes humidity target, not humidifier speed." },
  { id: "humidity_hysteresis", label: "Humidity band", note: "The humidity on/off band is set on the chamber." },
  { id: "air_period", label: "Air exchange period", note: "Cloud can set fan speed. Period and run time stay on the chamber." },
  { id: "temperature_enable", label: "Temperature control switch", note: "Turning heater requests on or off stays on the chamber." },
  { id: "temperature_hysteresis", label: "Temperature band", note: "The temperature on/off band is set on the chamber." },
  { id: "temperature_warnings", label: "Temperature warnings", note: "Local warning limits stay on the chamber. Account alerts use their own rules." },
  { id: "display", label: "Display flip", note: "The e-paper flip switch is on the chamber." },
  { id: "timezone", label: "Timezone", note: "Chamber clock timezone is set on the chamber." },
  { id: "firmware", label: "Software update", note: "Updates install from the chamber page or USB." },
  { id: "wifi", label: "Wi-Fi", note: "Network setup stays on the chamber." },
];

export const CLOUD_CONTROLS = [
  { id: "setpoints", label: "Temperature and humidity targets" },
  { id: "fan", label: "Fan speed" },
  { id: "light", label: "Light schedule and color" },
  { id: "profile", label: "Profile and grow phase" },
  { id: "name", label: "Device name" },
  { id: "grow", label: "Grow start day" },
];

export function deviceTypeLabel(type) {
  const id = String(type || DEFAULT_DEVICE_TYPE);
  if (id === "shrooly_chamber") return "Shrooly chamber";
  return id.replaceAll("_", " ");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseJson(value, fallback = null) {
  if (value == null || value === "" || value === "null") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function commandExpired(payload, now = Date.now()) {
  const exp = payload?.expires_at;
  if (!exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t <= now;
}

export function deviceIsOnline(device, now = Date.now()) {
  const seen = device?.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
  return Number.isFinite(seen) && now - seen <= FLEET_ONLINE_MS;
}

function expandStage(stage = {}) {
  const rh = num(stage.humidity_percent);
  const rhHyst = num(stage.humidity_hysteresis);
  const temp = num(stage.temperature_c);
  const tempHyst = num(stage.temperature_hysteresis);
  return {
    ...stage,
    humidity_target_min: num(stage.humidity_target_min) ?? (rh != null && rhHyst != null ? rh - rhHyst : rh),
    humidity_target_max: num(stage.humidity_target_max) ?? (rh != null && rhHyst != null ? rh + rhHyst : rh),
    temperature_target_min: num(stage.temperature_target_min) ?? (temp != null && tempHyst != null ? temp - tempHyst : temp),
    temperature_target_max: num(stage.temperature_target_max) ?? (temp != null && tempHyst != null ? temp + tempHyst : temp),
  };
}

function stageFromProfile(profile, stageId) {
  if (!profile) return {};
  const stages = profile.stages || [];
  return expandStage(stages.find((s) => s.id === stageId) || stages.find((s) => s.id === "fruiting") || stages[0] || {});
}

function lightFromStage(stage = {}) {
  const light = stage.light || {};
  if (!Object.keys(light).length) return null;
  return {
    sunrise_hour: light.sunrise_hour ?? null,
    duration_hours: light.duration_hours ?? null,
    white_led_lux: light.white_led_lux ?? null,
    red_percent: light.red_percent ?? null,
    green_percent: light.green_percent ?? null,
    blue_percent: light.blue_percent ?? null,
  };
}

function firmwareFromReading(reading, raw) {
  const doc = raw || {};
  return doc.firmware_version || doc.firmware || doc.version || reading?.firmware || null;
}

async function loadProfile(db, user, profileId) {
  if (!profileId) return null;
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row) return null;
  const published = Boolean(Number(row.published));
  const owned = user && row.author_id != null && Number(row.author_id) === Number(user.id);
  if (!published && !owned) return null;
  const doc = typeof row.document === "string" ? JSON.parse(row.document) : row.document;
  return doc ? { ...doc, id: doc.id || row.id } : null;
}

async function requireUser(request, db) {
  const { user } = await userFromRequest(request, db);
  if (!user) throw new ValidationError("sign in required", 401);
  return { user };
}

async function requireSignedInUser(request, db) {
  const { user } = await requireUser(request, db);
  requireVerified(user);
  return { user };
}

async function requireFleetTools(request, db, env) {
  if (!fleetUiEnabled(env)) return { error: json({ error: "not found" }, 404) };
  return requireSignedInUser(request, db);
}

async function ownedDevice(db, user, deviceId) {
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (!device || Number(device.owner_id) !== Number(user.id)) return null;
  return device;
}

async function ownedGroup(db, user, groupId) {
  const group = await db.one("SELECT * FROM device_groups WHERE id=?", [groupId]);
  if (!group || Number(group.owner_id) !== Number(user.id)) return null;
  return group;
}

async function memberDeviceIds(db, groupId) {
  const rows = await db.all("SELECT * FROM device_group_members WHERE group_id=?", [groupId]);
  return (rows || []).map((r) => r.device_id);
}

async function groupIdsForDevice(db, ownerId, deviceId) {
  const members = await db.all("SELECT * FROM device_group_members WHERE device_id=?", [deviceId]);
  const groups = await db.all("SELECT * FROM device_groups WHERE owner_id=?", [ownerId]);
  const owned = new Set((groups || []).map((g) => Number(g.id)));
  return (members || []).filter((m) => owned.has(Number(m.group_id))).map((m) => Number(m.group_id));
}

function fleetAlerts({ device, reading, stage, now }) {
  const alerts = [];
  if (!deviceIsOnline(device, now)) {
    alerts.push({ kind: "offline", message: "Chamber looks offline." });
  }
  if (!reading || (reading.temperature == null && reading.humidity == null)) {
    alerts.push({ kind: "missing", message: "Readings are missing." });
  } else if (reading.age_seconds != null && reading.age_seconds * 1000 > FLEET_ONLINE_MS) {
    alerts.push({ kind: "stale", message: "Readings are stale (older than 15 minutes)." });
  }
  for (const flag of compareReadingToStage(reading, stage)) {
    alerts.push({ kind: "out_of_range", message: flag.message });
  }
  return alerts;
}

function todayUtc(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function growFromProfile(profile, stage, { day = null, startedOn = null } = {}) {
  const stages = Array.isArray(profile?.stages) ? profile.stages : [];
  const total = stages.reduce((sum, item) => sum + (Number(item.duration_days) || 0), 0) || null;
  return {
    day: day != null && Number.isFinite(Number(day)) ? Number(day) : null,
    phase: stage?.name || stage?.id || null,
    started_on: startedOn || null,
    total_days: total,
    stages: stages.map((item) => ({ id: item.id, name: item.name || item.id, duration_days: Number(item.duration_days) || 0 })),
  };
}

async function loadGrowTracking(db, user, device, modeRow, current, now) {
  const rulesRow = await db.one(ALERT_SQL.rulesGet, [device.id]);
  const rules = readRules(rulesRow?.document);
  const trackedId = rules.grow?.profile_id || modeRow.profile_id;
  const profile = await loadProfile(db, user, trackedId);
  const tracked = profile && rules.grow?.started_on ? growStage(profile, rules.grow.started_on, todayUtc(now)) : null;
  const stageId = tracked?.stage?.id || current?.stage || null;
  const stage = stageFromProfile(profile, stageId);
  const day = tracked?.day ?? current?.grow_day ?? null;
  return {
    profile,
    stage,
    grow: growFromProfile(profile, stage, { day, startedOn: rules.grow?.started_on || null }),
  };
}

/**
 * Coach details ride on the device payload only for users who can use Coach
 * (flag on plus beta or entitlement). Everyone else never sees Coach state.
 * Pass `coachAvailable` when enriching many devices to check access once.
 */
export async function enrichDevice(db, env, user, device, { now = Date.now(), coachAvailable } = {}) {
  const samples = await loadRecentTelemetry(db, device.id, { now });
  const current = latestReading(samples, now);
  const latestDoc = samples.length
    ? parseJson(samples.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).at(-1).document, {})
    : {};
  const modeRow = await getDeviceMode(db, device.id, user.id);
  const tracked = await loadGrowTracking(db, user, device, modeRow, current, now);
  const profile = tracked.profile;
  const stage = tracked.stage;
  const offMenu = Boolean(profile && (isPsilocybin(profile) || refuseRestrictedPack(profile)));
  const certs = await db.all("SELECT * FROM device_certs WHERE device_id=?", [device.id]);
  const activeCert = (certs || [])
    .filter((c) => c.status === "active")
    .sort((a, b) => String(b.not_after || "").localeCompare(String(a.not_after || "")))[0];
  const showCoach = !offMenu && (coachAvailable ?? (await coachAutopilotAvailable(env, db, user)));
  const coach =
    !showCoach
      ? null
      : {
          mode: modeRow.mode,
          status: Number(modeRow.paused) ? "paused" : modeRow.mode,
          pause_reason: modeRow.pause_reason || null,
        };
  const linked = device.status === "active" || device.status === "claimed";
  const online = deviceIsOnline(device, now);
  const deviceType = device.device_type || DEFAULT_DEVICE_TYPE;
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    owner_id: device.owner_id,
    last_seen_at: device.last_seen_at,
    device_type: deviceType,
    device_type_label: deviceTypeLabel(deviceType),
    online,
    linked,
    controllable: linked && device.status === "active",
    reading: current
      ? {
          temperature: current.temperature,
          humidity: current.humidity,
          temperature_setpoint: current.temperature_setpoint,
          humidity_setpoint: current.humidity_setpoint,
          fan_speed: current.fan_speed,
          water_level: current.water_level,
          reading_at: current.reading_at,
          age_seconds: current.age_seconds,
        }
      : null,
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          pack: profile.pack || "culinary",
          species: profile.species || "",
          strain: profile.strain || "",
        }
      : null,
    stage: stage.id ? { id: stage.id, name: stage.name || stage.id } : null,
    grow: tracked.grow,
    setpoints: {
      temperature_c: current?.temperature_setpoint ?? parseJson(modeRow.last_setpoints, {})?.temperature_c ?? null,
      humidity_percent: current?.humidity_setpoint ?? parseJson(modeRow.last_setpoints, {})?.humidity_percent ?? null,
      fan_speed_percent: current?.fan_speed ?? parseJson(modeRow.last_setpoints, {})?.fan_speed_percent ?? null,
    },
    light: lightFromStage(stage),
    coach,
    firmware: firmwareFromReading(current, latestDoc),
    cert_expires_at: activeCert?.not_after || null,
    alerts: fleetAlerts({ device, reading: current, stage, now }),
    group_ids: await groupIdsForDevice(db, user.id, device.id),
    off_menu: offMenu,
    cloud_controls: CLOUD_CONTROLS,
    local_only: LOCAL_ONLY_CONTROLS,
  };
}

export function validateFleetChange({ action, payload = {}, profile, stage, currentSetpoints = {} } = {}) {
  if (action === "setpoints") {
    const proposed = {
      temperature_c: payload.temperature_c,
      humidity_percent: payload.humidity_percent,
      fan_speed_percent: payload.fan_speed_percent,
    };
    if (proposed.temperature_c == null && proposed.humidity_percent == null && proposed.fan_speed_percent == null) {
      return { ok: false, error: "Pick a temperature, humidity, or fan change." };
    }
    const next = clampAutopilotSetpoints({ ...currentSetpoints, ...proposed }, stage);
    return {
      ok: true,
      kind: "setpoints",
      payload: next,
      preview: { from: currentSetpoints, to: next },
    };
  }
  if (action === "profile") {
    if (!profile) return { ok: false, error: "Profile not found." };
    const stageId = payload.stage || stage?.id || "fruiting";
    return {
      ok: true,
      kind: "apply_profile",
      payload: { profile_id: profile.id, stage: stageId },
      preview: { profile_id: profile.id, stage: stageId },
    };
  }
  if (action === "light") {
    const fromStage = lightFromStage(stage) || {};
    const incoming = payload.light && typeof payload.light === "object" ? payload.light : {};
    const light = { ...fromStage, ...incoming };
    if (!Object.keys(light).length) return { ok: false, error: "No light recipe on this profile stage." };
    try {
      const checked = validateStageLight(light);
      return { ok: true, kind: "schedule", payload: { light: checked }, preview: { light: checked } };
    } catch (err) {
      return { ok: false, error: err.message || "Light recipe is not valid." };
    }
  }
  if (action === "coach_mode") {
    if (profile && refuseRestrictedPack(profile)) {
      return { ok: false, error: "Coach is not available for off-menu varieties." };
    }
    const mode = payload.mode === "autopilot" ? "autopilot" : "advisor";
    return { ok: true, kind: "coach_mode", payload: { mode, profile_id: profile?.id || payload.profile_id }, preview: { mode } };
  }
  return { ok: false, error: "Unknown change." };
}

async function resolveTargets(db, user, { device_ids, group_id } = {}) {
  if (group_id) {
    const group = await ownedGroup(db, user, group_id);
    if (!group) throw new ValidationError("Group not found.", 404);
    const ids = await memberDeviceIds(db, group.id);
    const devices = [];
    for (const id of ids) {
      const device = await ownedDevice(db, user, id);
      if (device) devices.push(device);
    }
    return { devices, scope: "group", target: String(group.id) };
  }
  const ids = Array.isArray(device_ids) ? device_ids : [];
  const devices = [];
  for (const id of ids) {
    const device = await ownedDevice(db, user, id);
    if (!device) throw new ValidationError("not your device", 403);
    devices.push(device);
  }
  return { devices, scope: devices.length === 1 ? "device" : "selection", target: ids.join(",") };
}

async function queueCommand(db, device, kind, payload, now) {
  const body = { ...payload, source: "fleet", expires_at: laterIso(FLEET_COMMAND_TTL_MS) };
  await db.run(
    "INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
    [device.id, kind, JSON.stringify(body), nowIso(), null]
  );
  return deviceIsOnline(device, now) ? "applied" : "queued";
}

async function applyOne(db, env, user, device, { action, payload }, now) {
  if (device.status === "revoked") return { device_id: device.id, status: "failed", error: "This chamber is unlinked." };
  if (device.status !== "active" && device.status !== "claimed") {
    return { device_id: device.id, status: "failed", error: "Chamber is not linked." };
  }
  const modeRow = await getDeviceMode(db, device.id, user.id);
  const profileId = payload.profile_id || modeRow.profile_id;
  const profile = await loadProfile(db, user, profileId);
  const samples = await loadRecentTelemetry(db, device.id, { now });
  const current = latestReading(samples, now);
  const stage = stageFromProfile(profile, payload.stage || current?.stage);
  const currentSetpoints = {
    temperature_c: current?.temperature_setpoint,
    humidity_percent: current?.humidity_setpoint,
  };
  const plan = validateFleetChange({ action, payload, profile, stage, currentSetpoints });
  if (!plan.ok) return { device_id: device.id, name: device.name, status: "failed", error: plan.error, preview: null };
  if (plan.kind === "coach_mode") {
    if (!coachAutopilotFlagOn(env)) {
      return { device_id: device.id, name: device.name, status: "failed", error: "Coach Autopilot is off.", preview: plan.preview };
    }
    const result = await setDeviceAutopilotMode(db, env, user, {
      deviceId: device.id,
      mode: plan.payload.mode,
      profileId: plan.payload.profile_id,
    });
    if (result.error) return { device_id: device.id, name: device.name, status: "failed", error: result.error, preview: plan.preview };
    return { device_id: device.id, name: device.name, status: "applied", preview: plan.preview };
  }
  if (device.status !== "active") {
    return { device_id: device.id, name: device.name, status: "failed", error: "Chamber is not linked.", preview: plan.preview };
  }
  const status = await queueCommand(db, device, plan.kind, plan.payload, now);
  if (plan.kind === "setpoints") {
    await noteManualSetpointCommand(db, device, { ...plan.payload, source: "fleet" });
  }
  if (plan.kind === "apply_profile" && plan.payload.profile_id) {
    await rememberDeviceProfile(db, device.id, user.id, plan.payload.profile_id);
  }
  return { device_id: device.id, name: device.name, status, preview: plan.preview };
}

async function writeAudit(db, user, { action, scope, target, preview, results }) {
  await db.run(
    "INSERT INTO fleet_audit (owner_id, actor_id, action, scope, target, preview, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      user.id,
      user.id,
      action,
      scope,
      target,
      JSON.stringify(preview || null),
      JSON.stringify(results || null),
      nowIso(),
    ]
  );
}

function publicGroup(row, deviceIds = []) {
  return { id: Number(row.id), owner_id: Number(row.owner_id), name: row.name, device_ids: deviceIds, updated_at: row.updated_at };
}

export async function handleFleet(method, path, url, request, env) {
  if (!path.startsWith("/api/fleet")) return null;
  const { db } = env;

  if (method === "GET" && path === "/api/fleet") {
    const { user } = await userFromRequest(request, db);
    return json({ available: fleetUiEnabled(env), signed_in: Boolean(user) });
  }

  const reader = await requireUser(request, db);
  const user = reader.user;
  const write = () => requireVerified(user);

  if (method === "GET" && path === "/api/fleet/devices") {
    const rows = await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id]);
    const devices = [];
    const coachAvailable = await coachAutopilotAvailable(env, db, user);
    for (const row of rows || []) devices.push(await enrichDevice(db, env, user, row, { coachAvailable }));
    return json({ devices });
  }

  const detail = path.match(/^\/api\/fleet\/devices\/([^/]+)$/);
  if (detail && method === "GET") {
    const device = await ownedDevice(db, user, decodeURIComponent(detail[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours")) || 24));
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const samples = await loadRecentTelemetry(db, device.id, {
      now: Date.now(),
      windowMs: hours * 3600 * 1000,
      limit: TELEMETRY_HISTORY_LIMIT,
    });
    const history = downsampleHistory(
      samples.filter((s) => !s.created_at || s.created_at >= since),
      { hours }
    );
    return json({ device: await enrichDevice(db, env, user, device), history });
  }

  if (detail && method === "PATCH") {
    write();
    const device = await ownedDevice(db, user, decodeURIComponent(detail[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) throw new ValidationError("Name is required.", 400);
    await db.run("UPDATE cloud_devices SET name=? WHERE id=?", [name, device.id]);
    await writeAudit(db, user, { action: "rename", scope: "device", target: device.id, preview: { name }, results: [{ device_id: device.id, status: "applied" }] });
    return json({ ok: true, id: device.id, name });
  }

  const unlink = path.match(/^\/api\/fleet\/devices\/([^/]+)\/unlink$/);
  if (unlink && method === "POST") {
    write();
    const device = await ownedDevice(db, user, decodeURIComponent(unlink[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const body = await request.json().catch(() => ({}));
    if (!body.confirm) throw new ValidationError("Confirm Unlink to continue.", 400);
    const res = await fetchLikeRevoke(env, request, device.id);
    await writeAudit(db, user, {
      action: "unlink",
      scope: "device",
      target: device.id,
      preview: { confirm: true },
      results: [{ device_id: device.id, status: res.ok ? "applied" : "failed", error: res.error || null }],
    });
    if (!res.ok) return json({ error: res.error || "Could not unlink." }, res.status || 400);
    return json({ ok: true, device_id: device.id, status: "revoked" });
  }

  const deviceAction = path.match(/^\/api\/fleet\/devices\/([^/]+)\/(preview|apply)$/);
  if (deviceAction && method === "POST") {
    write();
    const device = await ownedDevice(db, user, decodeURIComponent(deviceAction[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const body = await request.json().catch(() => ({}));
    const now = Date.now();
    if (deviceAction[2] === "preview") {
      const modeRow = await getDeviceMode(db, device.id, user.id);
      const profile = await loadProfile(db, user, body.payload?.profile_id || modeRow.profile_id);
      const samples = await loadRecentTelemetry(db, device.id, { now });
      const current = latestReading(samples, now);
      const stage = stageFromProfile(profile, body.payload?.stage || current?.stage);
      const plan = validateFleetChange({
        action: body.action,
        payload: body.payload || {},
        profile,
        stage,
        currentSetpoints: { temperature_c: current?.temperature_setpoint, humidity_percent: current?.humidity_setpoint },
      });
      return json({
        scope: "device",
        results: [
          {
            device_id: device.id,
            name: device.name,
            status: plan.ok ? "ok" : "failed",
            error: plan.error || null,
            preview: plan.preview || null,
          },
        ],
      });
    }
    const result = await applyOne(db, env, user, device, { action: body.action, payload: body.payload || {} }, now);
    await writeAudit(db, user, {
      action: body.action,
      scope: "device",
      target: device.id,
      preview: body.payload || {},
      results: [result],
    });
    return json({ scope: "device", results: [result] });
  }

  const tools = await requireFleetTools(request, db, env);
  if (tools.error) return tools.error;

  if (method === "GET" && path === "/api/fleet/groups") {
    const groups = await db.all("SELECT * FROM device_groups WHERE owner_id=?", [user.id]);
    const out = [];
    for (const group of groups || []) {
      out.push(publicGroup(group, await memberDeviceIds(db, group.id)));
    }
    return json({ groups: out });
  }

  if (method === "POST" && path === "/api/fleet/groups") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) throw new ValidationError("Name is required.", 400);
    await db.run("INSERT INTO device_groups (owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [
      user.id,
      name,
      nowIso(),
      nowIso(),
    ]);
    const groups = await db.all("SELECT * FROM device_groups WHERE owner_id=?", [user.id]);
    const created = (groups || []).slice().sort((a, b) => Number(b.id) - Number(a.id))[0];
    await writeAudit(db, user, { action: "group_create", scope: "group", target: String(created?.id || ""), preview: { name }, results: [] });
    return json({ group: publicGroup(created, []) });
  }

  const groupMatch = path.match(/^\/api\/fleet\/groups\/([^/]+)$/);
  if (groupMatch && method === "PATCH") {
    const group = await ownedGroup(db, user, groupMatch[1]);
    if (!group) return json({ error: "Group not found." }, 404);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) throw new ValidationError("Name is required.", 400);
    await db.run("UPDATE device_groups SET name=?, updated_at=? WHERE id=?", [name, nowIso(), group.id]);
    await writeAudit(db, user, { action: "group_rename", scope: "group", target: String(group.id), preview: { name }, results: [] });
    return json({ group: publicGroup({ ...group, name }, await memberDeviceIds(db, group.id)) });
  }

  if (groupMatch && method === "DELETE") {
    const group = await ownedGroup(db, user, groupMatch[1]);
    if (!group) return json({ error: "Group not found." }, 404);
    await db.run("DELETE FROM device_group_members WHERE group_id=?", [group.id]);
    await db.run("DELETE FROM device_groups WHERE id=?", [group.id]);
    await writeAudit(db, user, {
      action: "group_delete",
      scope: "group",
      target: String(group.id),
      preview: { name: group.name },
      results: [],
    });
    return json({ ok: true });
  }

  const membersMatch = path.match(/^\/api\/fleet\/groups\/([^/]+)\/members$/);
  if (membersMatch && method === "POST") {
    const group = await ownedGroup(db, user, membersMatch[1]);
    if (!group) return json({ error: "Group not found." }, 404);
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.device_ids) ? body.device_ids.map(String) : [];
    for (const id of ids) {
      if (!(await ownedDevice(db, user, id))) throw new ValidationError("not your device", 403);
    }
    await db.run("DELETE FROM device_group_members WHERE group_id=?", [group.id]);
    for (const id of ids) {
      await db.run("INSERT INTO device_group_members (group_id, device_id, added_at) VALUES (?, ?, ?)", [group.id, id, nowIso()]);
    }
    await writeAudit(db, user, {
      action: "group_assign",
      scope: "group",
      target: String(group.id),
      preview: { device_ids: ids },
      results: ids.map((id) => ({ device_id: id, status: "applied" })),
    });
    return json({ group: publicGroup(group, ids) });
  }

  if (method === "POST" && (path === "/api/fleet/preview" || path === "/api/fleet/apply")) {
    const body = await request.json().catch(() => ({}));
    const { devices, scope, target } = await resolveTargets(db, user, body);
    if (!devices.length) throw new ValidationError("Pick at least one chamber.", 400);
    const now = Date.now();
    const results = [];
    for (const device of devices) {
      if (path.endsWith("/preview")) {
        const modeRow = await getDeviceMode(db, device.id, user.id);
        const profile = await loadProfile(db, user, body.payload?.profile_id || modeRow.profile_id);
        const samples = await loadRecentTelemetry(db, device.id, { now });
        const current = latestReading(samples, now);
        const stage = stageFromProfile(profile, body.payload?.stage || current?.stage);
        const plan = validateFleetChange({
          action: body.action,
          payload: body.payload || {},
          profile,
          stage,
          currentSetpoints: { temperature_c: current?.temperature_setpoint, humidity_percent: current?.humidity_setpoint },
        });
        results.push({
          device_id: device.id,
          name: device.name,
          status: plan.ok ? "ok" : "failed",
          error: plan.error || null,
          preview: plan.preview || null,
        });
      } else {
        results.push(await applyOne(db, env, user, device, { action: body.action, payload: body.payload || {} }, now));
      }
    }
    if (path.endsWith("/apply")) {
      await writeAudit(db, user, { action: body.action, scope, target, preview: body.payload || {}, results });
    }
    return json({ scope, results });
  }

  if (method === "GET" && path === "/api/fleet/audit") {
    const rows = await db.all("SELECT * FROM fleet_audit WHERE owner_id=? ORDER BY id DESC LIMIT ?", [user.id, 40]);
    const entries = (rows || []).map((row) => ({
        id: row.id,
        action: row.action,
        scope: row.scope,
        target: row.target,
        preview: parseJson(row.preview),
        results: parseJson(row.results),
        created_at: row.created_at,
      }));
    return json({ entries });
  }

  return null;
}

async function fetchLikeRevoke(env, request, deviceId) {
  const { handleDevices } = await import("./devices.js");
  const url = new URL(request.url);
  const res = await handleDevices("POST", `/api/devices/${deviceId}/revoke`, url, request, env);
  if (!res) return { ok: false, error: "Revoke is unavailable.", status: 500 };
  const data = await res.json().catch(() => ({}));
  if (res.status >= 400) return { ok: false, error: data.error || "Could not unlink.", status: res.status };
  return { ok: true };
}
