// 多人共同空闲 V2 的展示计算层。
// 云端 groupAvailability 负责算交集；本文件只消费其真实 free/slots 数据，不修改计算结果。
const DISPLAY_RANGE = { start: '09:00', end: '20:00' }
const MEMBER_COLORS = ['#3D73DD', '#41A85F', '#F47B20', '#2D9CDB', '#C35BCF', '#C9A227', '#238A82']

function minutes(value) {
  const parts = String(value || '00:00').split(':').map(Number)
  return parts[0] * 60 + (parts[1] || 0)
}

function formatTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function durationText(value) {
  const hours = Math.floor(value / 60)
  const rest = value % 60
  if (!hours) return `${rest}分钟`
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekday(date) {
  return ['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00`).getDay()]
}

function clipSlot(slot, range = DISPLAY_RANGE) {
  const start = Math.max(minutes(slot.start), minutes(range.start))
  const end = Math.min(minutes(slot.end), minutes(range.end))
  return end > start ? { start: formatTime(start), end: formatTime(end), duration: end - start } : null
}

function mergeAdjacentSlots(slots, maxGapMinutes = 0) {
  return (Array.isArray(slots) ? slots : [])
    .map((slot) => ({ start: String(slot.start), end: String(slot.end), duration: Number(slot.duration || (minutes(slot.end) - minutes(slot.start)) ) }))
    .filter((slot) => minutes(slot.end) > minutes(slot.start))
    .sort((a, b) => minutes(a.start) - minutes(b.start))
    .reduce((merged, slot) => {
      const last = merged[merged.length - 1]
      if (last && minutes(slot.start) - minutes(last.end) <= maxGapMinutes) {
        last.end = formatTime(Math.max(minutes(last.end), minutes(slot.end)))
        last.duration = minutes(last.end) - minutes(last.start)
      } else {
        merged.push(Object.assign({}, slot))
      }
      return merged
    }, [])
}

function sharedSlots(day, range = DISPLAY_RANGE) {
  return mergeAdjacentSlots((day && day.free || []).map((slot) => clipSlot(slot, range)).filter(Boolean))
}

function getLongestSharedSlot(slots) {
  return (Array.isArray(slots) ? slots : []).reduce((longest, slot) => (
    !longest || Number(slot.duration) > Number(longest.duration) ? slot : longest
  ), null)
}

function getAvailabilityLevel(slots, range = DISPLAY_RANGE) {
  const longest = getLongestSharedSlot(slots)
  if (!longest) return 'none'
  const span = minutes(range.end) - minutes(range.start)
  if (Number(longest.duration) >= span) return 'fullDay'
  if (Number(longest.duration) >= 240) return 'long'
  if (Number(longest.duration) >= 120) return 'medium'
  return 'short'
}

function rangeStyle(slot, range = DISPLAY_RANGE) {
  const start = minutes(range.start)
  const span = minutes(range.end) - start
  const left = ((minutes(slot.start) - start) / span) * 100
  const width = ((minutes(slot.end) - minutes(slot.start)) / span) * 100
  return `left:${Math.max(0, left).toFixed(3)}%;width:${Math.max(0, width).toFixed(3)}%;`
}

function briefDate(dateString) {
  const parts = String(dateString || '').split('-')
  return `${Number(parts[1])}月${Number(parts[2])}日`
}

function briefDateList(cells) {
  const list = (cells || []).map((cell) => briefDate(cell.date))
  if (list.length <= 6) return list.join('、')
  return `${list.slice(0, 6).join('、')}等${list.length}天`
}

function buildMonthNarrative(calendarCells) {
  const inMonth = (calendarCells || []).filter((cell) => cell.inMonth && cell.inRange)
  const groups = [
    { key: 'fullDay', label: '全天共同空闲', hint: '09:00–20:00 都有空' },
    { key: 'long', label: '半天及以上共同空闲', hint: '连续 4 小时及以上' },
    { key: 'medium', label: '较有空的日期', hint: '连续 2–4 小时' }
  ]
  return groups.map((group) => {
    const matches = inMonth.filter((cell) => cell.level === group.key)
    return {
      key: group.key,
      label: group.label,
      hint: group.hint,
      text: matches.length ? briefDateList(matches) : '本月暂无'
    }
  })
}

function buildMonthCells(result, calendarMonth, selectedDate, range = DISPLAY_RANGE) {
  const monthStart = new Date(`${calendarMonth}T00:00:00`)
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - ((monthStart.getDay() + 6) % 7))
  const dayMap = Object.fromEntries((result.days || []).map((day) => [day.date, day]))
  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const key = dateKey(date)
    const day = dayMap[key]
    const slots = sharedSlots(day, range)
    const longest = getLongestSharedSlot(slots)
    const level = getAvailabilityLevel(slots, range)
    return {
      date: key,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
      inRange: Boolean(day),
      selected: key === selectedDate,
      level,
      segments: slots.map((slot) => Object.assign({}, slot, { style: rangeStyle(slot, range), level })),
      longestLabel: longest && Number(longest.duration) >= 120 ? `${longest.start.slice(0, 2)}-${longest.end.slice(0, 2)}` : '',
      hasSharedTime: slots.length > 0
    }
  })
}

function busySegmentsForMember(day, memberId, range = DISPLAY_RANGE) {
  // 多人共同空闲走 friend 云函数（groupAvailability），其 day 结构是 day.slots
  // （30 分钟桶 + busyUserIds 数组）。这里优先读 slots；conflicts（match 云函数格式）作兜底兼容。
  let source = []
  if (day && Array.isArray(day.slots)) {
    source = day.slots
      .filter((slot) => Array.isArray(slot.busyUserIds) && slot.busyUserIds.includes(memberId))
      .map((slot) => clipSlot(slot, range))
      .filter(Boolean)
  } else if (day && Array.isArray(day.conflicts)) {
    source = day.conflicts
      .filter((item) => item.userId === memberId)
      .map((item) => clipSlot(item, range))
      .filter(Boolean)
  }
  return mergeAdjacentSlots(source).map((slot) => Object.assign({}, slot, { style: rangeStyle(slot, range) }))
}

// 成员在该日期下的空闲时间：把其忙碌区间在展示范围(09:00–20:00)内取反得到空闲段。
// 仅用于「查看成员日程」示意展示，不参与共同空闲计算。
function freeSegmentsForMember(day, memberId, range = DISPLAY_RANGE) {
  const busy = busySegmentsForMember(day, memberId, range)
  const start = minutes(range.start)
  const end = minutes(range.end)
  const free = []
  let cursor = start
  busy.forEach((slot) => {
    const s = minutes(slot.start)
    const e = minutes(slot.end)
    if (s - cursor > 0) {
      free.push({ start: formatTime(cursor), end: formatTime(s), duration: s - cursor })
    }
    cursor = Math.max(cursor, e)
  })
  if (end - cursor > 0) {
    free.push({ start: formatTime(cursor), end: formatTime(end), duration: end - cursor })
  }
  return free.map((slot) => Object.assign({}, slot, { style: rangeStyle(slot, range) }))
}

function buildDayTimeline(day, participants, range = DISPLAY_RANGE) {
  const sharedFreeSlots = sharedSlots(day, range)
  const longestSlot = getLongestSharedSlot(sharedFreeSlots)
  const ticks = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '20:00'].map((label) => ({
    label: label.slice(0, 2),
    style: `left:${(((minutes(label) - minutes(range.start)) / (minutes(range.end) - minutes(range.start))) * 100).toFixed(3)}%;`
  }))
  return {
    range,
    ticks,
    sharedFreeSlots: sharedFreeSlots.map((slot) => Object.assign({}, slot, { style: rangeStyle(slot, range) })),
    longestSlot,
    longestText: longestSlot ? durationText(longestSlot.duration) : '',
    memberRows: (participants || []).map((person, index) => ({
      id: person.id,
      name: person.name,
      avatar: person.avatar,
      color: MEMBER_COLORS[index % MEMBER_COLORS.length],
      busySegments: busySegmentsForMember(day, person.id, range),
      freeSegments: freeSegmentsForMember(day, person.id, range)
    }))
  }
}

function buildAvailabilityView(result, calendarMonth, selectedDate, range = DISPLAY_RANGE) {
  const days = result && result.days || []
  const available = days.find((day) => day.date === selectedDate) || days[0] || null
  const month = calendarMonth || (available ? `${available.date.slice(0, 7)}-01` : result.startDate)
  const calendarCells = buildMonthCells(result, month, available ? available.date : selectedDate, range)
  const longDayCount = calendarCells.filter((cell) => cell.inMonth && ['long', 'fullDay'].includes(cell.level)).length
  return {
    selectedDay: available,
    calendarCells,
    timeline: buildDayTimeline(available, result.participants, range),
    stats: { participantCount: (result.participants || []).length, longDayCount },
    narrative: buildMonthNarrative(calendarCells)
  }
}

module.exports = {
  DISPLAY_RANGE,
  MEMBER_COLORS,
  mergeAdjacentSlots,
  getLongestSharedSlot,
  getAvailabilityLevel,
  sharedSlots,
  buildDayTimeline,
  buildMonthCells,
  buildAvailabilityView,
  buildMonthNarrative,
  minutes,
  formatTime,
  durationText
}
