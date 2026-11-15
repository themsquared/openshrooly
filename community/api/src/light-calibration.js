/**
 * What each chamber type puts out at 100 percent, so a profile's physical light target can be turned
 * into that chamber's percent. A copy of this file lives in community/web/public/js (a test keeps
 * them identical). Replace the numbers here when a measurement lands: nothing else holds them.
 *
 * Percent stays the language on the wire, in Coach and on the pages. Only the adapters read this.
 *
 * white_lux_at_100: lux of white at the substrate with the white channel at 100 percent.
 * blue_umol_at_100: photon flux of the blue channel at 100 percent, umol per m2 per second, or
 *   null when the chamber has no blue figure (a profile's blue target then falls back to its blue percent).
 * estimated: true until someone measures it.
 */

export const LIGHT_CALIBRATION = {
  shrooly_chamber: {
    // The white entity's cap is 4000 lux, which is 100 percent. The cap comes from the OpenShrooly lux
    // curve (Sekonic L-758DR at the cavity centre; 20 percent drive made 92 lux). The strip itself
    // reached 8317 lux at full drive, so 4000 is the firmware limit, not the hardware limit.
    white_lux_at_100: 4000,
    blue_umol_at_100: null,
    estimated: false,
    source: "OpenShrooly lux measurements and the firmware cap",
  },
  lykyn_chamber: {
    // Estimates, not measurements: 16 WS2812B pixels on the 30 x 30 cm floor, datasheet intensities,
    // 30 to 50 percent of the light reaching the substrate. The range is about 160 to 600 lux for
    // white and 1.6 to 5.3 umol/m2/s for blue; these are the middle.
    white_lux_at_100: 400,
    blue_umol_at_100: 3.5,
    estimated: true,
    source: "WS2812B datasheet estimate, not measured",
  },
};

const FALLBACK = LIGHT_CALIBRATION.shrooly_chamber;

export function calibrationFor(type) {
  return LIGHT_CALIBRATION[type] || FALLBACK;
}

function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/** Lux of white at a percent of this chamber's maximum. */
export function whitePercentToLuxFor(percent, cal) {
  const p = finite(percent);
  return p == null ? null : round3((Math.min(100, Math.max(0, p)) * cal.white_lux_at_100) / 100);
}

/** Percent of this chamber's maximum for a white lux target. Clamped at 100. */
export function whiteLuxToPercentFor(lux, cal) {
  const value = finite(lux);
  if (value == null || value <= 0) return value == null ? null : 0;
  return round3(Math.min(100, (value / cal.white_lux_at_100) * 100));
}

/** Percent of this chamber's blue maximum for a photon-flux target, or null when it has no blue figure. */
export function bluePercentForUmol(umol, cal) {
  const value = finite(umol);
  if (value == null || !(cal.blue_umol_at_100 > 0)) return null;
  if (value <= 0) return 0;
  return round3(Math.min(100, (value / cal.blue_umol_at_100) * 100));
}

function plain(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Where a stage's physical light target is more than this chamber can make.
 * Returns [{ channel, wanted, max, unit, estimated, note }], empty when nothing is capped.
 */
export function lightLimits(light, cal) {
  const out = [];
  if (!light || typeof light !== "object") return out;
  const lux = finite(light.white_led_lux);
  if (lux != null && lux > cal.white_lux_at_100 + 1e-9) {
    out.push(limit("white", lux, cal.white_lux_at_100, "lux", cal.estimated));
  }
  const umol = finite(light.blue_umol_m2s);
  if (umol != null && cal.blue_umol_at_100 > 0 && umol > cal.blue_umol_at_100 + 1e-9) {
    out.push(limit("blue", umol, cal.blue_umol_at_100, "umol/m2/s", cal.estimated));
  }
  return out;
}

function limit(channel, wanted, max, unit, estimated) {
  const what = channel === "white" ? "of white" : "of blue";
  const tops = estimated ? `about ${plain(max)} ${unit} (estimated)` : `${plain(max)} ${unit}`;
  return { channel, wanted, max, unit, estimated, note: `Wanted ${plain(wanted)} ${unit} ${what}, this chamber tops out at ${tops}.` };
}
