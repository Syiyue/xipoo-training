function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function durationText(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}分钟`
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`
}

function toMinutes(time) {
  const parts = String(time || '00:00').split(':')
  return Number(parts[0]) * 60 + Number(parts[1] || 0)
}

function dayDiff(startDate, endDate) {
  return Math.round((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000)
}

const WEEKDAY_EN = { 日: 'Sun', 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat' }

/**
 * 格式化日期为 X月X日（周X）
 */
function dateLabel(dateStr, lang) {
  const parts = dateStr.split('-')
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)
  const d = new Date(`${dateStr}T00:00:00`)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${month}月${day}日（${lang === 'en' ? WEEKDAY_EN[weekday] : '周' + weekday}）`
}

/**
 * 共同空闲窗口：同时输出跨天长时间窗口 + 单日短时窗口。
 */
function continuousWindows(result, lang) {
  if (!result || !Array.isArray(result.days) || !result.range) return { longWindows: [], shortWindows: [] }
  const rangeStart = result.range.start
  const rangeEnd = result.range.end
  const allWindows = []
  let current = null
  const closeCurrent = () => {
    if (current) allWindows.push(current)
    current = null
  }
  result.days.forEach((day) => {
    const slots = day.free || []
    const touchesEnd = slots.length > 0 && slots[slots.length - 1].end === rangeEnd
    let startIndex = 0
    if (current) {
      if (slots.length && slots[0].start === rangeStart) {
        current.endDate = day.date
        current.endWeekday = day.weekday
        current.end = slots[0].end
        if (slots.length === 1 && touchesEnd) return
        closeCurrent()
        startIndex = 1
      } else {
        closeCurrent()
      }
    }
    for (let index = startIndex; index < slots.length; index += 1) {
      const slot = slots[index]
      const win = {
        date: day.date,
        startDate: day.date,
        start: slot.start,
        startWeekday: day.weekday,
        endDate: day.date,
        end: slot.end,
        endWeekday: day.weekday
      }
      if (index === slots.length - 1 && touchesEnd) current = win
      else allWindows.push(win)
    }
  })
  closeCurrent()

  // 为每个窗口附加日期标签和时长
  const decorated = allWindows.map((win) => {
    const nights = dayDiff(win.startDate, win.endDate)
    const durationMinutes = nights * 1440 - toMinutes(win.start) + toMinutes(win.end)
    const hours = Math.round(durationMinutes / 60)
    const startWDL = lang === 'en' ? WEEKDAY_EN[win.startWeekday] : `周${win.startWeekday}`
    const endWDL = lang === 'en' ? WEEKDAY_EN[win.endWeekday] : `周${win.endWeekday}`
    // 短时窗口按上午/下午/晚上分桶
    const startMin = toMinutes(win.start)
    const period = startMin < 720 ? '上午' : (startMin < 1080 ? '下午' : '晚上')
    return Object.assign({}, win, {
      nights,
      durationMinutes,
      date: win.date,
      period,
      label: nights > 0
        ? `${dateLabel(win.startDate, lang)} ${win.start} → ${dateLabel(win.endDate, lang)} ${win.end}`
        : `${dateLabel(win.startDate, lang)} ${period} ${win.start}-${win.end}`,
      durationText: lang === 'en'
        ? `${nights + 1} days (~${hours}h)`
        : nights > 0 ? `连续${nights + 1}天（约${hours}小时）` : `${durationText(durationMinutes)}`
    })
  })

  // 长时间窗口：跨天 > 0
  const longWindows = decorated
    .filter((win) => win.nights > 0)
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
    .slice(0, 5)

  // 短时间窗口：非跨天且 ≥ 30 分钟，按时长降序
  const shortWindows = decorated
    .filter((win) => win.nights === 0 && win.durationMinutes >= 30)
    .sort((a, b) => b.durationMinutes - a.durationMinutes)
    .slice(0, 8)

  return { longWindows, shortWindows }
}

/** 起止日期之间的所有日期（含两端），YYYY-MM-DD 数组 */
function datesBetween(startDate, endDate) {
  const dates = []
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  while (cursor <= end) {
    dates.push(dateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/** 单元格里的紧凑空闲时长：7h50m / 50m（"7小时50分钟"在格子里放不下） */
function freeShortText(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h${rest}m` : `${hours}h`
}

function decorateResult(result, selectedDate, onlyAvailable, calendarMonth, lang) {
  if (!result || !result.days || !result.days.length) {
    return { calendarCells: [], selectedDay: null, visibleDays: [], longWindows: [], shortWindows: [] }
  }
  const { longWindows, shortWindows } = continuousWindows(result, lang)

  // 把长/短时窗口标注到月历格子上：长窗口跨天连续带（lw-start/mid/end），短时窗口小圆点（sw）
  const lwMap = {}
  longWindows.forEach((win) => {
    const dates = datesBetween(win.startDate, win.endDate)
    dates.forEach((date, index) => {
      lwMap[date] = index === 0 ? 'start' : (index === dates.length - 1 ? 'end' : 'mid')
    })
  })
  const swSet = new Set(shortWindows.map((win) => win.date))

  const monthStr = calendarMonth || result.startDate
  const parts = monthStr.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1]) - 1
  const monthStart = new Date(year, month, 1)
  const offset = (monthStart.getDay() + 6) % 7
  const gridStart = new Date(year, month, 1 - offset)
  const dayMap = {}
  result.days.forEach((day) => {
    dayMap[day.date] = Object.assign({}, day, {
      freeText: durationText(day.freeMinutes),
      freeShort: freeShortText(day.freeMinutes),
      visible: !onlyAvailable || day.freeMinutes > 0
    })
  })
  const calendarCells = Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const key = dateKey(date)
    const day = dayMap[key]
    return {
      date: key,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === month,
      inRange: Boolean(day),
      selected: key === selectedDate,
      freeMinutes: day ? day.freeMinutes : 0,
      freeText: day ? day.freeText : '',
      freeShort: day ? day.freeShort : '',
      level: day ? Math.min(4, Math.ceil(day.freeMinutes / 180)) : 0,
      hiddenByFilter: Boolean(day && !day.visible),
      lw: lwMap[key] || '',
      sw: swSet.has(key)
    }
  })
  const visibleDays = result.days.filter((day) => !onlyAvailable || day.freeMinutes > 0)
  const selectedDay = dayMap[selectedDate] || visibleDays[0] || result.days[0]
  return { calendarCells, selectedDay, visibleDays, longWindows, shortWindows }
}

module.exports = {
  decorateResult,
  durationText,
  continuousWindows
}