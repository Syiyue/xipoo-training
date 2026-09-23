const { CLOUD_ENV_ID, hasCloudEnv } = require('./utils/cloudConfig')
const { dictionaries } = require('./utils/i18n')
const store = require('./utils/store')
const theme = require('./utils/theme')
const { getDeviceProfile } = require('./utils/device')

function getSafeThemePrimary(app) {
  const currentTheme = app && app.getTheme ? app.getTheme() : null
  return currentTheme && typeof currentTheme.color === 'string' && /^#[0-9a-f]{6}$/i.test(currentTheme.color)
    ? currentTheme.color
    : theme.DEFAULT_COLOR
}

// ===================== 全局 Page 拦截器 =====================
// 让所有页面自动感知 darkMode / 主题色，无需在每个页面 onShow 中手动同步
const OriginalPage = Page
Page = function(config) {
  const originalOnShow = config.onShow || function() {}
  const originalOnLoad = config.onLoad || function() {}

  config.onLoad = function(options) {
    const app = getApp()
    const darkMode = app.getDarkMode ? app.getDarkMode() : false
    const patch = {}
    if (this.data && this.data.darkMode !== darkMode) patch.darkMode = darkMode
    const themeVars = app.getThemeVars ? app.getThemeVars() : ''
    if (this.data && this.data.themeVars !== themeVars) patch.themeVars = themeVars
    const themePrimary = getSafeThemePrimary(app)
    if (this.data && this.data.themePrimary !== themePrimary) patch.themePrimary = themePrimary
    if (Object.keys(patch).length) this.setData(patch)
    return originalOnLoad.call(this, options)
  }

  config.onShow = function() {
    const app = getApp()
    const darkMode = app.getDarkMode ? app.getDarkMode() : false
    // 仅在值真正变化时才 setData，避免无意义的渲染
    if (this.data && this.data.darkMode !== darkMode) {
      const prevDark = this.__lastKnownDarkMode
      if (prevDark !== darkMode) {
        this.__lastKnownDarkMode = darkMode
        this.setData({ darkMode })
      }
    }
    const themeVars = app.getThemeVars ? app.getThemeVars() : ''
    const themePrimary = getSafeThemePrimary(app)
    const patchShow = {}
    if (this.data && this.data.themeVars !== themeVars) patchShow.themeVars = themeVars
    if (this.data && this.data.themePrimary !== themePrimary) patchShow.themePrimary = themePrimary
    if (Object.keys(patchShow).length) this.setData(patchShow)
    return originalOnShow.call(this)
  }

  return OriginalPage(config)
}
// =========================================================

App({
  onLaunch() {
    store.init(this)
    this.initCloud()
    this.initBackgroundPrefetch()
    this.globalData.device = getDeviceProfile()
    
    const session = wx.getStorageSync('xipoo_session')
    this.globalData.session = session || null
    this.globalData.language = wx.getStorageSync('xipoo_language') || 'zh'
    this.globalData.darkMode = wx.getStorageSync('xipoo_dark_mode') || false
    this.globalData.userInfo = wx.getStorageSync('xipoo_user_info') || null
    this.globalData.theme = theme.getTheme()
    this.globalData.dataCache = {
      me: null,
      friendships: null,
      schedules: null,
      activities: null
    }
    this.applyDarkMode(this.globalData.darkMode)

    // 新用户首次从默认首页进入时展示登录页，但不自动申请手机号、头像或昵称。
    // 登录页保留“先逛逛”，分享卡片和扫码进入具体页面时也不打断浏览。
    const hasVisited = wx.getStorageSync('xipoo_visited')
    if (!hasVisited && !this.isLoggedIn()) {
      wx.setStorageSync('xipoo_visited', true)
      const launchOptions = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {}
      const entryPath = (launchOptions && launchOptions.path) || 'pages/schedule/schedule'
      if (entryPath === 'pages/schedule/schedule') {
        wx.reLaunch({ url: '/pages/login/login' })
      }
    }

    // 等宽字体已移除：jsdelivr 国内加载慢且需配置合法域名，日期数字改用系统字体

    // 全局轮询：每 30 秒检查好友申请（降低频率 + 仅页面可见时）
    this.startGlobalPolling()

    // 监听前后台切换：后台暂停轮询，前台恢复
    wx.onAppHide(() => {
      this.stopGlobalPolling()
      this._backgroundedAt = Date.now()
    })
    wx.onAppShow(() => {
      // 从后台回来才恢复，冷启动由 onLaunch 处理
      if (this._backgroundedAt) {
        this.startGlobalPolling()
        this._backgroundedAt = null
      }
    })
  },

  startGlobalPolling() {
    this.stopGlobalPolling()
    this._pollTimer = setInterval(() => {
      if (!this.isLoggedIn()) return // 未登录时无好友申请可查，跳过轮询
      store.checkPendingRequests()
    }, 30000)
  },

  stopGlobalPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  /** 获取全局缓存数据，避免重复 API 调用 */
  getCached(key) {
    const cache = this.globalData.dataCache || {}
    return cache[key] || null
  },

  setCached(key, value) {
    if (!this.globalData.dataCache) this.globalData.dataCache = {}
    this.globalData.dataCache[key] = value
  },

  /**
   * 数据预拉取：在 mp 后台配置「云开发 → prefetch 云函数」后，微信客户端会在
   * 冷启动加载代码包的同时后台调用 prefetch，这里只负责把结果存成 Promise。
   * 命中时首屏页面可跳过 listSchedules / me 等云函数调用，直接渲染。
   */
  initBackgroundPrefetch() {
    this._prefetchPromise = null
    if (typeof wx.getBackgroundFetchData !== 'function') return
    this._prefetchPromise = new Promise((resolve) => {
      wx.getBackgroundFetchData({
        fetchType: 'pre',
        success: (res) => {
          try {
            const payload = JSON.parse(res.fetchedData || '{}')
            resolve(payload && payload.ok ? payload.data : null)
          } catch (e) {
            console.warn('[Xipoo prefetch] parse failed', e)
            resolve(null)
          }
        },
        fail: (err) => {
          console.warn('[Xipoo prefetch] unavailable', err && err.errMsg)
          resolve(null)
        }
      })
    })
  },

  /**
   * 供首屏页面消费预拉取数据。预拉取只是加速通道，不保证到达，
   * 因此带超时兜底：超时/未命中都返回 null，调用方走正常云函数请求。
   */
  getPrefetchData(timeoutMs = 4000) {
    if (!this._prefetchPromise) return Promise.resolve(null)
    return Promise.race([
      this._prefetchPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ])
  },

  async fetchAndSetUserInfo() {
    return store.fetchAndSetUserInfo()
  },

  getUserInfo() {
    return store.getUserInfo()
  },

  async updateUserInfo(fieldOrData, value) {
    return store.updateUserInfo(fieldOrData, value)
  },

  async initCloud() {
    if (!wx.cloud || !hasCloudEnv()) {
      console.warn('[Xipoo cloud] cloud not available or no env config')
      this.globalData.cloudReady = false
      return
    }

    try {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      })
      console.log('[Xipoo cloud env]', CLOUD_ENV_ID)

      // wx.cloud.init 已完成客户端初始化。启动阶段不额外调用 ping，避免它与
      // 用户的首次登录、日程加载一起触发云函数冷启动而形成请求峰值。
      // 后续业务调用本身已有超时与降级处理，会自然反映真实可用性。
      this.globalData.cloudReady = true
      console.log('[Xipoo cloud] client initialized')
    } catch (e) {
      console.error('[Xipoo cloud init error]', e)
      this.globalData.cloudReady = false
      this.globalData.cloudError = e
      
      if (e.errMsg && e.errMsg.includes('webapi_getwxaasyncsecinfo')) {
        console.warn('[Xipoo cloud] Possible guest mode detected, please login in developer tools')
      }
    }
  },

  async checkCloudEnvironment() {
    return new Promise((resolve) => {
      let settled = false
      let timeout = null

      const finish = (ready) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        resolve(ready)
      }

      timeout = setTimeout(() => {
        console.warn('[Xipoo cloud] environment check timed out after 3000ms')
        finish(false)
      }, 3000)

      try {
        wx.cloud.callFunction({
          name: 'user',
          data: { action: 'ping' },
          success: (res) => {
            const ready = Boolean(res && res.result && res.result.ok)
            if (ready) {
              console.log('[Xipoo cloud] environment check success:', res)
            } else {
              console.warn('[Xipoo cloud] environment check returned an invalid response:', res)
            }
            finish(ready)
          },
          fail: (err) => {
            console.warn('[Xipoo cloud] environment check failed:', err)
            finish(false)
          }
        })
      } catch (err) {
        console.warn('[Xipoo cloud] environment check could not start:', err)
        finish(false)
      }
    })
  },

  isCloudReady() {
    return this.globalData.cloudReady === true
  },

  getCloudError() {
    return this.globalData.cloudError
  },

  isLoggedIn() {
    const session = wx.getStorageSync('xipoo_session')
    return !!(session && session.userId)
  },

  requireLogin() {
    const session = wx.getStorageSync('xipoo_session')
    if (!session || !session.userId) {
      // 登录页不在 tabBar 中，navigateTo 让用户可返回继续浏览（审核要求登录页可退出）
      wx.navigateTo({ url: '/pages/login/login' })
      return false
    }
    this.globalData.session = session
    return true
  },

  setLanguage(language) {
    this.globalData.language = language
    wx.setStorageSync('xipoo_language', language)
  },

  getLanguage() {
    return this.globalData.language || wx.getStorageSync('xipoo_language') || 'zh'
  },

  setDarkMode(enabled) {
    this.globalData.darkMode = enabled
    wx.setStorageSync('xipoo_dark_mode', enabled)
    this.applyDarkMode(enabled)
    // 触发所有页面的 darkMode 同步（通过全局广播）
    this._notifyPages()
  },

  getDarkMode() {
    return this.globalData.darkMode || wx.getStorageSync('xipoo_dark_mode') || false
  },

  /* ---------- 主题色 ---------- */

  getTheme() {
    return this.globalData.theme || theme.getTheme()
  },

  /** 当前主题 + 明暗模式对应的 CSS 变量串（注入页面根节点 style） */
  getThemeVars() {
    const t = this.getTheme()
    return theme.buildThemeVars(t.color, this.getDarkMode())
  },

  setTheme(color, type) {
    this.globalData.theme = theme.setTheme(color, type)
    this.applyDarkMode(this.getDarkMode()) // 原生 tabBar 选中色跟随主题
    this._notifyPages()
  },

  resetTheme() {
    this.globalData.theme = theme.setTheme(theme.DEFAULT_COLOR, 'preset')
    this.applyDarkMode(this.getDarkMode())
    this._notifyPages()
  },

  _notifyPages() {
    // 获取当前所有页面并同步 darkMode / themeVars
    const pages = getCurrentPages()
    const darkMode = this.globalData.darkMode
    const themeVars = this.getThemeVars()
    const themePrimary = getSafeThemePrimary(this)
    pages.forEach(page => {
      if (page && page.data) {
        const patch = {}
        if (page.data.darkMode !== darkMode) patch.darkMode = darkMode
        if (page.data.themeVars !== themeVars) patch.themeVars = themeVars
        if (page.data.themePrimary !== themePrimary) patch.themePrimary = themePrimary
        if (Object.keys(patch).length) page.setData(patch)
      }
    })
  },

  applyDarkMode(enabled) {
    const brand = theme.buildPalette(this.getTheme().color).primary
    if (enabled) {
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: '#1a1a2e'
      })
      wx.setTabBarStyle({
        backgroundColor: '#1a1a2e',
        borderStyle: 'black',
        color: '#888',
        selectedColor: brand
      })
    } else {
      wx.setNavigationBarColor({
        frontColor: '#000000',
        backgroundColor: '#ffffff'
      })
      wx.setTabBarStyle({
        backgroundColor: '#ffffff',
        borderStyle: 'black',
        color: '#888',
        selectedColor: brand
      })
    }
  },

  globalData: {
    session: null,
    language: 'zh',
    darkMode: false,
    theme: null,
    cloudReady: false,
    cloudError: null,
    userInfo: null,
    pendingRequestCount: 0,
    lastNotifiedRequestId: '',
    isBannerVisible: false
  }
})
