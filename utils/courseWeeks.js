function addWeek(target, value) {
  const week = Number(value)
  if (Number.isInteger(week) && week >= 1 && week <= 60) target.add(week)
}

function addRange(target, startValue, endValue) {
  const start = Number(startValue)
  const end = Number(endValue)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > 60) return
  for (let week = start; week <= end; week += 1) target.add(week)
}

function parseWeekValue(value, target) {
  if (Array.isArray(value)) {
    value.forEach((item) => parseWeekValue(item, target))
    return
  }
  if (value === undefined || value === null || value === '') return
  if (typeof value === 'number') {
    addWeek(target, value)
    return
  }

  if (typeof value === 'object') {
    parseWeekValue(value.start ?? value.from ?? value.min, target)
    parseWeekValue(value.end ?? value.to ?? value.max, target)
    parseWeekValue(value.weeks ?? value.values, target)
    return
  }

  const text = String(value).trim()
  if (!text) return
  const rangePattern = /(\d{1,2})\s*(?:-|~|至|到)\s*(\d{1,2})/g
  let match
  while ((match = rangePattern.exec(text))) addRange(target, match[1], match[2])

  text.match(/\d{1,2}/g)?.forEach((week) => addWeek(target, week))
}

function normalizeCourseWeeks(source = {}) {
  const weeks = new Set()
  ;[
    source.week_set,
    source.weekSet,
    source.weeks,
    source.week_numbers,
    source.weekNumbers,
    source.teaching_weeks,
    source.teachingWeeks,
    source.week_range,
    source.weekRange
  ].forEach((value) => parseWeekValue(value, weeks))

  const start = source.week_start ?? source.weekStart ?? source.start_week ?? source.startWeek
  const end = source.week_end ?? source.weekEnd ?? source.end_week ?? source.endWeek
  addRange(weeks, start, end)

  if (!weeks.size) parseWeekValue(source.weeks_text ?? source.weeksText, weeks)
  if (!weeks.size) parseWeekValue(source.week, weeks)
  return Array.from(weeks).sort((a, b) => a - b)
}

function buildWeekSet(startValue, endValue) {
  const weeks = new Set()
  addRange(weeks, startValue, endValue)
  return Array.from(weeks).sort((a, b) => a - b)
}

function formatTeachingWeeks(source, lang = 'zh') {
  const weeks = normalizeCourseWeeks(source)
  if (!weeks.length) return ''
  if (weeks.length === 1) return lang === 'en' ? `Week ${weeks[0]}` : `第 ${weeks[0]} 周`

  const contiguous = weeks.every((week, index) => index === 0 || week === weeks[index - 1] + 1)
  if (contiguous) {
    return lang === 'en'
      ? `Week ${weeks[0]} - Week ${weeks[weeks.length - 1]}`
      : `第 ${weeks[0]} 周 - 第 ${weeks[weeks.length - 1]} 周`
  }
  return lang === 'en' ? `Weeks ${weeks.join(', ')}` : `第 ${weeks.join('、')} 周`
}

module.exports = { normalizeCourseWeeks, buildWeekSet, formatTeachingWeeks }
