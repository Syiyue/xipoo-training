const api = require('./api')

const store = {
  _app: null,

  init(app) {
    this._app = app
  },

  get globalData() {
    return this._app ? this._app.globalData : getApp().globalData
  },

  async fetchAndSetUserInfo() {
    try {
      const userInfo = await api.me()
      this.globalData.userInfo = userInfo
      wx.setStorageSync('xipoo_user_info', userInfo)
      return userInfo
    } catch (e) {
      console.warn('[store] fetchAndSetUserInfo failed:', e.message)
      const cached = wx.getStorageSync('xipoo_user_info')
      if (cached) this.globalData.userInfo = cached
      return this.globalData.userInfo
    }
  },

  getUserInfo() {
    if (this.globalData.userInfo) return this.globalData.userInfo
    const cached = wx.getStorageSync('xipoo_user_info')
    if (cached) { this.globalData.userInfo = cached; return cached }
    return null
  },

  async updateUserInfo(fieldOrData, value) {
    const data = typeof fieldOrData === 'string' ? { [fieldOrData]: value } : fieldOrData
    try {
      const updated = await api.updateProfile(data)
      this.globalData.userInfo = updated
      wx.setStorageSync('xipoo_user_info', updated)
      return updated
    } catch (e) {
      console.error('[store] updateUserInfo failed:', e.message)
      throw e
    }
  },

  async checkPendingRequests() {
    try {
      const requests = await api.getRequests()
      const count = (requests && requests.length) || 0
      const prevCount = this.globalData.pendingRequestCount || 0
      this.globalData.pendingRequestCount = count

      if (count > 0) {
        wx.setTabBarBadge({ index: 1, text: String(count) }).catch(() => {})
      } else {
        wx.removeTabBarBadge({ index: 1 }).catch(() => {})
      }

      if (count > prevCount && requests.length > 0) {
        const latest = requests.reduce((a, b) => {
          const aTime = a.createdAt || a.createTime || ''
          const bTime = b.createdAt || b.createTime || ''
          return bTime > aTime ? b : a
        })
        if (latest && latest.id !== this.globalData.lastNotifiedRequestId) {
          this.globalData.lastNotifiedRequestId = latest.id
          this.globalData.latestRequest = latest
          this.globalData.isBannerVisible = true
          // 广播到所有活跃页面
          const pages = getCurrentPages()
          const request = latest
          pages.forEach(page => {
            try { page.setData({ bannerVisible: true, bannerRequest: request }) } catch (_) {}
          })
        }
      }

      return count
    } catch (e) {
      console.warn('[store] checkPendingRequests failed:', e.message)
    }
  }
}

module.exports = store