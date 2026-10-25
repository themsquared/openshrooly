// Plain words for the dashboard cards: hours like "8 AM", today's range, and
// whether a reading is rising or falling. Kept free of React so it is easy to test.

/** 8 -> "8 AM", 20 -> "8 PM", 0 -> "12 AM", 6.5 -> "6:30 AM". */
function hourText(hour) {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60)
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const suffix = h24 < 12 ? 'AM' : 'PM'
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${m.toString().padStart(2, '0')} ${suffix}`
}

/** "8 AM to 8 PM" */
function scheduleText(start, end) {
  return `${hourText(start)} to ${hourText(end)}`
}

/** "07:00" */
function hour24(hour) {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "Light on 07:00 to 19:00" or "Light off (dark)" */
function lightOnSummary(sunrise, duration) {
  const hours = Number(duration)
  if (!(hours > 0)) return 'Light off (dark)'
  const start = Number(sunrise) || 0
  return `Light on ${hour24(start)} to ${hour24(start + hours)}`
}

/** "Today 21.3° to 23.1°", or null when there is nothing yet. */
function rangeText(lo, hi, unit) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return `Today ${lo.toFixed(1)}${unit} to ${hi.toFixed(1)}${unit}`
}

const TREND_WINDOW_MS = 10 * 60 * 1000
const TREND_MIN_SPAN_MS = 3 * 60 * 1000

/** Add a reading and drop ones older than the trend window. Returns a new array. */
function addSample(samples, t, value) {
  if (!Number.isFinite(value)) return samples
  const kept = samples.filter((s) => t - s.t <= TREND_WINDOW_MS)
  const last = kept[kept.length - 1]
  if (last && t - last.t < 15000) return kept // one reading per 15 seconds is plenty
  return [...kept, { t, v: value }]
}

/** "Rising", "Falling", "Steady", or "Watching for a trend" until there are 3 minutes of readings. */
function trendText(samples, step) {
  if (samples.length < 2) return 'Watching for a trend'
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (last.t - first.t < TREND_MIN_SPAN_MS) return 'Watching for a trend'
  const change = last.v - first.v
  if (change >= step) return 'Rising'
  if (change <= -step) return 'Falling'
  return 'Steady'
}

module.exports = { hourText, scheduleText, hour24, lightOnSummary, rangeText, addSample, trendText }
