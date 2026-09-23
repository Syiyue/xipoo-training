/**
 * 匹配算法（端口自前端 utils/mockBackend.js，保持行为一致）。
 * 纯函数，不依赖数据库，方便单测。
 * 输入的 schedulesByUser 形如 { [userId]: [course...] }。
 */

function minutes(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return hour * 60 + minute
}

function formatTime(total) {
  const hour = Math.floor(total / 60)
  const minute = total % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function freeSlots(courses) {
  const dayStart = 8 * 60
  const dayEnd = 22 * 60
  const busy = courses
    .map((item) => ({ start: minutes(item.start), end: minutes(item.end) }))
    .sort((a, b) => a.start - b.start)

  const slots = []
  let cursor = dayStart
  busy.forEach((item) => {
    if (item.start - cursor >= 45) slots.push({ start: cursor, end: item.start })
    cursor = Math.max(cursor, item.end)
  })
  if (dayEnd - cursor >= 45) slots.push({ start: cursor, end: dayEnd })
  return slots
}

function overlapSlots(aCourses, bCourses) {
  const aSlots = freeSlots(aCourses)
  const bSlots = freeSlots(bCourses)
  const result = []
  aSlots.forEach((a) => {
    bSlots.forEach((b) => {
      const start = Math.max(a.start, b.start)
      const end = Math.min(a.end, b.end)
      if (end - start >= 45) {
        result.push({ start: formatTime(start), end: formatTime(end), duration: end - start })
      }
    })
  })
  return result
}

function recommendation(slot) {
  if (!slot) return 'No shared block was found in this range. Try a wider time window.'
  const start = minutes(slot.start)
  if (start < 12 * 60) return 'Good for review, lab prep, or a quick campus coffee chat.'
  if (start < 18 * 60) return 'Good for project discussion, salon attendance, or group work.'
  return 'Good for sports, dinner, or a relaxed social activity together.'
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

function mergeBusyIntervals(courses, rangeStart, rangeEnd) {
  const intervals = courses
    .map((course) => ({
      start: Math.max(rangeStart, minutes(course.start)),
      end: Math.min(rangeEnd, minutes(course.end))
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  return intervals.reduce((result, interval) => {
    const previous = result[result.length - 1]
    if (!previous || interval.start > previous.end) result.push(interval)
    else previous.end = Math.max(previous.end, interval.end)
    return result
  }, [])
}

// 单日两人匹配（端口自 matchWithFriend 的核心，课表由调用方传入）
function matchWithFriendCore(mine, theirs, date, range = {}) {
  let slots = overlapSlots(mine, theirs)
  if (range.start && range.end) {
    const rangeStart = minutes(range.start)
    const rangeEnd = minutes(range.end)
    slots = slots
      .map((slot) => {
        const start = Math.max(minutes(slot.start), rangeStart)
        const end = Math.min(minutes(slot.end), rangeEnd)
        return { start: formatTime(start), end: formatTime(end), duration: end - start }
      })
      .filter((slot) => slot.duration >= 15)
  }
  return { date, range, slots, recommendation: recommendation(slots[0]), myCourses: mine, friendCourses: theirs }
}

/**
 * 多人分组空闲匹配（端口自 groupFreeSlots）。
 * participants: [{id, name, avatar}]（含调用者）
 * schedulesByUser: { [userId]: [course...] }
 * 返回与 mock 相同结构；参与者两两互为好友/共享由云函数侧校验，这里只算时间。
 */
function groupFreeSlotsCore(participants, schedulesByUser, startDate, endDate, range = {}) {
  if (!startDate || !endDate || startDate > endDate) throw new Error('请选择正确的日期范围')
  const rangeStart = minutes(range.start || '08:00')
  const rangeEnd = minutes(range.end || '22:00')
  if (rangeEnd <= rangeStart) throw new Error('结束时间必须晚于开始时间')

  const participantIds = participants.map((p) => p.id)
  const days = []
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if ((end - cursor) / 86400000 > 92) throw new Error('日期范围最多为 93 天')

  while (cursor <= end) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const conflicts = participantIds.flatMap((id) => {
      const participant = participants.find((item) => item.id === id)
      return (schedulesByUser[id] || [])
        // 参与者标记为「不去上」的课程不计入忙碌
        .filter((course) => !course.excludedFromFreeTime)
        .filter((course) => courseOccursOn(course, date))
        .filter((course) => minutes(course.end) > rangeStart && minutes(course.start) < rangeEnd)
        .map((course) => ({
          id: `${id}-${course.id}-${date}`,
          userId: id,
          userName: participant.name,
          avatar: participant.avatar,
          courseId: course.id,
          title: course.title,
          start: course.start,
          end: course.end,
          place: course.place || ''
        }))
    })
    const busy = mergeBusyIntervals(conflicts, rangeStart, rangeEnd)
    const free = []
    let pointer = rangeStart
    busy.forEach((interval) => {
      if (interval.start - pointer >= 30) {
        free.push({ start: formatTime(pointer), end: formatTime(interval.start), duration: interval.start - pointer })
      }
      pointer = Math.max(pointer, interval.end)
    })
    if (rangeEnd - pointer >= 30) {
      free.push({ start: formatTime(pointer), end: formatTime(rangeEnd), duration: rangeEnd - pointer })
    }
    const hours = []
    for (let hour = Math.ceil(rangeStart / 60); hour < Math.floor(rangeEnd / 60); hour += 1) {
      const start = hour * 60
      const endMinute = start + 60
      const busyUsers = participantIds.filter((id) => conflicts.some((conflict) => (
        conflict.userId === id && minutes(conflict.end) > start && minutes(conflict.start) < endMinute
      )))
      const state = busyUsers.length === 0
        ? 'available'
        : (busyUsers.length === participantIds.length ? 'busy' : 'partial')
      hours.push({
        label: `${String(hour).padStart(2, '0')}:00`,
        start: formatTime(start),
        end: formatTime(endMinute),
        state,
        busyCount: busyUsers.length,
        conflicts: conflicts.filter((conflict) => minutes(conflict.end) > start && minutes(conflict.start) < endMinute)
      })
    }
    days.push({
      date,
      weekday: ['日', '一', '二', '三', '四', '五', '六'][cursor.getDay()],
      free,
      hours,
      conflicts,
      freeMinutes: free.reduce((sum, slot) => sum + slot.duration, 0)
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return {
    participants,
    startDate,
    endDate,
    range: { start: formatTime(rangeStart), end: formatTime(rangeEnd) },
    days,
    availableDays: days.filter((day) => day.free.length).length
  }
}

module.exports = {
  minutes,
  formatTime,
  freeSlots,
  overlapSlots,
  recommendation,
  courseOccursOn,
  mergeBusyIntervals,
  matchWithFriendCore,
  groupFreeSlotsCore
}
