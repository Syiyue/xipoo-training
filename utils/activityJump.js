/**
 * 第三方小程序跳转（模块 2）：后台可配置小程序短链接，或 AppID/页面路径/活动参数，
 * 小程序端点击活动卡片时先上报点击，再 wx.navigateToMiniProgram 跳转。
 * 纯函数、不依赖 wx，方便单测。
 */

const JUMP_TYPES = ['registrationTool', 'quickReservation', 'otherMiniProgram']

// 自研预约（模块 3）：站内预约页，不属于第三方跳转，不进 JUMP_TYPES
function isNativeReservation(activity) {
  return Boolean(activity) && activity.jumpType === 'nativeReservation'
}

/** 是否为配置了第三方跳转的活动 */
function isJumpActivity(activity) {
  if (!activity) return false
  if (!JUMP_TYPES.includes(activity.jumpType)) return false
  if (String(activity.targetShortLink || '').trim()) return true
  return Boolean(String(activity.targetAppId || '').trim())
    && Boolean(String(activity.targetPath || '').trim())
}

/**
 * 组装 wx.navigateToMiniProgram 参数。
 * activityParams 支持两种写法：
 *   1. JSON 对象字符串（如 {"activityId":"123"}）→ 作为 extraData 透传
 *   2. query 字符串（如 activityId=123&source=xipoo）→ 拼到 path 查询串上
 */
function buildJumpTarget(activity) {
  if (!isJumpActivity(activity)) return null
  const shortLink = String(activity.targetShortLink || '').trim()
  if (shortLink) return { shortLink }
  const appId = String(activity.targetAppId).trim()
  let path = String(activity.targetPath).trim()
  let extraData
  const raw = String(activity.activityParams || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extraData = parsed
    } catch (e) {
      /* 非 JSON 则按 query 串处理 */
    }
    if (!extraData) {
      if (raw.includes('=')) {
        path += (path.includes('?') ? '&' : '?') + raw.replace(/^\?/, '')
      }
    }
  }
  return { appId, path, extraData }
}

module.exports = {
  JUMP_TYPES,
  isJumpActivity,
  isNativeReservation,
  buildJumpTarget
}
