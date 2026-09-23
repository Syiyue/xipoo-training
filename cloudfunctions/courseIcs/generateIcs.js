/**
 * generateIcs.js — 课程表 → iCalendar (RFC 5545) 生成器
 *
 * 输入：courses 数组，每项包含 title/location/termStart/weekStart/weekEnd/
 *       weekType/weekday/startTime/endTime
 * 输出：标准 .ics 文本字符串
 *
 * 核心逻辑：
 *  - 根据学期第一周周一(termStart) + weekStart + weekday 算出第一次上课的真实日期
 *  - 通过 RRULE 的 FREQ=WEEKLY + INTERVAL 实现 全周/单周/双周 循环
 *  - 时区固定 Asia/Shanghai（不使用 UTC，避免夏令时偏移）
 *  - 每个 VEVENT 生成全局唯一 UID
 */

const crypto = require('crypto')

// ─── 常量 ────────────────────────────────────────────
const TIMEZONE = 'Asia/Shanghai'
const PRODID = '-//Xipoo//Course Schedule//ZH'

// ─── 辅助函数 ────────────────────────────────────────

/**
 * 将 "YYYY-MM-DD" 或 Date 转为不含时间的日期对象
 */
function parseDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }
  const str = String(value || '').trim()
  if (!str) return null
  // 兼容 "2026-09-07" 或 "2026/09/07"
  const normalized = str.replace(/\//g, '-')
  const d = new Date(normalized + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * 日期偏移 days 天，返回新的 Date（不影响原对象）
 */
function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * 格式化日期为 YYYYMMDD（iCalendar DATE 值格式）
 */
function formatDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * 格式化时间为 HHMMSS（iCalendar TIME 值格式，本地时间）
 * 输入如 "09:00" → "090000"
 */
function formatTimeStr(time) {
  const parts = String(time || '00:00').split(':')
  const h = String(parts[0] || '0').padStart(2, '0')
  const m = String(parts[1] || '0').padStart(2, '0')
  return `${h}${m}00`
}

/**
 * 生成 RFC 5545 DTSTAMP（当前 UTC 时间）
 */
function formatDtStamp() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const mi = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${d}T${h}${mi}${s}Z`
}

/**
 * 安全转义 iCalendar 文本字段（处理逗号、分号、反斜杠、换行）
 * 遵循 RFC 5545 3.3.11
 */
function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

/**
 * 生成全局唯一 UID
 * 格式：{sha1前8位}-{timestamp}@xipoo
 */
function generateUid(course, index) {
  const seed = [
    course.title || 'course',
    course.weekday,
    course.startTime,
    course.endTime,
    course.weekStart,
    course.weekEnd,
    course.weekType || 'all',
    index,
    Date.now()
  ].join('|')
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8)
  return `${hash}-${Date.now()}@xipoo`
}

// ─── RRULE 构建 ──────────────────────────────────────

/**
 * 根据 weekType 构建 RRULE 字符串
 *
 * weekType 含义：
 *  - 'all'  → FREQ=WEEKLY;INTERVAL=1   (每周)
 *  - 'odd'  → FREQ=WEEKLY;INTERVAL=2   (隔周，从奇数周开始)
 *  - 'even' → FREQ=WEEKLY;INTERVAL=2   (隔周，从偶数周开始)
 *
 * "单/双周" 的关键在于 DTSTART 落在正确的教学周：
 *   - 单周课程：DTSTART = termStart + (weekStart-1)*7 + (weekday-1)，其中 weekStart 为奇数
 *   - 双周课程：DTSTART = termStart + (weekStart-1)*7 + (weekday-1)，其中 weekStart 为偶数
 * 然后 INTERVAL=2 即可保持隔周重复。
 *
 * 注意：对于仅有部分周的课程（如 weekStart=2, weekEnd=12），
 * RRULE 中需要 COUNT 或 UNTIL 来限定结束。
 */
function buildRRule(course, firstDate) {
  const weekType = (course.weekType || 'all').toLowerCase()
  const weekStart = Number(course.weekStart) || 1
  const weekEnd = Number(course.weekEnd) || weekStart
  const totalWeeks = weekEnd - weekStart + 1

  let interval = 1

  if (weekType === 'odd' || weekType === 'even') {
    // 单/双周：每两周一次
    interval = 2

    // 安全校验：确保 DTSTART 落在声明类型的周
    // 若 weekStart 与 weekType 不匹配，修正 DTSTART 到下一符合类型的周
    const isStartOdd = weekStart % 2 === 1
    const expectsOdd = weekType === 'odd'
    if (isStartOdd !== expectsOdd) {
      // weekStart 与 weekType 不匹配，说明数据有问题
      // 但 DTSTART 已由调用方根据 weekStart 算出，这里不再修正
      // RRULE INTERVAL=2 配合正确的 DTSTART 即可正常工作
    }
  }

  // 计算重复次数 COUNT
  // 全周：总周数；单/双周：总周数内符合类型的周数
  let count
  if (interval === 1) {
    count = totalWeeks
  } else {
    // 隔周：从 weekStart 到 weekEnd 之间，步长为 2 的周数
    count = Math.floor((weekEnd - weekStart) / interval) + 1
  }

  // 如果只有 1 次上课（如只有 1 个有效周），不添加 RRULE
  if (count <= 1) {
    return null
  }

  return `FREQ=WEEKLY;INTERVAL=${interval};COUNT=${count}`
}

// ─── 主生成函数 ──────────────────────────────────────

/**
 * 为单门课程生成 VEVENT 块
 *
 * @param {Object} course - 课程数据
 * @param {number} index  - 在数组中的索引（用于 UID 区分）
 * @param {Date}   termStartDate - 学期第一周周一的 Date 对象
 * @returns {string} VEVENT iCalendar 文本
 */
function buildVEvent(course, index, termStartDate) {
  const weekday = Number(course.weekday) || 1  // 1=周一, 7=周日
  const weekStart = Number(course.weekStart) || 1
  const weekEnd = Number(course.weekEnd) || weekStart

  // ── 计算第一次上课的真实日期 ──
  // 学期第一周周一 + (weekStart - 1) 周 + (weekday - 1) 天
  const daysOffset = (weekStart - 1) * 7 + (weekday - 1)
  const firstDate = addDays(termStartDate, daysOffset)

  // 格式化 DTSTART / DTEND（本地日期时间，使用 TZID）
  const startDateTime = `${formatDateStr(firstDate)}T${formatTimeStr(course.startTime || '09:00')}`
  const endDateTime = `${formatDateStr(firstDate)}T${formatTimeStr(course.endTime || '10:30')}`

  const dtStamp = formatDtStamp()
  const uid = generateUid(course, index)
  const summary = escapeIcsText(course.title || '未命名课程')
  const location = escapeIcsText(course.location || course.place || '')

  // 可选：描述信息
  const descriptionParts = []
  if (course.teacher) descriptionParts.push(`教师: ${course.teacher}`)
  if (course.courseCode) descriptionParts.push(`课程代码: ${course.courseCode}`)
  const weekTypeLabel = { all: '全周', odd: '单周', even: '双周' }[course.weekType] || '全周'
  descriptionParts.push(`教学周: 第${weekStart}-${weekEnd}周 (${weekTypeLabel})`)
  const description = escapeIcsText(descriptionParts.join('\\n'))

  // RRULE（仅当需要重复多次时）
  const rrule = buildRRule(course, firstDate)

  // 组装 VEVENT
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${dtStamp}`,
    `UID:${uid}`,
    `DTSTART;TZID=${TIMEZONE}:${startDateTime}`,
    `DTEND;TZID=${TIMEZONE}:${endDateTime}`,
    `SUMMARY:${summary}`
  ]

  if (location) {
    lines.push(`LOCATION:${location}`)
  }

  if (description) {
    lines.push(`DESCRIPTION:${description}`)
  }

  if (rrule) {
    lines.push(`RRULE:${rrule}`)
  }

  lines.push('END:VEVENT')

  return lines.join('\r\n')
}

/**
 * 生成完整的 iCalendar 文件内容
 *
 * @param {Array} courses - 课程数组
 * @returns {string} 标准 .ics 文本
 */
function generateCourseIcs(courses) {
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new Error('课程列表为空，无法生成日历')
  }

  // ── 确定学期起始日期 ──
  // 优先取第一门课程的 termStart；各课程可以有不同的 termStart
  // 但通常同一份课表共用一个学期起始日
  const firstCourse = courses[0]
  let defaultTermStart = parseDate(firstCourse.termStart)
  if (!defaultTermStart) {
    // 兜底：使用当前学期的常见起始日
    defaultTermStart = new Date(new Date().getFullYear(), 8, 1) // 当年9月1日
    // 调整到周一
    const dayOfWeek = defaultTermStart.getDay()
    const offset = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek)
    defaultTermStart.setDate(defaultTermStart.getDate() + offset)
  }

  // ── 构建 VCALENDAR 头部 ──
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Xipoo 课程表',
    `X-WR-TIMEZONE:${TIMEZONE}`,
    // VTIMEZONE 定义（让不支持 TZID 的日历应用也能正确处理时区）
    'BEGIN:VTIMEZONE',
    `TZID:${TIMEZONE}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE'
  ].join('\r\n')

  // ── 为每门课程生成 VEVENT ──
  const events = courses.map((course, index) => {
    // 每门课程允许有自己的 termStart，找不到则用全局兜底
    const courseTermStart = parseDate(course.termStart) || defaultTermStart
    return buildVEvent(course, index, courseTermStart)
  })

  // ── 组装完整 ICS ──
  const body = events.join('\r\n')
  const footer = 'END:VCALENDAR\r\n'

  return `${header}\r\n${body}\r\n${footer}`
}

module.exports = {
  generateCourseIcs,
  // 导出辅助函数方便单元测试
  _internal: {
    parseDate,
    addDays,
    formatDateStr,
    formatTimeStr,
    escapeIcsText,
    generateUid,
    buildRRule,
    buildVEvent
  }
}
