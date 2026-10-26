/**
 * Photo check: a grower snaps or uploads a photo, optionally picks one of their chambers or a
 * culinary profile, and gets a plain-language recommendation back.
 *
 * - Gated like Coach (paid, beta while BETA_ACTIVE is on, or a comp id). The caller checks that.
 * - The photo is never stored. It is checked, stripped of EXIF and location (photos.js), sent to
 *   the vision model once, and dropped.
 * - Off-menu (psilocybin) grows and profiles are refused before the model is called.
 * - Each check counts against the per-user daily photo cap and neuron caps in coach.js, and the
 *   real neuron use is added to a per-user vision counter so /admin spend can show it.
 */

import { nowIso } from "./crypto.js";
import { expandStage, resolveAllowedProfile } from "./coach-autopilot.js";
import { latestReading, loadRecentTelemetry, parseTelemetry, refuseRestrictedPack } from "./coach-learn.js";
import { enrichDevice } from "./fleet.js";
import { PHOTO_CLIENT_MAX_EDGE, bytesToBase64, decodePhotoBase64, sanitizeGrowPhoto } from "./photos.js";
import { ValidationError, isPsilocybin, normalizeStoredProfileLight } from "./profile.js";

/** Neurons per million tokens, from Cloudflare's Workers AI price list ($0.011 per 1,000 neurons). */
export const VISION_RATES = {
  "@cf/meta/llama-4-scout-17b-16e-instruct": { input: 24545, output: 77273 },
  "@cf/meta/llama-3.2-11b-vision-instruct": { input: 4410, output: 61493 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 31876, output: 50488 },
};

export const OFF_MENU_REFUSAL = "Photo checks are for culinary grows only.";
export const NOT_A_GROW = "That photo does not look like a mushroom grow. Try a closer shot of the block or the mushrooms.";

/** Real neurons when Workers AI reports them, otherwise an estimate from tokens. */
export function visionNeurons(model, usage = {}) {
  const reported = Number(usage?.neurons);
  if (Number.isFinite(reported) && reported > 0) return Math.ceil(reported);
  const rate = VISION_RATES[model] || VISION_RATES["@cf/meta/llama-4-scout-17b-16e-instruct"];
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens) || 1100;
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens) || 250;
  return Math.ceil((input / 1e6) * rate.input + (output / 1e6) * rate.output);
}

const visionKey = (userId, day) => `vision:user:${userId}:${day}`;
const VISION_COUNTER_TTL_MS = 400 * 86400000;

/** Per-user, per-UTC-day vision spend counter in coach_cache (no schema change). */
export async function addVisionUsage(db, userId, neurons, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = visionKey(userId, day);
  const row = await db.one("SELECT * FROM coach_cache WHERE cache_key=?", [key]);
  let value = { calls: 0, neurons: 0 };
  try {
    if (row?.value) value = { ...value, ...JSON.parse(row.value) };
  } catch {
    /* start over */
  }
  value.calls += 1;
  value.neurons += Math.max(0, Number(neurons) || 0);
  await db.run("INSERT OR REPLACE INTO coach_cache (cache_key, value, expires_at) VALUES (?, ?, ?)", [
    key,
    JSON.stringify(value),
    new Date(now + VISION_COUNTER_TTL_MS).toISOString(),
  ]);
  return value;
}

function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

function stats(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return { min: round1(Math.min(...nums)), max: round1(Math.max(...nums)), avg: round1(nums.reduce((a, b) => a + b, 0) / nums.length) };
}

function chamberIsLinked(row) {
  return row && row.status !== "revoked" && (row.status === "claimed" || row.status === "active");
}

async function publishedCulinaryProfiles(db) {
  const rows = (await db.all("SELECT * FROM profiles WHERE published=1")) || [];
  const out = [];
  for (const row of rows) {
    let doc = row.document;
    if (typeof doc === "string") {
      try {
        doc = JSON.parse(doc);
      } catch {
        continue;
      }
    }
    if (!doc) continue;
    const profile = normalizeStoredProfileLight({ ...doc, id: doc.id || row.id });
    if (isPsilocybin(profile) || refuseRestrictedPack(profile)) continue;
    out.push({ id: profile.id, name: profile.name || profile.id, species: profile.species || "" });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** What the photo check form needs: the user's culinary chambers and the culinary profile list. */
export async function photoCheckOptions(db, env, user, { now = Date.now() } = {}) {
  const rows = ((await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id])) || []).filter(chamberIsLinked);
  const chambers = [];
  for (const row of rows) {
    const device = await enrichDevice(db, env, user, row, { now, coachAvailable: true });
    // Off-menu chambers are left out of the list entirely.
    if (device.off_menu) continue;
    chambers.push({
      id: device.id,
      name: device.name || "Chamber",
      profile: device.profile ? { id: device.profile.id, name: device.profile.name } : null,
      stage: device.stage,
      grow_day: device.grow?.grow_day ?? null,
    });
  }
  return { chambers, profiles: await publishedCulinaryProfiles(db) };
}

function range(min, max) {
  const lo = Number(min);
  const hi = Number(max);
  if (min == null || max == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return `${lo} to ${hi}`;
}

function stageTargets(raw) {
  if (!raw) return null;
  const stage = expandStage(raw);
  return {
    stage: stage.name || stage.id || null,
    days: Number(stage.duration_days) || null,
    temperature_c: range(stage.temperature_target_min, stage.temperature_target_max),
    humidity_percent: range(stage.humidity_target_min, stage.humidity_target_max),
  };
}

/** Context from one of the user's chambers: profile, stage, grow day, targets and recent readings. */
export async function chamberContext(db, env, user, deviceId, { now = Date.now() } = {}) {
  const row = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (!row || Number(row.owner_id) !== Number(user.id) || !chamberIsLinked(row)) {
    throw new ValidationError("Pick one of your linked chambers.", 404);
  }
  const device = await enrichDevice(db, env, user, row, { now, coachAvailable: true });
  if (device.off_menu) throw new ValidationError(OFF_MENU_REFUSAL, 400);
  const rows = await loadRecentTelemetry(db, row.id, { now });
  const samples = parseTelemetry(rows);
  const current = latestReading(rows, now);
  return {
    source: "chamber",
    label: device.name || "Chamber",
    chamber: {
      name: device.name || "Chamber",
      profile: device.profile ? `${device.profile.name}${device.profile.species ? ` (${device.profile.species})` : ""}` : null,
      stage: device.stage?.name || null,
      grow_day: device.grow?.grow_day ?? null,
      stage_day: device.grow?.stage_day ?? null,
      stage_days: device.grow?.stage_days ?? null,
      targets: device.targets
        ? {
            temperature_c: range(device.targets.temperature_min, device.targets.temperature_max),
            humidity_percent: range(device.targets.humidity_min, device.targets.humidity_max),
          }
        : null,
      now: current
        ? { temperature_c: round1(current.temperature), humidity_percent: round1(current.humidity), minutes_old: current.age_seconds != null ? Math.round(current.age_seconds / 60) : null }
        : null,
      last_hours: samples.length
        ? { readings: samples.length, temperature_c: stats(samples.map((s) => s.temperature)), humidity_percent: stats(samples.map((s) => s.humidity)) }
        : null,
      setpoints: device.setpoints || null,
    },
    profile_id: device.profile?.id || null,
  };
}

/** Context from a culinary profile alone (no chamber). */
export async function profileContext(db, profileId, stageId) {
  const resolved = await resolveAllowedProfile(db, profileId);
  if (resolved.error) {
    const offMenu = /off-menu/i.test(resolved.error);
    throw new ValidationError(offMenu ? OFF_MENU_REFUSAL : "Pick a culinary profile.", 400);
  }
  const profile = resolved.profile;
  const stages = profile.stages || [];
  const stage = stages.find((s) => s.id === stageId) || null;
  return {
    source: "profile",
    label: profile.name || profile.id,
    profile: {
      name: profile.name || profile.id,
      species: profile.species || null,
      stage_you_picked: stage ? stage.name || stage.id : null,
      stages: stages.map(stageTargets),
    },
    profile_id: profile.id,
  };
}

export const PHOTO_SYSTEM_PROMPT = [
  "You are Grow Coach for Shroom Labs. You look at one photo of a culinary mushroom grow (oyster, shiitake, lion's mane, king oyster and similar) and give the grower a short, practical recommendation.",
  "Use the grow context JSON when it is there: compare what you see with the stage, grow day, targets and recent readings. If the readings are outside the targets, say so plainly.",
  "Write for a home grower. Short sentences. No jargon. Do not use dashes as punctuation. No markdown.",
  "Never give advice on psilocybin or any drug mushroom. If the photo shows one, or is not a mushroom grow at all, set off_topic to true and leave the other fields short.",
  "If you see possible mold or contamination, say what you see and how sure you are. Do not guess wildly.",
  'Reply with JSON only: {"off_topic":false,"summary":"one or two sentences on how it looks","stage":"colonizing|pinning|fruiting|ready to harvest|past harvest|unclear","issues":[{"label":"short name","detail":"one sentence","severity":"low|medium|high"}],"next_steps":["two to four short steps"],"confidence":0.0}',
].join(" ");

/** Pull a JSON object out of a model reply that may wrap it in code fences or prose. */
export function parseModelJson(raw) {
  const text = String(raw || "").trim();
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  for (const candidate of [fenced, fenced.slice(fenced.indexOf("{"), fenced.lastIndexOf("}") + 1)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** Our voice: no em or en dashes in what we show. */
export function plain(text, max = 400) {
  return String(text ?? "")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const STAGES = new Set(["colonizing", "pinning", "fruiting", "ready to harvest", "past harvest", "unclear"]);
const SEVERITIES = new Set(["low", "medium", "high"]);
const DRUG_WORDS = /psilocyb|psilocin|magic mushroom|cubensis|liberty cap|panaeolus/i;

/** Shape a model reply into what the page shows. Anything off-menu or off-topic becomes a refusal. */
export function shapeRecommendation(parsed, raw) {
  if (!parsed) {
    const text = plain(raw, 600);
    if (!text || DRUG_WORDS.test(text)) return { off_topic: true, summary: NOT_A_GROW, stage: "unclear", issues: [], next_steps: [], confidence: 0 };
    return { off_topic: false, summary: text, stage: "unclear", issues: [], next_steps: [], confidence: 0.3 };
  }
  const blob = JSON.stringify(parsed);
  if (parsed.off_topic === true || DRUG_WORDS.test(blob)) {
    return { off_topic: true, summary: NOT_A_GROW, stage: "unclear", issues: [], next_steps: [], confidence: 0 };
  }
  const stage = String(parsed.stage || "").toLowerCase().trim();
  const confidence = Number(parsed.confidence);
  return {
    off_topic: false,
    summary: plain(parsed.summary, 400) || "Here is what I can see.",
    stage: STAGES.has(stage) ? stage : "unclear",
    issues: (Array.isArray(parsed.issues) ? parsed.issues : [])
      .slice(0, 4)
      .map((i) => (typeof i === "string" ? { label: plain(i, 60), detail: "", severity: "low" } : {
        label: plain(i?.label, 60),
        detail: plain(i?.detail, 200),
        severity: SEVERITIES.has(String(i?.severity)) ? String(i.severity) : "low",
      }))
      .filter((i) => i.label),
    next_steps: (Array.isArray(parsed.next_steps) ? parsed.next_steps : [parsed.next_steps])
      .filter(Boolean)
      .slice(0, 4)
      .map((s) => plain(s, 200))
      .filter(Boolean),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
  };
}

/** Validate the body and build the grow context. Throws before any model call or cap use. */
export async function preparePhotoCheck(db, env, user, body = {}, { now = Date.now() } = {}) {
  if (refuseRestrictedPack({ pack: body.pack, tags: body.tags }) || String(body.profile_id || "").includes("psilocybin")) {
    throw new ValidationError(OFF_MENU_REFUSAL, 400);
  }
  if (!body.photo_base64) throw new ValidationError("Add a photo first.");
  const photo = sanitizeGrowPhoto(decodePhotoBase64(body.photo_base64));
  if (photo.width > PHOTO_CLIENT_MAX_EDGE || photo.height > PHOTO_CLIENT_MAX_EDGE) {
    throw new ValidationError(`Use a photo ${PHOTO_CLIENT_MAX_EDGE} pixels or smaller on each side.`);
  }
  let context = { source: "none", label: null, profile_id: null };
  if (body.device_id) context = await chamberContext(db, env, user, String(body.device_id), { now });
  else if (body.profile_id) context = await profileContext(db, String(body.profile_id), body.stage_id ? String(body.stage_id) : null);
  const note = plain(body.note, 300);
  return { photo, context, note };
}

/** Ask the vision model. Returns the shaped recommendation plus usage. */
export async function askVision(provider, { photo, context, note }) {
  const { source, label, profile_id, ...rest } = context;
  const grounding = { ...rest };
  if (note) grounding.grower_note = note;
  const result = await provider.photoCheck({
    imageBase64: bytesToBase64(photo.bytes),
    contentType: photo.contentType,
    system: PHOTO_SYSTEM_PROMPT,
    context: Object.keys(grounding).length ? grounding : null,
  });
  if (result.unavailable) return { unavailable: true };
  const recommendation = shapeRecommendation(parseModelJson(result.text), result.text);
  return { recommendation, usage: result.usage || {}, model: result.model };
}

export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10) || nowIso().slice(0, 10);
}
