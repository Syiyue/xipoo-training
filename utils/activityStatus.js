/**
 * 活动状态标签统一规范（模块 5）：
 * 报名中 open #07c160 / 已满员 full #e64340 / 即将开始 soon #ff9c00 / 已结束 ended #e04343。
 * 纯函数、不依赖 wx，方便单测；now 由调用方传入便于测试。
 */

const STATUS_DEFS = {
  open: { zh: '报名中', en: 'Open', color: '#07c160' },
  full: { zh: '已满员', en: 'Full', color: '#e64340' },
  soon: { zh: '即将开始', en: 'Starting soon', color: '#ff9c00' },
  ended: { zh: '已结束', en: 'Ended', color: '#e04343' }
}

const SOON_WINDOW_MS = 24 * 3600 * 1000

function parseTime(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/** 活动开始时间：兼容 startAt（ISO）与 date+start（HH:mm）两种数据形态 */
function activityStartTime(activity) {
  const iso = parseTime(activity && activity.startAt)
  if (iso) return iso
  if (activity && activity.date) {
    const start = parseTime(`${activity.date}T${activity.start || '00:00'}:00`)
    if (start) return start
  }
  return null
}

/** 活动结束时间：无结束时间时退化为开始时间（全天活动到当天 23:59 前不算结束由调用方数据决定） */
function activityEndTime(activity) {
  const iso = parseTime(activity && activity.endAt)
  if (iso) return iso
  if (activity && activity.date) {
    const end = parseTime(`${activity.date}T${activity.end || '23:59'}:59`)
    if (end) return end
  }
  return null
}

/**
 * 状态优先级：已结束 > 已满员 > 即将开始 > 报名中。
 * - 已结束：status 显式标记（ended/closed/offline）或结束时间已过
 * - 已满员：有容量且报名数达到容量
 * - 即将开始：距开始 24 小时内（未开始）
 * - 报名中：其余（含无时间信息的默认态）
 */
function computeActivityStatus(activity, now) {
  const at = now instanceof Date ? now : new Date()
  const explicit = String((activity && activity.status) || '').toLowerCase()
  if (['ended', 'closed', 'offline', 'finished'].includes(explicit)) return 'ended'

  const end = activityEndTime(activity || {})
  if (end && at.getTime() > end.getTime()) return 'ended'

  const capacity = Number(activity && activity.capacity)
  const registered = Number((activity && (activity.registrationCount ?? activity.registeredCount)) || 0)
  if (capacity > 0 && registered >= capacity) return 'full'

  const start = activityStartTime(activity || {})
  if (start) {
    const diff = start.getTime() - at.getTime()
    if (diff > 0 && diff <= SOON_WINDOW_MS) return 'soon'
  }
  return 'open'
}

/** 给活动对象附加 statusKey / statusText（双语） */
function withActivityStatus(activity, lang, now) {
  const key = computeActivityStatus(activity, now)
  const def = STATUS_DEFS[key]
  return Object.assign({}, activity, {
    statusKey: key,
    statusText: lang === 'en' ? def.en : def.zh,
    statusColor: def.color
  })
}

module.exports = {
  STATUS_DEFS,
  SOON_WINDOW_MS,
  computeActivityStatus,
  withActivityStatus
}
