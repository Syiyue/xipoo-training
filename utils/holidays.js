/**
 * 法定节假日（2026-2027 学年）。
 * 校历颜色标记。课程在这些日期仍然显示，标记仅用于提醒用户以学校通知为准。
 */

const CALENDAR_MARKS = {}
function add(type, dates) { dates.forEach((date) => { CALENDAR_MARKS[date] = type }) }
add('holiday', ['2026-09-25', '2026-10-01', '2026-10-02', '2026-10-03', '2026-12-25', '2027-01-01', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-04-05', '2027-04-30', '2027-05-01', '2027-05-02', '2027-06-09'])
add('closure', ['2026-09-28', '2026-09-29', '2026-09-30', '2026-12-24', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-05-03', '2027-05-04'])
add('exam', ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-06-01', '2027-06-02', '2027-06-03', '2027-06-04', '2027-06-07', '2027-06-08', '2027-06-10', '2027-06-11', '2027-08-02', '2027-08-03', '2027-08-04', '2027-08-05', '2027-08-06'])
add('graduation', ['2027-04-21', '2027-04-22', '2027-07-26', '2027-07-27', '2027-07-28', '2027-07-29', '2027-07-30'])

const STATUTORY_HOLIDAYS = Object.keys(CALENDAR_MARKS).filter((date) => CALENDAR_MARKS[date] === 'holiday')

function isStatutoryHoliday(dateStr) {
  return Boolean(dateStr) && STATUTORY_HOLIDAYS.includes(dateStr)
}

function getCalendarMark(dateStr) {
  const type = CALENDAR_MARKS[dateStr]
  if (!type) return null
  const labels = { holiday: '法定节假日', closure: '学校关闭日', exam: '考试日', graduation: '毕业典礼' }
  return { type, label: labels[type] }
}

module.exports = { STATUTORY_HOLIDAYS, CALENDAR_MARKS, isStatutoryHoliday, getCalendarMark }
