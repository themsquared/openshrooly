/** Deterministic per-device learning. No model call, so it is cheap and testable. */

export const COACH_ITEM = "grow-coach";
export const COACH_PRICE_CENTS = 399;
export const COACH_PERIOD_DAYS = 30;

export const SAFE_BOUNDS = {
  humidity_percent: [70, 96],
  temperature_c: [16, 28],
  humidity_delta: 6,
  temperature_delta: 2,
  fan_speed_percent: [10, 80],
};

export function parseTelemetry(rows = []) {
  return rows
    .map((row) => {
      const doc = typeof row.document === "string" ? JSON.parse(row.document) : row.document || row;
      return {
        humidity: num(doc.humidity ?? doc.humidity_percent),
        temperature: num(doc.temperature ?? doc.temperature_c),
        humidity_setpoint: num(doc.humidity_setpoint ?? doc.target_humidity),
        temperature_setpoint: num(doc.temperature_setpoint ?? doc.target_temperature),
        fan_speed: num(doc.fan_speed ?? doc.fan_speed_percent),
        water_level: num(doc.water_level ?? doc.water),
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

  return {
    sample_count: parsed.length,
    humidity_error: mean(humidErr),
    humidity_droop: humidityDroop,
    temperature_offset: tempOffset,
    humidity_rise_per_min: riseRate,
    water_use_per_sample: waterUse,
    fan_average: mean(parsed.map((s) => s.fan_speed)),
    outcome_success_rate: outcomeRate,
    report_count: culinaryReports.length,
  };
}

export function suggestSetpoints(model, stage = {}, { auto = false } = {}) {
  const baseRh = num(stage.humidity_percent) ?? 90;
  const baseTemp = num(stage.temperature_c) ?? 20;
  const baseFan = num(stage.fan?.speed_percent ?? stage.fan_speed_percent) ?? 30;

  let humidity = baseRh;
  let temperature = baseTemp;
  const reasons = [];

  if ((model.humidity_droop || 0) >= 2) {
    const bump = Math.min(SAFE_BOUNDS.humidity_delta, Math.round(model.humidity_droop));
    humidity += bump;
    reasons.push(`Chamber lags humidity setpoint by ~${model.humidity_droop.toFixed(1)}%.`);
  }
  if ((model.humidity_error || 0) >= 3) {
    humidity -= Math.min(SAFE_BOUNDS.humidity_delta, Math.round(model.humidity_error));
    reasons.push("Humidity runs high versus the target.");
  }
  if (Math.abs(model.temperature_offset || 0) >= 0.6) {
    const delta = clip(-model.temperature_offset, [-SAFE_BOUNDS.temperature_delta, SAFE_BOUNDS.temperature_delta]);
    temperature += delta;
    reasons.push(`Temperature runs ${model.temperature_offset > 0 ? "warm" : "cool"} by ${Math.abs(model.temperature_offset).toFixed(1)}°C.`);
  }

  humidity = Math.round(clip(humidity, SAFE_BOUNDS.humidity_percent) * 10) / 10;
  temperature = Math.round(clip(temperature, SAFE_BOUNDS.temperature_c) * 10) / 10;
  const fan = clip(baseFan, SAFE_BOUNDS.fan_speed_percent);

  const within =
    humidity >= SAFE_BOUNDS.humidity_percent[0] &&
    humidity <= SAFE_BOUNDS.humidity_percent[1] &&
    temperature >= SAFE_BOUNDS.temperature_c[0] &&
    temperature <= SAFE_BOUNDS.temperature_c[1] &&
    Math.abs(humidity - baseRh) <= SAFE_BOUNDS.humidity_delta &&
    Math.abs(temperature - baseTemp) <= SAFE_BOUNDS.temperature_delta;

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
