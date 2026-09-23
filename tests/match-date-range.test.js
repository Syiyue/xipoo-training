const assert = require('assert')
const { defaultDateRange, earliestCourseDate, DEFAULT_SEMESTER_START } = require('../packages/schedule/common/matchDateRange')

// 开学日 2026-09-07 恰为周一；今天 2026-08-16 为周日。
function at(dateStr) {
  return new Date(`${dateStr}T12:00:00`)
}

// ===== earliestCourseDate：课程具体日期 =====

// 显式 date 字段取最早
assert.strictEqual(
  earliestCourseDate([{ date: '2026-09-08' }, { date: '2026-09-10' }]).getTime(),
  new Date('2026-09-08T00:00:00').getTime(),
  'earliest explicit date'
)

// termStartDate / termStart 也被识别
assert.strictEqual(
  earliestCourseDate([{ termStartDate: '2026-09-07' }]).getTime(),
  new Date('2026-09-07T00:00:00').getTime(),
  'termStartDate recognized'
)

// 教学周 weekStart 结合学期起算日推导（第 2 周 → 2026-09-14）
assert.strictEqual(
  earliestCourseDate([{ weekday: 1, weekStart: 2 }], DEFAULT_SEMESTER_START).getTime(),
  new Date('2026-09-14T00:00:00').getTime(),
  'weekStart derived from semester start'
)

// 空课程返回 null
assert.strictEqual(earliestCourseDate([]), null, 'no courses -> null')

// ===== defaultDateRange：锚定优先级 =====

// 场景 1：学期尚未开始，且课程有 9 月具体日期 → 默认从最早课程日期所在周的周一开始。
const withCourses = defaultDateRange(at('2026-08-16'), DEFAULT_SEMESTER_START, new Date('2026-09-09T00:00:00'))
assert.strictEqual(withCourses.startDate, '2026-09-07', 'course date anchors range (align to week Monday)')
assert.strictEqual(withCourses.endDate, '2026-10-07', 'course date: 31-day window')

// 场景 2：学期尚未开始、无课程具体日期 → 回退到开学日所在周的周一。
const beforeTerm = defaultDateRange(at('2026-08-16'), DEFAULT_SEMESTER_START)
assert.strictEqual(beforeTerm.startDate, '2026-09-07', 'fallback to semester start')
assert.strictEqual(beforeTerm.calendarTitle, '2026年9月')

// 场景 3：课程具体日期在「过去」（如上一学期遗留）→ 不采用，回退到开学日/今天。
const staleCourse = defaultDateRange(at('2026-08-16'), DEFAULT_SEMESTER_START, new Date('2026-06-16T00:00:00'))
assert.strictEqual(staleCourse.startDate, '2026-09-07', 'stale (past) course date ignored')

// 场景 4：学期已开始（9 月中旬，周三）→ 从本周周一开始。
const duringTerm = defaultDateRange(at('2026-09-16'), DEFAULT_SEMESTER_START)
assert.strictEqual(duringTerm.startDate, '2026-09-14', 'during term: current week Monday')
assert.strictEqual(duringTerm.endDate, '2026-10-14')

// 场景 5：未设置学期起算日 → 回退到默认开学日。
const noSetting = defaultDateRange(at('2026-08-16'))
assert.strictEqual(noSetting.startDate, '2026-09-07', 'no setting: fallback to default semester start')

// 场景 6：旧数据混入遥远未来课程时，不得把共享空闲默认页带到 2028/2029。
const corruptedFuture = defaultDateRange(at('2026-08-16'), '2029-01-01', new Date('2029-01-12T00:00:00'))
assert.strictEqual(corruptedFuture.startDate, '2026-08-10', 'far-future anchors ignored')

console.log('match-date-range.test.js: all assertions passed')
