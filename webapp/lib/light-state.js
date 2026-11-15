// Reading and checking the light numbers. Kept free of React so it is easy to test.
// The old page used `value || 12`, which turned a real 0 (the dark Colonization
// stage) into 12 hours on screen while the chamber stayed dark.

/** The value as a number, or the fallback only when the chamber has not reported it yet. */
function numberOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/** Light settings from the entity map. Zero stays zero. `get` takes ids like 'white_led_intensity'. */
function lightFromEntities(get, whiteDefault = 20) {
  const sunrise = numberOr(get('lights__sunrise_hour'), 8)
  const duration = numberOr(get('lights__duration__hours_'), 12)
  const white = numberOr(get('white_led_intensity'), whiteDefault)
  const red = numberOr(get('red_led_intensity'), 0)
  const green = numberOr(get('green_led_intensity'), 0)
  const blue = numberOr(get('blue_led_intensity'), 0)
  return { sunrise, duration, white, red, green, blue, colorOn: red > 0 || green > 0 || blue > 0 }
}

/** True when white or color is set but the duration is 0, so the ring stays dark. */
function ringDarkBecauseOfDuration(light) {
  return (light.white > 0 || light.colorOn) && !(light.duration > 0)
}

/** Did the chamber keep the number we sent? Out of range writes come back 200 but change nothing. */
function writeTaken(sent, actual, tolerance = 0.01) {
  const a = numberOr(actual, NaN)
  if (!Number.isFinite(a)) return true // could not read it back, so do not guess
  return Math.abs(a - sent) <= tolerance
}

/** The message for a write the chamber refused. A 403 means it rejected the page's origin. */
function writeFailedText(status) {
  if (status === 403) return 'The chamber refused that change (HTTP 403). Open this page at the chamber address itself, not through another address or proxy.'
  if (status === 401) return 'The chamber wants a sign-in for that change (HTTP 401). Reload the page and sign in again.'
  if (status > 0) return `The chamber did not accept that change (HTTP ${status}). Try again.`
  return 'Could not reach the chamber to make that change. Check your connection and try again.'
}

module.exports = { writeFailedText, numberOr, lightFromEntities, ringDarkBecauseOfDuration, writeTaken }
