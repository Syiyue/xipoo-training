const api = require('../../../../utils/api')
const { resolveCloudImage } = require('../../../../utils/cloudImage')
const { isJumpActivity, isNativeReservation, buildJumpTarget } = require('../../../../utils/activityJump')

function groupActivities(activities, lang) {
  const groups = []
  ;(activities || []).forEach((activity) => {
    const month = String(activity.date || '').slice(0, 7) || (lang === 'en' ? 'Date TBD' : '日期待定')
    let group = groups[groups.length - 1]
    if (!group || group.month !== month) {
      group = { month, activities: [] }
      groups.push(group)
    }
    group.activities.push(activity)
  })
  return groups
}

Page({
  data: { lang: 'zh', loading: true, manager: null, monthGroups: [] },

  onLoad(options) {
    this.managerId = decodeURIComponent(options.id || '')
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    this.loadManager()
  },

  async loadManager() {
    try {
      const managers = await api.getPaiManagers()
      const manager = (managers || []).find((item) => item.id === this.managerId)
      if (!manager) throw new Error(this.data.lang === 'en' ? 'Host not found' : '主理人不存在')
      const activities = await Promise.all((manager.activities || []).map(async (activity) => {
        const resolved = await resolveCloudImage(activity, 'coverUrl')
        return Object.assign({}, resolved, {
          displayTitle: this.data.lang === 'en'
            ? (activity.titleEn || activity.title || activity.titleZh || '')
            : (activity.titleZh || activity.titleEn || activity.title || ''),
          displayTime: [activity.date, activity.start].filter(Boolean).join(' ')
        })
      }))
      activities.sort((a, b) => `${a.date || ''} ${a.start || ''}`.localeCompare(`${b.date || ''} ${b.start || ''}`))
      wx.setNavigationBarTitle({ title: manager.displayName || (this.data.lang === 'en' ? 'Host' : '主理人') })
      this.setData({
        loading: false,
        manager: Object.assign({}, manager, { initial: String(manager.displayName || '主').slice(0, 1) }),
        monthGroups: groupActivities(activities, this.data.lang)
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
    }
  },

  openActivity(event) {
    const id = event.currentTarget.dataset.id
    const activities = (this.data.monthGroups || []).reduce((all, group) => all.concat(group.activities), [])
    const target = activities.find((item) => item.id === id)
    if (!target) return
    if (isNativeReservation(target)) {
      api.trackActivityClick(id, target.jumpType)
      wx.navigateTo({ url: `/packages/activity/pages/reservation/reservation?activityId=${encodeURIComponent(id)}` })
      return
    }
    if (isJumpActivity(target)) {
      api.trackActivityClick(id, target.jumpType)
      const jump = buildJumpTarget(target)
      wx.navigateToMiniProgram(jump.shortLink
        ? { shortLink: jump.shortLink }
        : { appId: jump.appId, path: jump.path, extraData: jump.extraData || {} })
      return
    }
    api.trackActivityClick(id, target.jumpType || '')
    wx.navigateTo({ url: `/packages/activity/pages/activityDetail/activityDetail?id=${encodeURIComponent(id)}` })
  }
})
