const assert = require('assert')

const { continuousWindows, decorateResult } = require('../packages/schedule/common/availabilityView')
const { groupCourses, countExcluded } = require('../packages/schedule/common/courseExclusion')

function slot(start, end) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  return { start, end, duration: toMin(end) - toMin(start) }
}

function day(date, weekday, free) {
  return {
    date,
    weekday,
    free,
    hours: [],
    conflicts: [],
    freeMinutes: free.reduce((sum, item) => sum + item.duration, 0)
  }
}

function run() {
  // 周五下午没课，一直到周日全天、周一早上都没事；周一下午又空到周二
  const result = {
    participants: [],
    startDate: '2026-07-02',
    endDate: '2026-07-07',
    range: { start: '08:00', end: '22:00' },
    days: [
      day('2026-07-02', '四', []),
      day('2026-07-03', '五', [slot('08:00', '10:00'), slot('15:00', '22:00')]),
      day('2026-07-04', '六', [slot('08:00', '22:00')]),
      day('2026-07-05', '日', [slot('08:00', '22:00')]),
      day('2026-07-06', '一', [slot('08:00', '10:00'), slot('14:00', '22:00')]),
      day('2026-07-07', '二', [slot('08:00', '22:00')])
    ],
    availableDays: 5
  }

  const { longWindows, shortWindows } = continuousWindows(result, 'zh')
  assert.strictEqual(longWindows.length, 2, 'finds both cross-night windows')
  assert.strictEqual(longWindows[0].label, '7月3日（周五） 15:00 → 7月6日（周一） 10:00', 'longest window comes first')
  assert.strictEqual(longWindows[0].nights, 3, 'Friday afternoon to Monday morning spans three nights')
  assert.strictEqual(longWindows[0].durationMinutes, 4020, 'nights count as free time')
  assert.strictEqual(longWindows[1].label, '7月6日（周一） 14:00 → 7月7日（周二） 22:00', 'shorter window follows')
  assert.strictEqual(longWindows[1].durationMinutes, 1920, 'single-night window duration')
  // 单日不跨夜的空档进短时窗口
  assert(shortWindows.length > 0, 'same-day slots land in short windows')
  assert(shortWindows.every((win) => win.nights === 0), 'short windows never cross midnight')

  // 不跨夜的单日空闲不出现在长窗口里
  const singleDay = {
    range: { start: '08:00', end: '22:00' },
    days: [day('2026-07-08', '三', [slot('13:00', '18:00')])]
  }
  assert.strictEqual(continuousWindows(singleDay, 'zh').longWindows.length, 0, 'same-day slots are not trip windows')

  // 上午忙到 10 点、之后全天有空：窗口从上一天结束时间之后继续到 10:00 前中断
  const broken = {
    range: { start: '08:00', end: '22:00' },
    days: [
      day('2026-07-03', '五', [slot('16:00', '22:00')]),
      day('2026-07-04', '六', [slot('10:00', '22:00')])
    ]
  }
  assert.strictEqual(continuousWindows(broken, 'zh').longWindows.length, 0, 'a morning class breaks the cross-night window')

  // 英文标签
  const en = continuousWindows(result, 'en')
  assert.strictEqual(en.longWindows[0].label, '7月3日（Fri） 15:00 → 7月6日（Mon） 10:00', 'English weekday labels')

  // 月历标注：长窗口跨天连续带（start/mid/end）+ 短时窗口圆点 + 紧凑时长
  const view = decorateResult(result, '2026-07-03', false, '2026-07', 'zh')
  const cellOf = (date) => view.calendarCells.find((cell) => cell.date === date)
  assert.strictEqual(cellOf('2026-07-03').lw, 'start', 'long window starts on Friday')
  assert.strictEqual(cellOf('2026-07-04').lw, 'mid', 'Saturday is mid-band')
  assert.strictEqual(cellOf('2026-07-05').lw, 'mid', 'Sunday is mid-band')
  // 周一既是窗口1的结束又是窗口2的开始，后写入的窗口2生效
  assert.strictEqual(cellOf('2026-07-06').lw, 'start', 'Monday starts the second window')
  assert.strictEqual(cellOf('2026-07-07').lw, 'end', 'Tuesday ends the second window')
  assert.strictEqual(cellOf('2026-07-02').lw, '', 'non-window day has no band')
  assert.strictEqual(cellOf('2026-07-03').sw, true, 'same-day morning slot gets a short-window dot')
  assert.strictEqual(cellOf('2026-07-02').sw, false, 'fully busy day has no dot')
  assert.strictEqual(cellOf('2026-07-03').freeShort, '9h', 'compact duration fits the cell')
  assert.strictEqual(cellOf('2026-07-04').freeShort, '14h', 'whole-hour duration omits minutes')

  // 课程分组：按星期排序，同一门课同一时段聚合为一组，单日日程归入「指定日期」
  const sections = groupCourses([
    { id: 'c1', title: '数学', weekday: 3, start: '10:00', end: '12:00' },
    { id: 'c2', title: '英语', courseCode: 'ENG201', weekday: 1, start: '08:00', end: '10:00', excludedFromFreeTime: true },
    { id: 'c2b', title: '英语', courseCode: 'ENG201', weekday: 1, start: '08:00', end: '10:00', excludedFromFreeTime: true },
    { id: 'c3', title: '讲座', date: '2026-07-10', start: '14:00', end: '16:00' }
  ], 'zh')
  assert.strictEqual(sections.length, 3, 'two weekday groups plus one-off group')
  assert.strictEqual(sections[0].label, '周一', 'weekday groups are ordered')
  assert.strictEqual(sections[1].label, '周三')
  assert.strictEqual(sections[2].label, '指定日期')
  // 周一的两条英语记录聚成一组（共 2 节），全组排除则组级 excluded 为 true
  assert.strictEqual(sections[0].groups.length, 1, 'same course + time collapses into one group')
  assert.strictEqual(sections[0].groups[0].count, 2, 'group counts all sessions')
  assert.deepStrictEqual(sections[0].groups[0].ids, ['c2', 'c2b'], 'group carries all record ids')
  assert.strictEqual(sections[0].groups[0].excluded, true, 'exclusion flag is exposed to the view')

  // 搜索：按课程代码/名称过滤，空组被剔除
  const searched = groupCourses([
    { id: 'c1', title: '数学', weekday: 3, start: '10:00', end: '12:00' },
    { id: 'c2', title: '英语', courseCode: 'ENG201', weekday: 1, start: '08:00', end: '10:00' }
  ], 'zh', 'eng')
  assert.strictEqual(searched.length, 1, 'search filters non-matching sections out')
  assert.strictEqual(searched[0].groups[0].courseCode, 'ENG201', 'search matches course code')
  assert.strictEqual(groupCourses([{ id: 'c1', title: '数学', weekday: 3, start: '10:00', end: '12:00' }], 'zh', 'CCT').length, 0, 'no match yields empty sections')

  // countExcluded 按「类」计数：同一类全部排除才算一门
  assert.strictEqual(countExcluded([
    { title: '英语', courseCode: 'ENG201', start: '08:00', end: '10:00', excludedFromFreeTime: true },
    { title: '英语', courseCode: 'ENG201', start: '08:00', end: '10:00', excludedFromFreeTime: true },
    { title: '数学', start: '10:00', end: '12:00', excludedFromFreeTime: false },
    {}
  ]), 1, 'counts excluded course series, not records')

  console.log('shared-free-windows.test.js: all assertions passed')
}

run()
