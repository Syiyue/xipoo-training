/**
 * 噗噗助手开关：持久化在 storage，组件与个人页设置共用。
 * 默认开启；存 0 表示关闭。
 */

const ENABLED_KEY = 'xipoo_companion_enabled'

function isCompanionEnabled() {
  try {
    const value = wx.getStorageSync(ENABLED_KEY)
    if (value === '' || value === undefined || value === null) return true
    return Boolean(value)
  } catch (error) {
    return true
  }
}

function setCompanionEnabled(enabled) {
  try {
    wx.setStorageSync(ENABLED_KEY, enabled ? 1 : 0)
  } catch (error) {
    // 存储失败时仅本次生效
  }
}

module.exports = {
  ENABLED_KEY,
  isCompanionEnabled,
  setCompanionEnabled
}
