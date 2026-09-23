const api = require('../../utils/api')
const { dictionaries } = require('../../utils/i18n')
const { selectImage, compressImageIfNeeded, uploadToCloud, isCloudAvailable } = require('../../utils/avatarUploader')
const { compressImage } = require('../../utils/imageCompress')

Page({
  data: {
    bannerVisible: false,
    bannerRequest: {},
    showAvatarPicker: false,
    compressCanvasWidth: 0,
    compressCanvasHeight: 0,
    user: null,
    friendCount: 0,
    activityCount: 0,
    lang: 'zh',
    t: {},
    darkMode: false,
    blacklistCount: 0,
    isGuest: false,
    // 新手引导
    introGuideVisible: false,
    introSteps: [],
    // 下拉拉伸封面
    coverBaseHeight: 0,
    coverHeight: 0,
    pullDistance: 0,
    heroPulling: false
  },

  onLoad() {
    this._initCoverDimensions()
  },

  _initCoverDimensions() {
    const sysInfo = wx.getSystemInfoSync()
    const rpxRatio = sysInfo.windowWidth / 750
    const baseH = Math.round(340 * rpxRatio)
    this.setData({ coverBaseHeight: baseH, coverHeight: baseH })
    this._rpxRatio = rpxRatio
    this._scrollTop = 0  // 初始化为 0，确保首次下拉可用
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const darkMode = app.getDarkMode ? app.getDarkMode() : false
    const isGuest = app.isLoggedIn ? !app.isLoggedIn() : false
    // 语言未变时跳过整个文案字典的大对象 setData，减少切 tab 时的序列化与 diff 开销
    if (this._lastLang !== lang) {
      const mergedT = Object.assign({}, dictionaries[lang])
      this.setData({ lang, t: mergedT, darkMode, isGuest })
      wx.setNavigationBarTitle({ title: mergedT.profileTitle || '我的' })
    } else {
      this.setData({ darkMode, isGuest })
    }
    this._lastLang = lang
    if (isGuest) return // 游客只看游客卡片 + 通用设置，不加载个人数据

    // 优先使用全局缓存数据（editProfile 返回时会更新全局 userInfo）
    // 避免不必要的远程 API 请求
    const globalUser = app.globalData && app.globalData.userInfo
    if (globalUser && this.data.user) {
      // 对比签名/头像等关键字段，如果全局缓存更新了，直接应用
      const needRefresh = globalUser.signature !== this.data.user.signature
        || globalUser.avatarUrl !== this.data.user.avatarUrl
        || globalUser.name !== this.data.user.name
        || globalUser.bio !== this.data.user.bio
      if (needRefresh) {
        this.setData({ user: Object.assign({}, globalUser) })
        return
      }
    }
    if (globalUser && !this.data.user) {
      this.setData({ user: Object.assign({}, globalUser) })
    }

    if (!this._lastLoadAt || Date.now() - this._lastLoadAt >= 30000) this.loadData()
    // 新手引导检查
    setTimeout(() => this.checkIntroGuide(), 800)
  },

  async loadData() {
    const shouldShowLoading = !this.data.user
    if (shouldShowLoading) wx.showLoading({ title: '加载中...' })
    try {
      const [userRes, friendshipsRes, registrationsRes] = await Promise.allSettled([
        api.me(),
        api.getFriendships(),
        api.getActivityRegistrations()
      ])
      if (userRes.status === 'rejected') throw userRes.reason
      const userValue = userRes.value
      // 云函数失败时 api 层回退 mock 数据并打 __cloudFailed 标记，
      // 这类结果不能覆盖已有的真实数据，否则云端抖动会导致界面内容跳变
      const userCloudFailed = Boolean(userValue && userValue.__cloudFailed)
      const friendshipsValue = friendshipsRes.status === 'fulfilled' ? friendshipsRes.value : null
      const registrationsValue = registrationsRes.status === 'fulfilled' ? registrationsRes.value : null
      const friendships = friendshipsValue && !friendshipsValue.__cloudFailed
        ? (Array.isArray(friendshipsValue) ? friendshipsValue : (friendshipsValue.friends || []))
        : null
      const registrations = registrationsValue && !registrationsValue.__cloudFailed ? registrationsValue : null
      this.setData({
        user: userCloudFailed ? this.data.user : userValue,
        friendCount: friendships ? friendships.length : this.data.friendCount,
        activityCount: registrations ? registrations.length : this.data.activityCount
      })
      this._lastLoadAt = Date.now()
    } catch (e) {
      console.error('[profile loadData error]', e)
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) wx.hideLoading()
    }
  },

  chooseAvatar() {
    this.setData({ showAvatarPicker: true })
  },

  /* ===== 下拉拉伸封面（微信朋友圈效果） ===== */
  onPageScroll(e) {
    this._scrollTop = e.scrollTop
  },

  onHeroTouchStart(e) {
    if (this._scrollTop > 2) return
    this._touchStartY = e.touches[0].clientY
    this._touchStartTime = Date.now()
    this._isAtTop = this._scrollTop <= 2
    // 移除 transition 以实时跟随手指
    this.setData({ heroPulling: true })
  },

  onHeroTouchMove(e) {
    if (!this._isAtTop || this._scrollTop > 2) return
    const deltaY = e.touches[0].clientY - this._touchStartY
    if (deltaY <= 0) return
    // 阻尼系数：下拉越多阻力越大，模拟橡皮筋效果
    const damping = Math.max(0.3, 1 - deltaY / 800)
    const pullDistance = Math.round(deltaY * damping)
    const maxPull = this.data.coverBaseHeight * 1.2
    const clamped = Math.min(pullDistance, maxPull)
    if (clamped === this._lastPullDistance) return
    this._lastPullDistance = clamped
    this.setData({
      pullDistance: clamped,
      coverHeight: this.data.coverBaseHeight + clamped
    })
  },

  onHeroTouchEnd() {
    if (!this._isAtTop) return
    this._isAtTop = false
    const currentPull = this.data.pullDistance
    // 下拉超过 40px 阈值则锁定拉伸，否则回弹
    const lockThreshold = 40
    if (currentPull >= lockThreshold) {
      this._lockedPull = currentPull
      this.setData({ heroPulling: false })
    } else {
      this._resetCover()
    }
  },

  /* 点击封面下方内容区域 → 收起拉伸 */
  onContentTap() {
    if (this.data.pullDistance > 0) {
      this._resetCover()
    }
  },

  _resetCover() {
    this._lastPullDistance = 0
    this._lockedPull = 0
    this.setData({
      pullDistance: 0,
      coverHeight: this.data.coverBaseHeight,
      heroPulling: false
    })
  },

  /* 点击背景封面：选择并上传新的背景图（独立于头像的 coverUrl） */
  async changeCover() {
    const app = getApp()
    if (app.requireLogin && !app.requireLogin()) return
    if (!isCloudAvailable()) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Cloud unavailable' : '云开发不可用，请检查云环境', icon: 'none' })
      return
    }
    // 兜底超时：任何一步 45 秒未返回都结束 loading，避免卡死在“上传中”
    const withTimeout = (promise, ms, msg) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
    ])
    try {
      const selected = await selectImage({ sourceType: ['album', 'camera'] })
      wx.showLoading({ title: this.data.lang === 'en' ? 'Uploading...' : '上传中...', mask: true })
      // 封面图需要撑满屏幕宽度 + 下拉拉伸余量，按屏幕物理像素压缩，避免高 DPI 设备模糊
      const sysInfo = wx.getSystemInfoSync()
      const pixelRatio = (wx.getDeviceInfo && wx.getDeviceInfo().pixelRatio) || sysInfo.pixelRatio || 2
      // 基准：屏幕物理宽度 × 1.5（含下拉拉伸 1.2× 余量），最低 2400px
      const coverTargetWidth = Math.max(2400, Math.ceil(sysInfo.windowWidth * pixelRatio * 1.5))
      const compressed = await withTimeout(
        compressImage(selected.tempFilePath, {
          maxWidth: coverTargetWidth,
          maxHeight: coverTargetWidth,
          quality: 0.92,
          context: this
        }),
        30000,
        this.data.lang === 'en' ? 'Compress timeout' : '图片处理超时，请重试'
      )
      const uploaded = await withTimeout(
        uploadToCloud(compressed.tempFilePath),
        30000,
        this.data.lang === 'en' ? 'Upload timeout' : '上传超时，请检查网络'
      )
      await withTimeout(
        app.updateUserInfo({ coverUrl: uploaded.fileID }),
        15000,
        this.data.lang === 'en' ? 'Save timeout' : '保存超时，请重试'
      )
      const user = Object.assign({}, this.data.user, { coverUrl: uploaded.fileID })
      this.setData({ user })
      wx.hideLoading()
      wx.showToast({ title: this.data.lang === 'en' ? 'Cover updated' : '背景已更新', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      const msg = (e && (e.errMsg || e.message)) || ''
      if (msg.includes('cancel')) return // 用户取消选图，不提示
      wx.showToast({ title: msg || (this.data.lang === 'en' ? 'Upload failed' : '上传失败'), icon: 'none' })
    }
  },

  onAvatarPickerClose() {
    this.setData({ showAvatarPicker: false })
  },

  onAvatarPreview(e) {
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return
    this.setData((prev) => ({
      user: prev.user ? { ...prev.user, avatarUrl: avatarUrl } : prev.user
    }))
  },

  onAvatarUpdated(e) {
    const newAvatarUrl = e.detail.avatarUrl
    if (!newAvatarUrl) return
    this.setData((prev) => ({
      showAvatarPicker: false,
      user: prev.user ? { ...prev.user, avatarUrl: newAvatarUrl } : prev.user
    }))
    console.log('[profile] 头像已更新')
    // 刷新用户数据
    if (!this._lastLoadAt || Date.now() - this._lastLoadAt >= 5000) this.loadData()
  },

  goEditProfile() { wx.navigateTo({ url: '/packages/account/pages/editProfile/editProfile' }) },
  goFriends() { wx.navigateTo({ url: '/packages/account/pages/friendList/friendList' }) },
  goActivities() { wx.navigateTo({ url: '/packages/account/pages/myActivities/myActivities' }) },

  copyId() {
    const id = this.data.user && this.data.user.id
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({ title: this.data.t.idCopied || 'ID 复制成功，可分享给认识的同学', icon: 'none', duration: 2000 })
      }
    })
  },

  goEditProfileFromList() { wx.navigateTo({ url: '/packages/account/pages/editProfile/editProfile' }) },
  goAccountInfo() { wx.navigateTo({ url: '/packages/account/pages/accountInfo/accountInfo' }) },

  toggleLang(e) {
    const newLang = e.detail.value ? 'en' : 'zh'
    if (newLang === this.data.lang) return
    const app = getApp()
    app.setLanguage(newLang)
    const mergedT = Object.assign({}, dictionaries[newLang])
    this.setData({ lang: newLang, t: mergedT })
    const tabbar = this.selectComponent('#app-tabbar')
    if (tabbar && typeof tabbar.refresh === 'function') tabbar.refresh()
    wx.setNavigationBarTitle({ title: mergedT.profileTitle || '我的' })
    wx.showToast({ title: newLang === 'zh' ? '已切换中文' : 'English enabled', icon: 'none' })
  },

  toggleDarkMode(e) {
    const newVal = e.detail.value
    this.setData({ darkMode: newVal })
    const app = getApp()
    app.setDarkMode(newVal)
    // 切换 page 的 dark-mode class（通过设置 data 属性）
    wx.showToast({
      title: newVal ? (this.data.t.darkMode || '已切换黑夜模式') : (this.data.t.lightMode || '已切换白天模式'),
      icon: 'none'
    })
  },

  goBlacklist() { wx.navigateTo({ url: '/packages/account/pages/blacklist/blacklist' }) },
  goMyReservations() { wx.navigateTo({ url: '/packages/activity/pages/myReservations/myReservations' }) },
  goUserAgreement() { wx.navigateTo({ url: '/packages/account/pages/userAgreement/userAgreement' }) },
  goThemeSettings() { wx.navigateTo({ url: '/packages/account/pages/theme/theme' }) },
  goPrivacyPolicy() { wx.navigateTo({ url: '/packages/account/pages/privacyPolicy/privacyPolicy' }) },
  goContactUs() { wx.navigateTo({ url: '/packages/account/pages/contactUs/contactUs' }) },
  goFeedback() {
    wx.navigateTo({ url: '/packages/account/pages/feedbackCenter/feedback' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/packages/account/pages/privacy/privacy' })
  },

  confirmLogout() {
    wx.showModal({
      title: this.data.t.confirmLogout || '确认退出登录？',
      content: this.data.t.confirmLogoutDesc || '退出后可切换登录账号',
      confirmText: this.data.t.confirm || '确认',
      cancelText: this.data.t.cancelLogout || '取消',
      success: (res) => {
        if (res.confirm) {
          api.logout()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  },

  // 游客点击"去登录"
  onGuestLogin() {
    getApp().requireLogin()
  },

  /** 重新查看新手引导：清除所有分页缓存并跳回日程页触发引导 */
  /* ===== 新手引导 ===== */
  buildIntroSteps(lang) {
    const isEn = lang === 'en'
    return [
      { selector: '.menu-item', text: isEn ? 'Tap to edit your profile' : '点击编辑个人信息' }
    ]
  },
  checkIntroGuide() {
    if (this.data.isGuest) return
    if (wx.getStorageSync('introGuideFinished') || wx.getStorageSync('introGuideProfileDone')) return
    if (this.data.introGuideVisible) return
    this.setData({ introGuideVisible: true, introSteps: this.buildIntroSteps(this.data.lang) })
  },
  onIntroComplete() { this.setData({ introGuideVisible: false, introSteps: [] }) },
  onIntroExit() { this.setData({ introGuideVisible: false, introSteps: [] }) },

  replayIntroGuide() {
    wx.removeStorageSync('introGuideScheduleDone')
    wx.removeStorageSync('introGuideActivitiesDone')
    wx.removeStorageSync('introGuideFriendsDone')
    wx.removeStorageSync('introGuideProfileDone')
    wx.removeStorageSync('introGuideFinished')
    wx.showToast({
      title: this.data.lang === 'en' ? 'Guide will replay' : '即将重新播放引导',
      icon: 'success',
      duration: 1200
    })
    setTimeout(() => {
      wx.switchTab({ url: '/pages/schedule/schedule' })
    }, 800)
  }
})
