/**
 * 空闲时间位图工具
 * 与 cloudfunctions/match/matchLib.js 中的实现保持一致（云函数不可跨目录引用，需各自内联）。
 * 修改算法时请同步两边。
 */

const SLOTS_PER_DAY = 22  // 9:00-20:00, 30min 粒度
const TOTAL_SLOTS = 154   // 22 × 7
const DAY_START_MINUTES = 9 * 60  // 540

/**
 * 将 time "HH:mm" 转为当日 slot 索引 (0-21)
 * 9:00 → 0, 9:30 → 1, ..., 19:30 → 21
 */
function timeToSlot(time) {
  const [h, m] = String(time || '9:00').split(':').map(Number)
  return Math.floor((h * 60 + m - DAY_START_MINUTES) / 30)
}

/**
 * 根据课表计算 154 位空闲位图
 * courses: [{ weekday, start, end }]
 * weekday: 1=Mon ... 7=Sun
 */
function calculateFreeTimeBitmap(courses) {
  // 初始全 1（全部空闲）
  const bits = new Array(TOTAL_SLOTS).fill(1)
  const activeCourses = (courses || []).filter(
    (c) => c.weekday && c.start && c.end && c.confirmed !== false
  )
  activeCourses.forEach((c) => {
    const day = Number(c.weekday)  // 1-7
    if (day < 1 || day > 7) return
    const startSlot = timeToSlot(c.start)
    const endSlot = timeToSlot(c.end)
    const dayOffset = (day - 1) * SLOTS_PER_DAY
    for (let s = startSlot; s < endSlot && s < SLOTS_PER_DAY; s++) {
      if (s >= 0) bits[dayOffset + s] = 0
    }
  })
  return bits.join('')
}

module.exports = { calculateFreeTimeBitmap }
