const assert = require('assert')
const {
  DISPLAY_RANGE,
  buildAvailabilityView,
  buildDayTimeline,
  buildMonthNarrative,
  sharedSlots,
  getAvailabilityLevel
} = require('../packages/schedule/common/decisionView')

const participants = [
  { id: 'A', name: 'Wilson', avatar: 'W' },
  { id: 'B', name: 'Bill', avatar: 'B' },
  { id: 'C', name: 'Hanxi', avatar: 'H' }
]

function day(date, free, slots = []) {
  return {
    date,
    free,
    freeMinutes: free.reduce((total, item) => total + item.duration, 0),
    slots
  }
}

function result(days) {
  return {
    participants,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    range: DISPLAY_RANGE,
    days
  }
}

// 15:00-20:00 必须是强高亮，不是人工补出的整块。
const longDay = day('2026-07-01', [{ start: '15:00', end: '20:00', duration: 300 }])
assert.strictEqual(getAvailabilityLevel(sharedSlots(longDay)), 'long')

// 13:00-15:00 与 17:00-20:00 中间有空档，展示层不得合并。
const splitDay = day('2026-07-02', [
  { start: '13:00', end: '15:00', duration: 120 },
  { start: '17:00', end: '20:00', duration: 180 }
])
const splitTimeline = buildDayTimeline(splitDay, participants)
assert.deepStrictEqual(splitTimeline.sharedFreeSlots.map((slot) => `${slot.start}-${slot.end}`), ['13:00-15:00', '17:00-20:00'])
assert.strictEqual(splitTimeline.longestText, '3小时')

// 10:00-11:00 仍可在详情查看，但月历不应被强高亮。
const shortDay = day('2026-07-03', [{ start: '10:00', end: '11:00', duration: 60 }])
assert.strictEqual(getAvailabilityLevel(sharedSlots(shortDay)), 'short')
assert.strictEqual(buildDayTimeline(shortDay, participants).sharedFreeSlots.length, 1)

// 09:00-20:00 是全天强高亮。
const fullDay = day('2026-07-04', [{ start: '09:00', end: '20:00', duration: 660 }])
assert.strictEqual(getAvailabilityLevel(sharedSlots(fullDay)), 'fullDay')

// 完全无共同时间时要有明确空状态。
const noTime = day('2026-07-05', [])
const view = buildAvailabilityView(result([longDay, splitDay, shortDay, fullDay, noTime]), '2026-07-01', '2026-07-05')
assert.strictEqual(view.timeline.sharedFreeSlots.length, 0)
assert.strictEqual(view.timeline.longestText, '')
assert.strictEqual(view.stats.participantCount, 3)
assert.strictEqual(view.calendarCells.find((cell) => cell.date === '2026-07-01').level, 'long')
assert.strictEqual(view.calendarCells.find((cell) => cell.date === '2026-07-04').level, 'fullDay')
const narrative = buildMonthNarrative(view.calendarCells)
assert.strictEqual(narrative.find((item) => item.key === 'fullDay').text, '7月4日')
assert.strictEqual(narrative.find((item) => item.key === 'long').text, '7月1日')
assert.strictEqual(narrative.find((item) => item.key === 'medium').text, '7月2日')

console.log('decision-view.test.js: all assertions passed')
