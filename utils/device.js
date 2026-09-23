// 设备能力集中读取：微信在不同系统/版本提供的窗口信息 API 并不完全一致。
// 不根据具体品牌写分支，优先使用新 API，再安全回退到旧 API，供鸿蒙等设备共用。
function getWindowInfo() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo() || {}
  } catch (_) {}
  try {
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync() || {}
  } catch (_) {}
  return {}
}

function getDeviceProfile() {
  let deviceInfo = {}
  try {
    if (wx.getDeviceInfo) deviceInfo = wx.getDeviceInfo() || {}
  } catch (_) {}
  const windowInfo = getWindowInfo()
  const platformText = [deviceInfo.platform, deviceInfo.system, windowInfo.platform, windowInfo.system]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return {
    platform: platformText,
    isHarmony: /harmony|hmos|ohos/.test(platformText),
    windowInfo
  }
}

module.exports = {
  getWindowInfo,
  getDeviceProfile
}
