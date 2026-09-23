const assert = require('assert')
const { groupFreeSlotsCore } = require('../cloudfunctions/friend/groupAvailability')

const participants = [
  { id: 'U1', name: 'Alpha'.repeat(30), avatar: 'A'.repeat(40) },
  { id: 'U2', name: 'Bravo'.repeat(30), avatar: 'B'.repeat(40) },
  { id: 'U3', name: 'Charlie'.repeat(30), avatar: 'C'.repeat(40) }
]

// 模拟“导入课表”后包含大量且字段很长的日程。计算必须完整使用这些日程，
// 但云函数返回给小程序的预览不能超过 CloudBase 1 MB 上限。
const makeSchedules = (prefix) => Array.from({ length: 500 }, (_, index) => ({
  id: `${prefix}-${index}-${'x'.repeat(200)}`,
  weekday: (index % 7) + 1,
  termStartDate: '2026-07-01',
  termEndDate: '2026-07-31',
  start: '08:00',
  end: '09:00',
  title: `课程-${index}-${'课'.repeat(4000)}`,
  place: `教室-${index}-${'地'.repeat(4000)}`
}))

const result = groupFreeSlotsCore(participants, {
  U1: makeSchedules('u1'),
  U2: makeSchedules('u2'),
  U3: makeSchedules('u3')
}, '2026-07-01', '2026-07-31', { start: '08:00', end: '22:00' })

const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
assert(result.days.every((day) => !Object.prototype.hasOwnProperty.call(day, 'conflicts')), 'day-level conflicts must not duplicate hourly conflict data')
assert(result.days.some((day) => day.hours.some((hour) => hour.conflictsTruncated)), 'large conflict sets should be explicitly marked as truncated')
assert(result.days.every((day) => day.hours.every((hour) => hour.conflicts.length <= 3)), 'each hour must return a bounded conflict preview')
assert(bytes < 900 * 1024, `response must remain safely below the 1 MB cloud-function limit; got ${bytes} bytes`)

console.log(`group-availability-response-size.test.js: passed (${bytes} bytes)`)
