// 小程序云函数与数据库在 cloudbase-d7…；OCR 云托管在独立 prod 环境。
// 云函数通过 CONTAINER_BASE 访问 prod 的 flask-tbst，不要把 wx.cloud 强切到
// prod-d3…：该环境当前没有可用的云函数元数据，调用 schedule 会失败。
const CLOUD_ENV_ID = 'cloudbase-d9g6yi49t3d0db634'

/**
 * 检查云开发环境是否可用
 * 同时验证环境ID不为空且 wx.cloud 已初始化
 */
function hasCloudEnv() {
  if (!CLOUD_ENV_ID || !String(CLOUD_ENV_ID).trim()) return false
  try {
    return !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function')
  } catch (_) {
    return false
  }
}

/**
 * 获取云开发初始化状态（用于诊断）
 */
function getCloudStatus() {
  const envId = String(CLOUD_ENV_ID || '').trim()
  return {
    envId: envId || '(未配置)',
    hasGlobalWx: typeof wx !== 'undefined',
    hasCloudObj: !!(wx && wx.cloud),
    hasCallFunction: !!(wx && wx.cloud && typeof wx.cloud.callFunction === 'function'),
    ready: hasCloudEnv()
  }
}

module.exports = {
  CLOUD_ENV_ID,
  hasCloudEnv,
  getCloudStatus
}
