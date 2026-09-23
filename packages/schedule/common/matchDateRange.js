// 多人共同空闲默认日期范围计算（纯函数，无 wx 依赖，便于单测）。
// 学期起算日口径与 pages/schedule/schedule.js 一致：教学周第 1 周的第 1 天。

const DEFAULT_SEMESTER_START = '2026-09-07'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function monthTitle(dateString) {
  const date = new Date(`${dateString}T00:00:00`)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

// 解析日期（Date 或 YYYY-MM-DD / 带时间的日期串，取前 10 位）；非法时返回 fallback（可为 null）。
function parseDate(value, fallback) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
  const text = String(value == null ? '' : value).slice(0, 10)
  const date = new Date(`${text}T00:00:00`)
  if (Number.isNaN(date.getTime())) return fallback == null ? null : new Date(`${fallback}T00:00:00`)
  return date
}

// 回退到所在周的周一（与日程页周起始口径一致：周一开始）。
function startOfWeek(date) {
  const monday = new Date(date)
  const day = date.getDay()
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return monday
}

/**
 * 课程数据中最早的「具体日期」，用于锚定共同空闲的默认日期范围。
 * 依次识别：
 *   1. course.date / course.termStartDate / course.termStart —— 显式具体日期；
 *   2. course.weekStart / course.week_start —— 教学周，结合学期起算日推导为具体日期。
 * @param {Array} [courses]
 * @param {string} [semesterStartDate]
 * @returns {Date|null}
 */
function earliestCourseDate(courses, semesterStartDate) {
  const semesterStart = parseDate(semesterStartDate, DEFAULT_SEMESTER_START)
  let earliest = null
  ;(courses || []).forEach((course) => {
    const explicit = course.date || course.termStartDate || course.termStart
    if (explicit) {
      const date = parseDate(explicit, null)
      if (date && (!earliest || date < earliest)) earliest = date
      return
    }
    const week = Number(course.weekStart ?? course.week_start)
    if (Number.isInteger(week) && week >= 1) {
      const derived = new Date(semesterStart.getTime())
      derived.setDate(semesterStart.getDate() + (week - 1) * 7)
      if (!earliest || derived < earliest) earliest = derived
    }
  })
  return earliest
}

/**
 * 默认日期范围：31 天窗口（保持后端单次计算上限）。
 * 起点锚定优先级：课程最早具体日期（未来）> 学期起算日（未来）> 本周周一。
 * 避免把开课前的空闲期（例如 8 月）纳入共同空闲计算。
 *
 * @param {Date} [now] 当前时间，默认 new Date()（测试可注入）
 * @param {string} [semesterStartDate] 学期起算日，默认 DEFAULT_SEMESTER_START（测试可注入）
 * @param {Date|string} [earliestCourse] 课程最早具体日期（测试可注入）
 */
function defaultDateRange(now, semesterStartDate, earliestCourse) {
  const today = now || new Date()
  const semesterStart = parseDate(semesterStartDate, DEFAULT_SEMESTER_START)
  const courseStart = parseDate(earliestCourse, null)
  const latestReasonableStart = new Date(today)
  latestReasonableStart.setDate(today.getDate() + 180)

  let base
  if (courseStart && courseStart > today && courseStart <= latestReasonableStart) {
    base = courseStart
  } else if (semesterStart > today && semesterStart <= latestReasonableStart) {
    base = semesterStart
  } else {
    base = today
  }

  const start = startOfWeek(base)
  const end = new Date(start)
  end.setDate(start.getDate() + 30)

  const startDate = formatDateKey(start)
  const endDate = formatDateKey(end)
  return {
    startDate,
    endDate,
    calendarMonth: `${startDate.slice(0, 7)}-01`,
    calendarTitle: monthTitle(startDate),
    selectedDate: startDate
  }
}

module.exports = { defaultDateRange, earliestCourseDate, monthTitle, DEFAULT_SEMESTER_START }
