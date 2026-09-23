// 共同空闲计算的纯函数。放在 friend 云函数中，避免为日程共享加载庞大的社交匹配模块。
// 云函数调用的响应上限为 1 MB。多人、多日计算不能把同一节课在“每天”和“每小时”重复回传。
const MAX_DAYS_PER_REQUEST = 200
const MAX_FREE_WINDOWS_PER_DAY = 12
const MAX_CONFLICTS_PER_HOUR = 3
const MAX_NAME_LENGTH = 40
const MAX_COURSE_TEXT_LENGTH = 64

function minutes(time) {
  const parts = String(time || '00:00').split(':').map(Number)
  return parts[0] * 60 + parts[1]
}

function formatTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function courseOccursOn(course, date) {
  if (course.date === date) return true
  if (!course.weekday) return false
  const target = new Date(`${date}T00:00:00`)
  const weekday = target.getDay() === 0 ? 7 : target.getDay()
  if (Number(course.weekday) !== weekday) return false
  if (course.termStartDate && date < course.termStartDate) return false
  if (course.termEndDate && date > course.termEndDate) return false
  return true
}

function mergeBusyIntervals(items, rangeStart, rangeEnd) {
  const intervals = items
    .map((item) => ({ start: Math.max(rangeStart, minutes(item.start)), end: Math.min(rangeEnd, minutes(item.end)) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  return intervals.reduce((merged, interval) => {
    const previous = merged[merged.length - 1]
    if (!previous || interval.start > previous.end) merged.push(interval)
    else previous.end = Math.max(previous.end, interval.end)
    return merged
  }, [])
}

function clippedText(value, maxLength) {
  const text = String(value || '')
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text
}

function compactConflict(item) {
  // 页面弹窗只使用下列字段；不回传原始日程文档的图片、描述、重复规则等大字段。
  return {
    id: clippedText(item.id, 64),
    userName: clippedText(item.userName, MAX_NAME_LENGTH),
    avatar: clippedText(item.avatar, 16),
    title: clippedText(item.title, MAX_COURSE_TEXT_LENGTH),
    start: item.start,
    end: item.end,
    place: clippedText(item.place, MAX_COURSE_TEXT_LENGTH)
  }
}

function groupFreeSlotsCore(participants, schedulesByUser, startDate, endDate, range = {}) {
  if (!startDate || !endDate || startDate > endDate) throw new Error('请选择正确的日期范围')
  const rangeStart = minutes(range.start || '08:00')
  const rangeEnd = minutes(range.end || '22:00')
  if (rangeEnd <= rangeStart) throw new Error('结束时间必须晚于开始时间')
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if ((end - cursor) / 86400000 >= MAX_DAYS_PER_REQUEST) throw new Error('单次共同空闲计算最多 200 天')

  const participantIds = participants.map((item) => item.id)
  const days = []
  while (cursor <= end) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const conflicts = participantIds.flatMap((id) => {
      const participant = participants.find((item) => item.id === id)
      return (schedulesByUser[id] || [])
        .filter((course) => !course.excludedFromFreeTime && courseOccursOn(course, date))
        .filter((course) => minutes(course.end) > rangeStart && minutes(course.start) < rangeEnd)
        .map((course) => ({
          id: `${id}-${course.id || course._id || 'course'}-${date}`,
          userId: id,
          userName: participant.name,
          avatar: participant.avatar,
          courseId: course.id || course._id || '',
          title: course.title || '',
          start: course.start,
          end: course.end,
          place: course.place || ''
        }))
    })
    const busy = mergeBusyIntervals(conflicts, rangeStart, rangeEnd)
    const allFree = []
    let pointer = rangeStart
    busy.forEach((interval) => {
      if (interval.start - pointer >= 30) allFree.push({ start: formatTime(pointer), end: formatTime(interval.start), duration: interval.start - pointer })
      pointer = Math.max(pointer, interval.end)
    })
    if (rangeEnd - pointer >= 30) allFree.push({ start: formatTime(pointer), end: formatTime(rangeEnd), duration: rangeEnd - pointer })

    const hours = []
    for (let hour = Math.ceil(rangeStart / 60); hour < Math.floor(rangeEnd / 60); hour += 1) {
      const start = hour * 60
      const endMinute = start + 60
      const busyUsers = participantIds.filter((id) => conflicts.some((item) => item.userId === id && minutes(item.end) > start && minutes(item.start) < endMinute))
      const hourConflicts = conflicts.filter((item) => minutes(item.end) > start && minutes(item.start) < endMinute)
      hours.push({
        label: `${String(hour).padStart(2, '0')}:00`, start: formatTime(start), end: formatTime(endMinute),
        state: busyUsers.length === 0 ? 'available' : (busyUsers.length === participantIds.length ? 'busy' : 'partial'),
        busyCount: busyUsers.length,
        conflictCount: hourConflicts.length,
        conflictsTruncated: hourConflicts.length > MAX_CONFLICTS_PER_HOUR,
        conflicts: hourConflicts.slice(0, MAX_CONFLICTS_PER_HOUR).map(compactConflict)
      })
    }
    // 周热力矩阵以 30 分钟为单位渲染。仅回传成员 ID 与人数，不复制课程详情，
    // 因而既能准确表示半小时忙闲，又不会扩大云函数响应体。
    const slots = []
    for (let start = rangeStart; start < rangeEnd; start += 30) {
      const endMinute = Math.min(rangeEnd, start + 30)
      const busyUserIds = participantIds.filter((id) => conflicts.some((item) => (
        item.userId === id && minutes(item.end) > start && minutes(item.start) < endMinute
      )))
      slots.push({
        start: formatTime(start),
        end: formatTime(endMinute),
        busyUserIds,
        freeCount: participantIds.length - busyUserIds.length
      })
    }
    // 不返回日级 conflicts：页面未使用它，而它会与 hours.conflicts 重复数十倍。
    days.push({
      date,
      weekday: ['日', '一', '二', '三', '四', '五', '六'][cursor.getDay()],
      free: allFree.slice(0, MAX_FREE_WINDOWS_PER_DAY),
      freeWindowCount: allFree.length,
      freeTruncated: allFree.length > MAX_FREE_WINDOWS_PER_DAY,
      hours,
      slots,
      freeMinutes: allFree.reduce((sum, item) => sum + item.duration, 0)
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return {
    participants,
    startDate,
    endDate,
    range: { start: formatTime(rangeStart), end: formatTime(rangeEnd) },
    days,
    availableDays: days.filter((day) => day.freeMinutes > 0).length
  }
}

module.exports = { groupFreeSlotsCore }
