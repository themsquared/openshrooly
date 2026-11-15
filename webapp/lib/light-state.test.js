const test = require('node:test')
const assert = require('node:assert/strict')
const { writeFailedText, numberOr, lightFromEntities, ringDarkBecauseOfDuration, writeTaken } = require('./light-state.js')

const from = (map) => lightFromEntities((id) => map[id])

test('a real zero stays zero', () => {
  assert.equal(numberOr(0, 12), 0)
  assert.equal(numberOr('0', 12), 0)
  assert.equal(numberOr(undefined, 12), 12)
  assert.equal(numberOr('x', 12), 12)
})

test('dark Colonization stage reads as dark, not as 12 hours and 20 percent white', () => {
  const l = from({ lights__sunrise_hour: 8, lights__duration__hours_: 0, white_led_intensity: 0, blue_led_intensity: 0, red_led_intensity: 0, green_led_intensity: 0 })
  assert.equal(l.duration, 0)
  assert.equal(l.white, 0)
  assert.equal(l.colorOn, false)
  assert.equal(ringDarkBecauseOfDuration(l), false)
})

test('sunrise at midnight is kept', () => {
  assert.equal(from({ lights__sunrise_hour: 0 }).sunrise, 0)
})

test('before the chamber reports, the page shows the stock defaults', () => {
  const l = from({})
  assert.deepEqual([l.sunrise, l.duration, l.white], [8, 12, 20])
})

test('white or color with 0 hours is flagged as a dark ring', () => {
  assert.equal(ringDarkBecauseOfDuration(from({ lights__duration__hours_: 0, white_led_intensity: 30 })), true)
  assert.equal(ringDarkBecauseOfDuration(from({ lights__duration__hours_: 0, white_led_intensity: 0, blue_led_intensity: 80 })), true)
  assert.equal(ringDarkBecauseOfDuration(from({ lights__duration__hours_: 12, white_led_intensity: 30 })), false)
})

test('a write is taken when the chamber reads back the same number', () => {
  assert.equal(writeTaken(50, 50), true)
  assert.equal(writeTaken(50, '50'), true)
  assert.equal(writeTaken(50, 20), false)
  assert.equal(writeTaken(50, undefined), true)
})

test('refusals say what happened', () => {
  assert.match(writeFailedText(403), /HTTP 403/)
  assert.match(writeFailedText(401), /sign-in/)
  assert.match(writeFailedText(500), /HTTP 500/)
  assert.match(writeFailedText(0), /Could not reach/)
})

test('white default is the callers, so a Shrooly can keep lux', () => {
  assert.equal(lightFromEntities(() => undefined, 150).white, 150)
  assert.equal(lightFromEntities((id) => (id === 'white_led_intensity' ? 0 : undefined), 150).white, 0)
})
