/** Hub chamber state to Matter attribute values. */

export const NEEDS_WATER_THRESHOLD_PCT = 15;

export const VENDOR_ID = 0xfff1;
export const PRODUCT_ID = 0x8000;

/**
 * Matter Temperature Measurement measuredValue: hundredths of a degree C.
 * 22.5 C becomes 2250. Null stays null (unknown).
 */
export function temperatureMeasuredValue(temperatureC) {
  if (temperatureC == null || Number.isNaN(Number(temperatureC))) {
    return null;
  }
  return Math.round(Number(temperatureC) * 100);
}

/**
 * Matter Relative Humidity Measurement measuredValue: hundredths of a percent.
 * 90% becomes 9000. Clamped to 0..10000.
 */
export function humidityMeasuredValue(humidityPct) {
  if (humidityPct == null || Number.isNaN(Number(humidityPct))) {
    return null;
  }
  const hundredths = Math.round(Number(humidityPct) * 100);
  return Math.min(10000, Math.max(0, hundredths));
}

/**
 * Contact Sensor Boolean State: true is closed (water is ok), false is open (needs water).
 */
export function waterContactClosed(needsWater) {
  if (needsWater == null) {
    return null;
  }
  return !needsWater;
}

export function chamberEndpoints(chamber) {
  const id = String(chamber.id);
  const name = chamber.name || `Chamber ${id}`;
  return {
    id,
    name,
    reachable: Boolean(chamber.online),
    temperature: temperatureMeasuredValue(chamber.temperature_c),
    humidity: humidityMeasuredValue(chamber.humidity_pct),
    waterClosed: waterContactClosed(chamber.needs_water),
    lightOn: chamber.light_on == null ? null : Boolean(chamber.light_on),
  };
}

export function endpointIds(chamberId) {
  const id = String(chamberId);
  return {
    node: `chamber-${id}`,
    temperature: `chamber-${id}-temperature`,
    humidity: `chamber-${id}-humidity`,
    water: `chamber-${id}-water`,
  };
}
