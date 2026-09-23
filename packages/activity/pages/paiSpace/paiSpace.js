const api = require('../../../../utils/api')
const { resolveCloudImage } = require('../../../../utils/cloudImage')
const { withActivityStatus } = require('../../../../utils/activityStatus')
const { isJumpActivity, isNativeReservation, buildJumpTarget } = require('../../../../utils/activityJump')
const { PAI_SPACE_KEY, filterByCategoryKey, categoryDisplayName } = require('../../../../utils/activityCategories')

// 品牌区简介（模块 4）：写死双语常量，简化自 tools/setupPaiSpace.js 的 storyZh
const BRAND = {
  nameZh: 'PAI空间 π空间',
  nameEn: 'PAI Space',
  introZh: '面向全校的人工智能创新社区：工作坊、黑客松、论文共读与前沿沙龙，把每一个奇思妙想变成看得见的作品。',
  introEn: 'An AI innovation community open to everyone: workshops, hackathons, paper reading and tech salons — turning sparks of ideas into real demos.'
}

function displayActivity(item, lang, categoryMap, managerMap) {
  const isEn = lang === 'en'
  const withStatus = withActivityStatus(item, lang)
  const category = categoryMap[item.categoryKey]
  return Object.assign({}, item, {
    statusKey: withStatus.statusKey,
    statusText: withStatus.statusText,
    displayTitle: isEn ? (item.titleEn || item.title || item.titleZh || '') : (item.titleZh || item.titleEn || item.title || ''),
    displayTime: [item.date, item.start && item.end ? `${item.start}-${item.end}` : item.start].filter(Boolean).join(' '),
    displayHost: isEn ? (item.hostEn || item.host || item.hostZh || '') : (item.hostZh || item.hostEn || item.host || ''),
    managerName: managerMap[item.managerId] ? managerMap[item.managerId].displayName : '',
    categoryName: category ? categoryDisplayName(category, lang) : '',
    coverUrl: item.coverUrl || ''
  })
}

Page({
  data: {
    lang: 'zh',
    loading: true,
    brand: BRAND,
    categories: [],
    contentCategories: [],
    managers: [],
    showManagers: false,
    activeCategory: '',
    activities: [],
    leftActivities: [],
    rightActivities: []
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'PAI Space' : 'π空间' })
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [result, categories, managers] = await Promise.all([
        api.getActivityPublisher(PAI_SPACE_KEY),
        api.getActivityCategories('paispace'),
        api.getPaiManagers()
      ])
      const lang = this.data.lang
      const categoryMap = {}
      ;(categories || []).forEach((cat) => { categoryMap[cat.key] = cat })
      const managerMap = {}
      ;(managers || []).forEach((manager) => { managerMap[manager.id] = manager })
      const activities = await Promise.all(((result && result.activities) || []).map(async (item) => {
        const resolved = await resolveCloudImage(item, 'coverUrl')
        return displayActivity(resolved, lang, categoryMap, managerMap)
      }))
      activities.sort((a, b) => `${a.date || ''} ${a.start || ''}`.localeCompare(`${b.date || ''} ${b.start || ''}`))
      const usedCategoryKeys = new Set(activities.map((item) => item.categoryKey).filter(Boolean))
      const contentCategories = (categories || []).filter((category) => usedCategoryKeys.has(category.key))
      this.setData({
        loading: false,
        categories: (categories || []).map((cat) => Object.assign({}, cat, {
          displayName: categoryDisplayName(cat, lang)
        })),
        contentCategories: contentCategories.map((cat) => Object.assign({}, cat, {
          displayName: categoryDisplayName(cat, lang)
        })),
        managers: (managers || []).map((manager) => Object.assign({}, manager, {
          initial: String(manager.displayName || '主').slice(0, 1),
          activityCount: Array.isArray(manager.activities) ? manager.activities.length : 0
        })),
        activities
      }, () => this.applyFilter())
    } catch (error) {
      this.setData({ loading: false, activities: [], leftActivities: [], rightActivities: [] })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load' : '加载失败'),
        icon: 'none'
      })
    }
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.key || '' }, () => this.applyFilter())
  },

  showActivities() {
    this.setData({ activeCategory: '', showManagers: false }, () => {
      this.applyFilter()
      wx.pageScrollTo({ selector: '#psActivities', duration: 250 })
    })
  },

  showContentTypes() {
    this.setData({ showManagers: false }, () => wx.pageScrollTo({ selector: '#psCategories', duration: 250 }))
  },

  toggleManagers() {
    this.setData({ showManagers: !this.data.showManagers }, () => {
      if (this.data.showManagers) wx.pageScrollTo({ selector: '#psManagers', duration: 250 })
    })
  },

  openManager(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/packages/activity/pages/paiManager/paiManager?id=${encodeURIComponent(id)}` })
  },

  applyFilter() {
    const filtered = filterByCategoryKey(this.data.activities, this.data.activeCategory)
    const leftActivities = []
    const rightActivities = []
    filtered.forEach((item, index) => {
      (index % 2 === 0 ? leftActivities : rightActivities).push(item)
    })
    this.setData({ leftActivities, rightActivities })
  },

  // 点击分发与活动方主页一致：自研预约 → 站内预约页；第三方跳转 → 目标小程序；否则详情页
  openActivity(event) {
    const id = event.currentTarget.dataset.id
    const target = (this.data.activities || []).find((item) => item.id === id)
    if (target && isNativeReservation(target)) {
      api.trackActivityClick(id, target.jumpType)
      wx.navigateTo({ url: `/packages/activity/pages/reservation/reservation?activityId=${encodeURIComponent(id)}` })
      return
    }
    if (target && isJumpActivity(target)) {
      this.openJumpActivity(target)
      return
    }
    if (target) api.trackActivityClick(id, target.jumpType || '')
    wx.navigateTo({ url: `/packages/activity/pages/activityDetail/activityDetail?id=${encodeURIComponent(id)}` })
  },

  async openJumpActivity(target) {
    await api.trackActivityClick(target.id, target.jumpType)
    const jump = buildJumpTarget(target)
    const options = jump.shortLink
      ? { shortLink: jump.shortLink }
      : { appId: jump.appId, path: jump.path, extraData: jump.extraData || {} }
    options.fail = () => wx.showToast({
        title: this.data.lang === 'en' ? 'Unable to open the mini program' : '跳转失败，请稍后重试',
        icon: 'none'
    })
    wx.navigateToMiniProgram(options)
  },

  noop() {}
})
