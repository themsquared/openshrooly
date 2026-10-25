/** Deterministic per-device learning. No model call, so it is cheap and testable. */

export const COACH_ITEM = "grow-coach";
export const COACH_PRICE_CENTS = 399;
export const COACH_PERIOD_DAYS = 30;

/** Global envelope. Per-stage warning bands tighten this when present. */
export const TEMPERATURE_CLAMP = [10, 32];

export const SAFE_BOUNDS = {
  humidity_percent: [70, 96],
  temperature_c: [...TEMPERATURE_CLAMP],
  humidity_delta: 6,
  temperature_delta: 2,
  fan_speed_percent: [10, 80],
};

/** User-facing temperature: one decimal, e.g. 22.75559 → "22.8". */
export function formatTempC(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** User-facing humidity: whole percent when exact, otherwise one decimal. */
export function formatHumidity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatReading(value, unit) {
  return String(unit).includes("%") ? formatHumidity(value) : formatTempC(value);
}

/** Clip the global envelope to a stage's warning band when the profile has one. */
export function safeBoundsForStage(stage = {}) {
  const floor = TEMPERATURE_CLAMP[0];
  const ceil = TEMPERATURE_CLAMP[1];
  const warnMin = num(stage.temperature_warning_min_c);
  const warnMax = num(stage.temperature_warning_max_c);
  const lo = warnMin != null ? Math.max(floor, warnMin) : floor;
  const hi = warnMax != null ? Math.min(ceil, warnMax) : ceil;
  return {
    ...SAFE_BOUNDS,
    temperature_c: lo <= hi ? [lo, hi] : [floor, ceil],
  };
}

/** Coach / Autopilot only need a recent window, not the full telemetry table. */
export const TELEMETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TELEMETRY_WINDOW_LIMIT = 2000;
export const TELEMETRY_HISTORY_LIMIT = 20000;
export const HISTORY_MAX_POINTS = 672;
export const TELEMETRY_WINDOW_SQL =
  "SELECT * FROM device_telemetry WHERE device_id=? AND created_at>=? ORDER BY created_at DESC LIMIT ?";

export function telemetryWindowSince(now = Date.now(), windowMs = TELEMETRY_WINDOW_MS) {
  return new Date(now - windowMs).toISOString().replace(/\.\d+Z$/, "Z");
}

export async function loadRecentTelemetry(
  db,
  deviceId,
  { now = Date.now(), windowMs = TELEMETRY_WINDOW_MS, limit = TELEMETRY_WINDOW_LIMIT } = {}
) {
  const rows =
    (await db.all(TELEMETRY_WINDOW_SQL, [deviceId, telemetryWindowSince(now, windowMs), limit])) || [];
  return rows.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/** Bucket long telemetry ranges so a 168h view still covers the full week. */
export function downsampleHistory(samples = [], { hours = 24, maxPoints = HISTORY_MAX_POINTS } = {}) {
  const rows = parseTelemetry(samples)
    .filter((s) => s.created_at)
    .map((s) => ({
      at: s.created_at,
      temperature: s.temperature,
      humidity: s.humidity,
      temperature_setpoint: s.temperature_setpoint,
      humidity_setpoint: s.humidity_setpoint,
    }));
  if (rows.length <= maxPoints) return rows;
  const spanMs = Math.max(60_000, Number(hours) * 3600 * 1000);
  const bucketMs = Math.max(60_000, Math.ceil(spanMs / maxPoints));
  const buckets = new Map();
  for (const row of rows) {
    const t = Date.parse(row.at);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / bucketMs) * bucketMs;
    const acc = buckets.get(key) || { rows: [] };
    acc.rows.push(row);
    buckets.set(key, acc);
  }
  function avg(values) {
    const list = values.filter((v) => v != null && Number.isFinite(Number(v)));
    if (!list.length) return null;
    return list.reduce((a, b) => a + Number(b), 0) / list.length;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, acc]) => ({
      at: new Date(t).toISOString().replace(/\.\d+Z$/, "Z"),
      temperature: avg(acc.rows.map((r) => r.temperature)),
      humidity: avg(acc.rows.map((r) => r.humidity)),
      temperature_setpoint: avg(acc.rows.map((r) => r.temperature_setpoint)),
      humidity_setpoint: avg(acc.rows.map((r) => r.humidity_setpoint)),
      bucket_n: acc.rows.length,
    }));
}

export function latestReading(samples = [], now = Date.now()) {
  const parsed = parseTelemetry(samples);
  if (!parsed.length) return null;
  const latest = parsed.reduce((best, row) => {
    const t = Date.parse(row.created_at);
    const bt = Date.parse(best.created_at);
    if (Number.isFinite(t) && (!Number.isFinite(bt) || t >= bt)) return row;
    return best;
  }, parsed[parsed.length - 1]);
  const at = latest.created_at ? Date.parse(latest.created_at) : NaN;
  return {
    humidity: latest.humidity,
    temperature: latest.temperature,
    humidity_setpoint: latest.humidity_setpoint,
    temperature_setpoint: latest.temperature_setpoint,
    reading_at: latest.created_at || null,
    age_seconds: Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : null,
  };
}

export function compareReadingToStage(reading, stage = {}) {
  const flags = [];
  if (!reading) return flags;
  const warnMin = num(stage.temperature_warning_min_c);
  const warnMax = num(stage.temperature_warning_max_c);
  const targetMax = num(stage.temperature_target_max);
  const rhMin = num(stage.humidity_target_min);
  const rhMax = num(stage.humidity_target_max);

  function flagRange(value, { lo, hi, kind, label, unit, band }) {
    if (value == null) return;
    if (hi != null && value > hi) {
      flags.push({
        kind: `${kind}_above_${band}`,
        field: kind,
        value,
        limit: hi,
        message: `${label} ${formatReading(value, unit)} ${unit} is above the ${formatReading(hi, unit)} ${unit} ${band}.`,
      });
    } else if (lo != null && value < lo) {
      flags.push({
        kind: `${kind}_below_${band}`,
        field: kind,
        value,
        limit: lo,
        message: `${label} ${formatReading(value, unit)} ${unit} is below the ${formatReading(lo, unit)} ${unit} ${band}.`,
      });
    }
  }

  flagRange(reading.temperature, {
    lo: warnMin,
    hi: warnMax,
    kind: "temperature",
    label: "Temperature",
    unit: "°C",
    band: "warning",
  });
  flagRange(reading.temperature_setpoint, {
    lo: warnMin,
    hi: warnMax,
    kind: "temperature_setpoint",
    label: "Temperature setpoint",
    unit: "°C",
    band: "warning",
  });
  flagRange(reading.humidity, {
    lo: rhMin,
    hi: rhMax,
    kind: "humidity",
    label: "Humidity",
    unit: "%",
    band: "target",
  });
  flagRange(reading.humidity_setpoint, {
    lo: rhMin,
    hi: rhMax,
    kind: "humidity_setpoint",
    label: "Humidity setpoint",
    unit: "%",
    band: "target",
  });

  if (
    reading.temperature != null &&
    warnMax == null &&
    targetMax != null &&
    reading.temperature > targetMax
  ) {
    flags.push({
      kind: "temperature_above_target",
      field: "temperature",
      value: reading.temperature,
      limit: targetMax,
      message: `Temperature ${formatTempC(reading.temperature)} °C is above the ${formatTempC(targetMax)} °C target.`,
    });
  }
  return flags;
}

export function parseTelemetry(rows = []) {
  return rows
    .map((row) => {
      const doc = typeof row.document === "string" ? JSON.parse(row.document) : row.document || row;
      return {
        humidity: num(doc.humidity ?? doc.humidity_percent),
        temperature: num(doc.temperature ?? doc.temperature_c),
        humidity_setpoint: num(doc.humidity_setpoint ?? doc.target_humidity),
        temperature_setpoint: num(doc.temperature_setpoint ?? doc.target_temperature ?? doc.temperature_target),
        fan_speed: num(doc.fan_speed ?? doc.fan_speed_percent),
        water_level: num(doc.water_level ?? doc.water),
        temperature_calibration: num(
          doc.temperature_calibration ?? doc.temp_calibration_c ?? doc.calibration_c
        ),
        stage: doc.stage || doc.stage_id || "",
        created_at: row.created_at || doc.created_at || "",
      };
    })
    .filter((s) => s.humidity != null || s.temperature != null);
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  const list = values.filter((v) => v != null);
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function clip(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value));
}

export function buildDeviceModel(samples, reports = []) {
  const parsed = parseTelemetry(samples);
  const humidErr = parsed
    .filter((s) => s.humidity != null && s.humidity_setpoint != null)
    .map((s) => s.humidity - s.humidity_setpoint);
  const tempErr = parsed
    .filter((s) => s.temperature != null && s.temperature_setpoint != null)
    .map((s) => s.temperature - s.temperature_setpoint);

  let riseRate = null;
  const withRh = parsed.filter((s) => s.humidity != null && s.humidity_setpoint != null);
  if (withRh.length >= 2) {
    const first = withRh[0];
    const last = withRh[withRh.length - 1];
    const minutes = Math.max(1, (Date.parse(last.created_at) - Date.parse(first.created_at)) / 60000 || withRh.length);
    riseRate = (last.humidity - first.humidity) / minutes;
  }

  const water = parsed.map((s) => s.water_level).filter((v) => v != null);
  let waterUse = null;
  if (water.length >= 2) waterUse = (water[0] - water[water.length - 1]) / Math.max(1, water.length - 1);

  const culinaryReports = reports.filter((r) => r.pack !== "psilocybin" && !r.restricted);
  const successes = culinaryReports.filter((r) => r.outcome === "success").length;
  const outcomeRate = culinaryReports.length ? successes / culinaryReports.length : null;

  const humidityDroop = humidErr.length ? -Math.min(0, mean(humidErr)) : 0;
  const tempOffset = mean(tempErr) || 0;
  const calibrations = parsed.map((s) => s.temperature_calibration).filter((v) => v != null);

  return {
    sample_count: parsed.length,
    humidity_error: mean(humidErr),
    humidity_droop: humidityDroop,
    temperature_offset: tempOffset,
    temperature_calibration: calibrations.length ? mean(calibrations) : null,
    humidity_rise_per_min: riseRate,
    water_use_per_sample: waterUse,
    fan_average: mean(parsed.map((s) => s.fan_speed)),
    outcome_success_rate: outcomeRate,
    report_count: culinaryReports.length,
  };
}

/** Profile stage target band. Center ± hysteresis when min/max are present. */
export function stageTemperatureTargetRange(stage = {}) {
  const center = num(stage.temperature_c);
  const lo = num(stage.temperature_target_min);
  const hi = num(stage.temperature_target_max);
  if (lo != null && hi != null && lo <= hi) return [lo, hi];
  if (center != null) return [center, center];
  return null;
}

export function stageHumidityTargetRange(stage = {}) {
  const center = num(stage.humidity_percent);
  const lo = num(stage.humidity_target_min);
  const hi = num(stage.humidity_target_max);
  if (lo != null && hi != null && lo <= hi) return [lo, hi];
  if (center != null) return [center, center];
  return null;
}

export function suggestSetpoints(model, stage = {}, { auto = false, reading = null } = {}) {
  const bounds = safeBoundsForStage(stage);
  const targetRange = stageTemperatureTargetRange(stage);
  const baseRh = num(stage.humidity_percent) ?? 90;
  const baseTemp = num(stage.temperature_c) ?? 20;
  const baseFan = num(stage.fan?.speed_percent ?? stage.fan_speed_percent) ?? 30;

  let humidity = baseRh;
  let temperature = baseTemp;
  const reasons = [];

  if ((model.humidity_droop || 0) >= 2) {
    const bump = Math.min(bounds.humidity_delta, Math.round(model.humidity_droop));
    humidity += bump;
    reasons.push(`Chamber lags humidity setpoint by ~${formatHumidity(model.humidity_droop)}%.`);
  }
  if ((model.humidity_error || 0) >= 3) {
    humidity -= Math.min(bounds.humidity_delta, Math.round(model.humidity_error));
    reasons.push("Humidity runs high versus the target.");
  }

  // Reading-vs-setpoint is tracking error, not a sensor calibration. Only a real
  // calibration value may shift the suggested setpoint, and never outside the
  // profile target band.
  const calibration = num(model.temperature_calibration);
  if (calibration != null && Math.abs(calibration) >= 0.1) {
    temperature -= calibration;
    reasons.push(`Applying a ${formatTempC(calibration)}°C sensor calibration.`);
  }

  const currentTemp = num(reading?.temperature);
  const targetLo = targetRange ? targetRange[0] : baseTemp;
  const targetHi = targetRange ? targetRange[1] : baseTemp;
  if (currentTemp != null && targetHi != null && currentTemp > targetHi) {
    reasons.push(
      `The chamber is running warm at ${formatTempC(currentTemp)} °C (above the ${formatTempC(targetHi)} °C target). Lower the setpoint toward ${formatTempC(baseTemp)} °C.`
    );
  } else if (currentTemp != null && targetLo != null && currentTemp < targetLo) {
    reasons.push(
      `The chamber is running cool at ${formatTempC(currentTemp)} °C (below the ${formatTempC(targetLo)} °C target). Raise the setpoint toward ${formatTempC(baseTemp)} °C.`
    );
  }

  humidity = Math.round(clip(humidity, bounds.humidity_percent) * 10) / 10;
  let tempLo = bounds.temperature_c[0];
  let tempHi = bounds.temperature_c[1];
  if (targetRange) {
    tempLo = Math.max(tempLo, targetRange[0]);
    tempHi = Math.min(tempHi, targetRange[1]);
    if (tempLo > tempHi) {
      tempLo = targetRange[0];
      tempHi = targetRange[1];
    }
  }
  temperature = Math.round(clip(temperature, [tempLo, tempHi]) * 10) / 10;
  const fan = clip(baseFan, bounds.fan_speed_percent);

  const within =
    humidity >= bounds.humidity_percent[0] &&
    humidity <= bounds.humidity_percent[1] &&
    temperature >= bounds.temperature_c[0] &&
    temperature <= bounds.temperature_c[1] &&
    Math.abs(humidity - baseRh) <= bounds.humidity_delta &&
    Math.abs(temperature - baseTemp) <= bounds.temperature_delta;

  return {
    humidity_percent: humidity,
    temperature_c: temperature,
    fan_speed_percent: fan,
    reasons,
    auto_eligible: Boolean(auto) && within && reasons.length > 0,
    within_bounds: within,
    baseline: { humidity_percent: baseRh, temperature_c: baseTemp, fan_speed_percent: baseFan },
  };
}

export function detectAlerts(model, samples, stage = {}, now = Date.now()) {
  const alerts = [];
  const parsed = parseTelemetry(samples);
  const latest = parsed[parsed.length - 1];
  if (!latest) return alerts;

  if (Math.abs(model.humidity_error || 0) >= 8 || (model.humidity_droop || 0) >= 8) {
    alerts.push({
      kind: "humidity_trouble",
      severity: "warn",
      message: "Humidity is missing the setpoint by a wide margin. Check the reservoir and door seal.",
    });
  }

  const days = Number(stage.duration_days || 0);
  const started = parsed[0]?.created_at ? Date.parse(parsed[0].created_at) : NaN;
  const elapsedDays = Number.isFinite(started) ? (now - started) / 86400000 : 0;
  const behindHumidity =
    latest.humidity != null &&
    latest.humidity_setpoint != null &&
    latest.humidity < latest.humidity_setpoint - 5;
  if (
    stage.id === "colonization" &&
    days > 0 &&
    elapsedDays > days * 0.7 &&
    behindHumidity &&
    (model.humidity_rise_per_min == null || model.humidity_rise_per_min < 0.01)
  ) {
    alerts.push({
      kind: "stalled_colonization",
      severity: "warn",
      message: "Colonization looks stalled: humidity is not climbing toward the target.",
    });
  }
  if ((stage.id === "fruiting" || /fruit/i.test(stage.name || "")) && days && elapsedDays >= days * 0.9) {
    alerts.push({
      kind: "time_to_harvest",
      severity: "info",
      message: "Fruiting window is nearly up. Check cap size and harvest if veils are thinning.",
    });
  }
  return alerts;
}

export function refuseRestrictedPack(profile) {
  if (!profile) return false;
  return profile.pack === "psilocybin" || profile.restricted || (profile.tags || []).includes("psilocybin");
}

/** Workers AI neuron rates for @cf/qwen/qwen3-30b-a3b-fp8 (text) and the vision model. */
export const TEXT_NEURONS_PER_M_INPUT = 4625;
export const TEXT_NEURONS_PER_M_OUTPUT = 30475;
export const VISION_NEURONS_PER_M_INPUT = 4410;
export const VISION_NEURONS_PER_M_OUTPUT = 61493;

export function estimateNeurons({ inputTokens = 0, outputTokens = 0, vision = false }) {
  const inPerM = vision ? VISION_NEURONS_PER_M_INPUT : TEXT_NEURONS_PER_M_INPUT;
  const outPerM = vision ? VISION_NEURONS_PER_M_OUTPUT : TEXT_NEURONS_PER_M_OUTPUT;
  return Math.ceil((inputTokens / 1e6) * inPerM + (outputTokens / 1e6) * outPerM);
}

export function estimateUsd(neurons) {
  return (neurons / 1000) * 0.011;
}
