/** Parse ESPHome / hub sensor payloads into Coach telemetry JSON. */

export const CHAMBER_SENSORS = {
  temperature: ["sensor", "current_temperature", "temperature"],
  humidity: ["sensor", "current_humidity", "humidity"],
  water_level: ["sensor", "water_level", "water_level_percent"],
  fan_speed: ["sensor", "current_air_exchange_fan_speed", "air_exchange_fan_speed"],
  humidity_setpoint: ["number", "target_humidity"],
  temperature_setpoint: ["number", "temperature_target", "temperature__target"],
};

export function sensorValue(payload) {
  if (payload == null) return null;
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (typeof payload === "string") {
    const n = Number.parseFloat(payload);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof payload === "object") {
    if (payload.value != null) return sensorValue(payload.value);
    if (payload.state != null) return sensorValue(payload.state);
  }
  return null;
}

export function readingsFromEntities(entities = {}) {
  return {
    temperature: sensorValue(entities.temperature),
    humidity: sensorValue(entities.humidity),
    water_level: sensorValue(entities.water_level),
    fan_speed: sensorValue(entities.fan_speed ?? entities.fan_rpm),
    humidity_setpoint: sensorValue(entities.humidity_setpoint ?? entities.target_humidity),
    temperature_setpoint: sensorValue(entities.temperature_setpoint ?? entities.temperature_target),
  };
}

export function telemetryDocument(readings, extra = {}) {
  return {
    humidity: readings.humidity,
    humidity_percent: readings.humidity,
    temperature: readings.temperature,
    temperature_c: readings.temperature,
    humidity_setpoint: readings.humidity_setpoint,
    target_humidity: readings.humidity_setpoint,
    temperature_setpoint: readings.temperature_setpoint,
    target_temperature: readings.temperature_setpoint,
    fan_speed: readings.fan_speed,
    water_level: readings.water_level,
    ...extra,
  };
}

export function normalizeChamberUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");
  return `http://${value.replace(/\/$/, "")}`;
}
