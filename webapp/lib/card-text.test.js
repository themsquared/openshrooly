const test = require('node:test')
const assert = require('node:assert/strict')
const { hourText, scheduleText, hour24, lightOnSummary, rangeText, addSample, trendText } = require('./card-text.js')

test('hours read like a clock', () => {
  assert.equal(hourText(8), '8 AM')
  assert.equal(hourText(20), '8 PM')
  assert.equal(hourText(0), '12 AM')
  assert.equal(hourText(12), '12 PM')
  assert.equal(hourText(6.5), '6:30 AM')
  assert.equal(hourText(26), '2 AM')
  assert.equal(scheduleText(8, 20), '8 AM to 8 PM')
  assert.equal(hour24(7), '07:00')
  assert.equal(hour24(19.5), '19:30')
  assert.equal(lightOnSummary(7, 12), 'Light on 07:00 to 19:00')
  assert.equal(lightOnSummary(8, 0), 'Light off (dark)')
})

test('range needs both ends', () => {
  assert.equal(rangeText(21.26, 23.1, '°'), 'Today 21.3° to 23.1°')
  assert.equal(rangeText(NaN, 23, '°'), null)
})

test('trend waits for three minutes, then reads the change', () => {
  let s = []
  s = addSample(s, 0, 20)
  s = addSample(s, 5000, 25) // too soon, ignored
  assert.equal(s.length, 1)
  s = addSample(s, 60000, 20.1)
  assert.equal(trendText(s, 0.3), 'Watching for a trend')
  s = addSample(s, 200000, 20.5)
  assert.equal(trendText(s, 0.3), 'Rising')
  s = addSample(s, 400000, 19.9)
  assert.equal(trendText(s, 0.3), 'Steady')
  s = addSample(s, 700000, 19.0) // readings older than 10 minutes drop off
  assert.equal(s[0].t, 200000)
  assert.equal(trendText(s, 0.3), 'Falling')
})
