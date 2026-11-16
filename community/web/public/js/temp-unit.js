/**
 * Display-only temperature unit. Storage, Coach, profiles, firmware and the API stay in Celsius.
 * One preference, shared by the device page, the graph, profiles and the account page.
 */
export const UNIT_KEY = "sl-temp-unit";
export const UNIT_CHANGE = "sl-temp-unit";

function localeOf(locale) {
  if (arguments.length) return String(locale || "");
  try {
    // Node also has navigator.language (en-US here). Only the real page should
    // default from the browser locale, so tests without a window stay in C.
    if (typeof window === "undefined") return "";
    return window.navigator?.language || "";
  } catch {
    return "";
  }
}

/** F for a US locale in the browser, C otherwise. Used only when the person has not picked a unit yet. */
export function defaultTempUnit(locale) {
  const loc = arguments.length ? localeOf(locale) : localeOf();
  return /[-_]US\b/i.test(loc) ? "F" : "C";
}

export function tempUnit() {
  try {
    const saved = globalThis.localStorage?.getItem(UNIT_KEY);
    if (saved === "F" || saved === "C") return saved;
  } catch {
    // private mode, or tests with no storage
  }
  return defaultTempUnit();
}

export function setTempUnit(unit) {
  const next = unit === "F" ? "F" : "C";
  try {
    globalThis.localStorage?.setItem(UNIT_KEY, next);
  } catch {
    // ignore
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(UNIT_CHANGE, { detail: next }));
  } catch {
    // ignore
  }
  return next;
}

export function cToF(c) {
  return (Number(c) * 9) / 5 + 32;
}

export function fToC(f) {
  return ((Number(f) - 32) * 5) / 9;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toDisplayTemp(c, unit = tempUnit()) {
  const n = num(c);
  if (n == null) return null;
  return unit === "F" ? cToF(n) : n;
}

/** Same as toDisplayTemp. Kept so the graph can import the name it already uses. */
export const toUnit = toDisplayTemp;

/** Convert a slider or form value in the display unit back to Celsius. */
export function fromDisplayTemp(value, unit = tempUnit()) {
  const n = num(value);
  if (n == null) return null;
  const c = unit === "F" ? fToC(n) : n;
  return Math.round(c * 10) / 10;
}

/**
 * The temperature slider and number box in the current display unit.
 * Celsius keeps the shared 0-40, 0.1 step. Fahrenheit is 32-104 in whole degrees.
 */
export function tempDisplayField(unit = tempUnit()) {
  if (unit === "F") return { min: 32, max: 104, step: 1, unit: "°F" };
  return { min: 0, max: 40, step: 0.1, unit: "°C" };
}

function formatNumber(n, digits) {
  if (digits <= 0) return String(Math.round(n));
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits);
}

/**
 * "21.2 °C" or "70 °F". Readings keep one decimal. Slider targets in F are whole degrees.
 * Pass a Celsius value.
 */
export function formatTemp(c, unit = tempUnit(), { style = "reading" } = {}) {
  const v = toDisplayTemp(c, unit);
  if (v == null) return "";
  const digits = unit === "F" && style === "target" ? 0 : 1;
  return `${formatNumber(v, digits)} °${unit}`;
}

export function formatTempValue(c, unit = tempUnit(), { style = "target" } = {}) {
  const v = toDisplayTemp(c, unit);
  if (v == null) return "";
  const digits = unit === "F" && style === "target" ? 0 : 1;
  return formatNumber(v, digits);
}
