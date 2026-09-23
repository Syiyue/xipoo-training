/**
 * scheduleCache.js — 日程数据持久化缓存（本地 Storage）
 *
 * 目的：冷启动时全局内存缓存为空、后台预拉取未命中，导致真机进入日程页
 * 需要串行等待 me/getSchedule/getActivitySchedule 三个云函数冷启动，出现短暂空白。
 * 本模块把最近一次成功拉取的课表落盘到本地 Storage，做到「先渲染缓存，再后台静默更新」。
 *
 * 结构：{ courses, activitySchedule, savedAt }
 */

// v2：旧缓存可能由“主课程周次汇总”逻辑生成，不能继续用于周视图。
const CACHE_KEY = 'xipoo_schedule_cache_v2'

function readCachedSchedules(ownerId) {
  try {
    const raw = wx.getStorageSync(CACHE_KEY)
    // 缓存必须绑定用户；旧版没有 ownerId 的缓存直接失效，避免串用户。
    if (raw && Array.isArray(raw.courses) && ownerId && String(raw.ownerId || '') === String(ownerId)) {
      return {
        courses: raw.courses,
        activitySchedule: Array.isArray(raw.activitySchedule) ? raw.activitySchedule : [],
        savedAt: raw.savedAt || 0
      }
    }
    return null
  } catch (error) {
    return null
  }
}

function writeCachedSchedules(courses, activitySchedule, ownerId) {
  try {
    if (!ownerId) return
    wx.setStorageSync(CACHE_KEY, {
      ownerId: String(ownerId),
      courses: Array.isArray(courses) ? courses : [],
      activitySchedule: Array.isArray(activitySchedule) ? activitySchedule : [],
      savedAt: Date.now()
    })
  } catch (error) {
    // 存储失败（极小概率容量限制）不影响主流程
  }
}

/**
 * 生成数据快照，用于判断「云端数据是否发生变化」。
 * 只取课程的可感知字段 + 数量，避免 _id/_openid/createdAt 等不稳定字段造成误判重渲染。
 */
function scheduleSnapshot(courses, activitySchedule) {
  const courseKey = (c) => [
    c.id, c.title, c.courseCode, c.start, c.end, c.weekday,
    c.weekStart, c.weekEnd, c.weekType, c.place, c.teacher,
    c.excludedFromFreeTime ? 1 : 0
  ].join('|')
  const activityKey = (a) => [
    a.id, a.title, a.start, a.end, a.weekday, a.place
  ].join('|')
  return (courses || []).map(courseKey).join('\n')
    + '###'
    + (activitySchedule || []).map(activityKey).join('\n')
}

module.exports = {
  readCachedSchedules,
  writeCachedSchedules,
  scheduleSnapshot
}
