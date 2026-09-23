/**
 * 「排除我不去的课程」共用逻辑：
 * 课程按「一类课」聚合——同一门课（课程代码 + 班型 + 类型 + 同一时段）的所有上课记录
 * 共用一个开关，一次排除整类；支持按课程代码/名称/地点搜索；按星期分组展示。
 * 被标记 excludedFromFreeTime 的课程在计算共同空闲时不计入忙碌。
 */

const WEEKDAY_ZH = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 一类课程的聚合键：如 CCT009 的 Lecture 在同一时段的所有上课记录 */
function seriesKey(course) {
  return [
    course.courseCode || course.title || '',
    course.section || '',
    course.type || '',
    course.start || '',
    course.end || ''
  ].map((value) => String(value).trim().toLowerCase()).join('|')
}

function decorateGroup(sectionKey, records) {
  const first = records[0]
  return {
    key: `${sectionKey}:${seriesKey(first)}`,
    ids: records.map((item) => item.id),
    title: first.title || first.courseCode || '',
    courseCode: first.courseCode || '',
    timeText: `${first.start || ''}-${first.end || ''}`,
    place: first.place || '',
    count: records.length,
    excluded: records.every((item) => item.excludedFromFreeTime)
  }
}

function groupIntoSeries(sectionKey, courses, keyword) {
  const bySeries = {}
  ;(courses || []).forEach((course) => {
    if (keyword) {
      const haystack = `${course.title || ''} ${course.courseCode || ''} ${course.place || ''}`.toLowerCase()
      if (!haystack.includes(keyword)) return
    }
    const key = seriesKey(course)
    if (!bySeries[key]) bySeries[key] = []
    bySeries[key].push(course)
  })
  return Object.keys(bySeries)
    .map((key) => bySeries[key].slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))))
    .sort((a, b) => String(a[0].start || '').localeCompare(String(b[0].start || '')))
    .map((records) => decorateGroup(sectionKey, records))
}

/** courses -> [{ key, label, groups }]；keyword 过滤课程代码/名称/地点，空组不返回 */
function groupCourses(courses, lang, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  const byWeekday = {}
  const dated = []
  ;(courses || []).forEach((course) => {
    const weekday = Number(course.weekday)
    if (weekday >= 1 && weekday <= 7) {
      if (!byWeekday[weekday]) byWeekday[weekday] = []
      byWeekday[weekday].push(course)
    } else {
      dated.push(course)
    }
  })
  const sections = []
  Object.keys(byWeekday)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((weekday) => {
      const groups = groupIntoSeries(`w${weekday}`, byWeekday[weekday], kw)
      if (groups.length) {
        sections.push({
          key: `w${weekday}`,
          label: lang === 'en' ? WEEKDAY_EN[Number(weekday) - 1] : `周${WEEKDAY_ZH[Number(weekday) - 1]}`,
          groups
        })
      }
    })
  const datedGroups = groupIntoSeries('dated', dated, kw)
  if (datedGroups.length) {
    sections.push({
      key: 'dated',
      label: lang === 'en' ? 'One-off events' : '指定日期',
      groups: datedGroups
    })
  }
  return sections
}

/** 已排除的「类」数量：一整类课的全部记录都被排除才算一门 */
function countExcluded(courses) {
  const bySeries = {}
  ;(courses || []).forEach((course) => {
    const key = seriesKey(course)
    if (!bySeries[key]) bySeries[key] = []
    bySeries[key].push(course)
  })
  return Object.keys(bySeries)
    .filter((key) => bySeries[key].every((item) => item.excludedFromFreeTime))
    .length
}

module.exports = {
  groupCourses,
  countExcluded,
  seriesKey
}
