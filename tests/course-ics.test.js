const assert = require('assert')
const { generateCourseIcs } = require('../cloudfunctions/courseIcs/generateIcsLocal')

const baseCourse = {
  title: 'MTHO 课程',
  location: 'A101',
  termStart: '2026-09-07',
  weekStart: 1,
  weekEnd: 16,
  weekType: 'all',
  weekday: 1,
  startTime: '11:00',
  endTime: '12:30',
  teacher: 'Teacher',
  courseCode: 'MTHO'
}

function eventCount(ics) {
  return (ics.match(/BEGIN:VEVENT/g) || []).length
}

// ── 去重：OCR 按周展开的相同记录只保留一个循环事件 ──
const duplicated = Array.from({ length: 8 }, () => Object.assign({}, baseCourse))
const ics = generateCourseIcs(duplicated)
assert.strictEqual(eventCount(ics), 1, '完全相同的课程不得导出为多个日历事件')
assert.ok(ics.includes('RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=16'), '应保留按周循环规则')

// 同名但地点不同的课程不是重复记录，不能被错误合并。
const distinct = generateCourseIcs([baseCourse, Object.assign({}, baseCourse, { location: 'B202' })])
assert.strictEqual(eventCount(distinct), 2, '不同地点的课程应作为独立日历事件保留')

// ── 时区：北京时间 → UTC 绝对时间（Z 后缀），减 8 小时 ──
const tzIcs = generateCourseIcs([baseCourse])
assert.ok(tzIcs.includes('DTSTART:20260907T030000Z'), '11:00 北京时间应导出为 03:00Z')
assert.ok(tzIcs.includes('DTEND:20260907T043000Z'), '12:30 北京时间应导出为 04:30Z')
assert.ok(!tzIcs.includes('DTSTART:20260907T110000'), '不得再导出 floating 本地时间')

// 00:00–07:59 的课程应跨日回退到前一天
const early = generateCourseIcs([Object.assign({}, baseCourse, { startTime: '00:00', endTime: '01:00' })])
assert.ok(early.includes('DTSTART:20260906T160000Z'), '00:00 北京时间应回退为前一天 16:00Z')
assert.ok(early.includes('DTEND:20260906T170000Z'), '01:00 北京时间应回退为前一天 17:00Z')

// ── 同一天 3 门课：必须产出 3 个 VEVENT（不丢课） ──
const sameDay3 = [
  Object.assign({}, baseCourse, { title: 'C1', weekday: 3, startTime: '09:00', endTime: '10:00' }),
  Object.assign({}, baseCourse, { title: 'C2', weekday: 3, startTime: '10:00', endTime: '11:00' }),
  Object.assign({}, baseCourse, { title: 'C3', weekday: 3, startTime: '11:00', endTime: '12:00' })
]
assert.strictEqual(eventCount(generateCourseIcs(sameDay3)), 3, '同一天 3 门不同课程应导出 3 个 VEVENT')

// ── 单/双周：INTERVAL=2 且 COUNT 正确 ──
const odd = generateCourseIcs([Object.assign({}, baseCourse, { weekType: 'odd', weekStart: 1, weekEnd: 16 })])
assert.ok(odd.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8'), '单周 1-16 应 COUNT=8')

const even = generateCourseIcs([Object.assign({}, baseCourse, { weekType: 'even', weekStart: 1, weekEnd: 16 })])
assert.ok(even.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8'), '双周 1-16 应 COUNT=8')

// ── 跨周重复（全周）：COUNT=16 ──
const all = generateCourseIcs([Object.assign({}, baseCourse, { weekStart: 1, weekEnd: 16, weekType: 'all' })])
assert.ok(all.includes('RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=16'), '全周 1-16 应 COUNT=16')

console.log('course-ics.test.js: all assertions passed')
