const api = require('../../../../utils/api')
const { resolveCloudImage } = require('../../../../utils/cloudImage')

function decorateActivity(item, lang, subscriptions = []) {
  if (!item) return null
  const publisher = subscriptions.find((entry) => entry.key === item.publisherKey)
  const subscribed = publisher ? publisher.subscribed : Boolean(item.subscribed)
  const isEn = lang === 'en'
  const displayTitle = isEn
    ? (item.titleEn || item.title || item.titleZh || '')
    : (item.titleZh || item.titleEn || item.title || '')
  const scheduleFallback = [item.date, item.start && item.end ? `${item.start}-${item.end}` : item.start, displayTitle]
    .filter(Boolean)
    .join(' ')

  return Object.assign({}, item, {
    displayType: isEn
      ? (item.typeEn || item.typeZh || item.type || '')
      : (item.typeZh || item.typeEn || item.type || ''),
    displayTitle,
    displayDesc: isEn
      ? (item.descEn || item.desc || item.descZh || '')
      : (item.descZh || item.descEn || item.desc || ''),
    displayPlace: isEn
      ? (item.placeEn || item.place || item.placeZh || '')
      : (item.placeZh || item.placeEn || item.place || ''),
    displayHost: isEn
      ? (item.hostEn || item.host || item.hostZh || '')
      : (item.hostZh || item.hostEn || item.host || ''),
    displayTags: isEn
      ? (item.tagsEn || item.tags || item.tagsZh || [])
      : (item.tagsZh || item.tagsEn || item.tags || []),
    displayScheduleTag: isEn
      ? (item.scheduleTagEn || scheduleFallback || '')
      : (item.scheduleTag || scheduleFallback || ''),
    coverUrl: item.coverUrl || '',
    publisherName: publisher
      ? (isEn
        ? (publisher.nameEn || publisher.name || publisher.nameZh || '')
        : (publisher.nameZh || publisher.nameEn || publisher.name || ''))
      : (item.publisherKey || ''),
    publisherInitial: (publisher.nameZh || publisher.name || item.publisherKey || '活').slice(0, 1),
    publisherAccent: publisher.accent || '#65e882',
    publisherLogoUrl: publisher.logoUrl || '',
    subscribed,
    subscriptionActionText: subscribed
      ? (lang === 'en' ? 'Subscribed' : '已订阅')
      : (lang === 'en' ? 'Subscribe' : '订阅'),
    registrationActionText: item.registered
      ? (lang === 'en' ? 'Cancel registration' : '取消报名')
      : (lang === 'en' ? 'Register now' : '立即报名'),
    saveActionText: item.saved
      ? (lang === 'en' ? 'Saved' : '已收藏')
      : (lang === 'en' ? 'Save activity' : '收藏活动'),
    time: item.time || [item.date, item.start && item.end ? `${item.start}-${item.end}` : item.start].filter(Boolean).join(' ')
  })
}

Page({
  data: {
    id: '',
    lang: 'zh',
    isGuest: false,
    activity: null,
    subscriptions: [],
    sharePreviewOpen: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const isGuest = app.isLoggedIn ? !app.isLoggedIn() : false
    this.setData({ lang, isGuest })
    wx.setNavigationBarTitle({
      title: lang === 'en' ? 'Activity Details' : '活动详情'
    })
    this.loadPageData()
  },

  requireAccount() {
    const app = getApp()
    return app.requireLogin ? app.requireLogin() : true
  },

  async loadPageData() {
    try {
      const [activity, subscriptions] = await Promise.all([
        api.getActivity(this.data.id),
        api.getActivitySubscriptions()
      ])
      const withCover = await resolveCloudImage(activity, 'coverUrl')
      this.setData({
        subscriptions,
        activity: decorateActivity(withCover, this.data.lang, subscriptions)
      })
    } catch (error) {
      this.setData({ subscriptions: [], activity: null })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Activity failed to load' : '活动加载失败'),
        icon: 'none'
      })
    }
  },

  async toggleSubscription() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    try {
      const subscriptions = await api.toggleActivitySubscription(this.data.activity.publisherKey)
      this.setData({
        subscriptions,
        activity: decorateActivity(this.data.activity, this.data.lang, subscriptions)
      })
      wx.showToast({
        title: this.data.lang === 'en' ? 'Subscription updated' : '订阅已更新',
        icon: 'success'
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Update failed' : '更新失败'),
        icon: 'none'
      })
    }
  },

  openPublisher() {
    if (!this.data.activity || !this.data.activity.publisherKey) return
    wx.navigateTo({
      url: `/packages/activity/pages/activityPublisher/activityPublisher?key=${encodeURIComponent(this.data.activity.publisherKey)}`
    })
  },

  async toggleSave() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    const activity = this.data.activity
    // Optimistic update: toggle immediately for instant feedback
    const wasSaved = activity.saved
    const newSaved = !wasSaved
    this.setData({ 'activity.saved': newSaved })
    wx.vibrateShort({ type: 'light' })
    try {
      await api.toggleActivity(activity.id, 'saved')
    } catch (error) {
      // Rollback on failure
      this.setData({ 'activity.saved': wasSaved })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to update' : '更新失败'),
        icon: 'none'
      })
    }
  },

  async toggleLike() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    const activity = this.data.activity
    // Optimistic update: toggle immediately for instant feedback
    const wasLiked = activity.liked
    const newLiked = !wasLiked
    const newCount = (activity.likeCount || 0) + (newLiked ? 1 : -1)
    this.setData({
      'activity.liked': newLiked,
      'activity.likeCount': Math.max(0, newCount)
    })
    wx.vibrateShort({ type: 'light' })
    try {
      await api.toggleActivity(activity.id, 'liked')
      // Sync with server only on failure-free completion — no full reload needed
    } catch (error) {
      // Rollback on failure
      this.setData({
        'activity.liked': wasLiked,
        'activity.likeCount': activity.likeCount || 0
      })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to like' : '点赞失败'),
        icon: 'none'
      })
    }
  },

  async toggleShare() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    try {
      await api.toggleActivity(this.data.activity.id, 'shared')
      this.openSharePreview()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to share' : '分享失败'),
        icon: 'none'
      })
    }
  },

  async toggleRegistration() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    try {
      if (this.data.activity.registered) {
        await api.cancelActivityRegistration(this.data.activity.id)
        wx.showToast({
          title: this.data.lang === 'en' ? 'Registration cancelled' : '已取消报名',
          icon: 'success'
        })
      } else {
        await api.registerActivity(this.data.activity.id)
        wx.showToast({
          title: this.data.lang === 'en' ? 'Registered' : '报名成功',
          icon: 'success'
        })
      }
      await this.loadPageData()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Registration failed' : '报名失败'),
        icon: 'none'
      })
    }
  },

  async addToSchedule() {
    if (!this.requireAccount()) return
    if (!this.data.activity) return
    try {
      await api.addActivityToSchedule(this.data.activity.id)
      wx.showToast({
        title: this.data.lang === 'en' ? 'Added to schedule' : '已加入活动表',
        icon: 'success'
      })
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/schedule/schedule?date=${this.data.activity.date}&scheduleKind=activity&viewMode=month`
        })
      }, 300)
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to add' : '添加失败'),
        icon: 'none'
      })
    }
  },

  openSharePreview() {
    this.setData({ sharePreviewOpen: true })
  },

  closeSharePreview() {
    this.setData({ sharePreviewOpen: false })
  },

  noop() {},

  savePoster() {
    wx.showToast({
      title: this.data.lang === 'en' ? 'Poster preview saved' : '海报预览已保存',
      icon: 'none'
    })
  },

  onShareAppMessage() {
    const activity = this.data.activity || {}
    return {
      title: activity.displayTitle || (this.data.lang === 'en' ? 'Xipoo Activities' : 'Xipoo 活动'),
      path: `/packages/activity/pages/activityDetail/activityDetail?id=${this.data.id}`,
      imageUrl: activity.coverUrl || '/images/share/invite-cover.jpg'
    }
  }
})
