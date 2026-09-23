const api = require('../../../../utils/api')
const { resolveCloudImage } = require('../../../../utils/cloudImage')
const { withActivityStatus } = require('../../../../utils/activityStatus')
const { isJumpActivity, isNativeReservation, buildJumpTarget } = require('../../../../utils/activityJump')

const WEEKDAYS = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function displayActivity(item, lang) {
  const isEn = lang === 'en'
  // 状态标签统一规范（模块 5）
  const withStatus = withActivityStatus(item, lang)
  return Object.assign({}, item, {
    statusKey: withStatus.statusKey,
    statusText: withStatus.statusText,
    displayTitle: isEn ? (item.titleEn || item.title || item.titleZh || '') : (item.titleZh || item.titleEn || item.title || ''),
    displayType: isEn ? (item.typeEn || item.typeZh || '') : (item.typeZh || item.typeEn || ''),
    displayPlace: isEn ? (item.placeEn || item.place || item.placeZh || '') : (item.placeZh || item.placeEn || item.place || ''),
    displayDate: [item.date, item.start && item.end ? `${item.start}-${item.end}` : item.start].filter(Boolean).join(' · '),
    coverUrl: item.coverUrl || ''
  })
}

// galleryUrls 与 coverUrl/logoUrl 一样可能存的是 cloud:// 文件 ID，逐个解析，非云端地址原样保留
function resolveGalleryUrls(urls) {
  if (!Array.isArray(urls)) return Promise.resolve([])
  return Promise.all(urls.map(async (url) => {
    const resolved = await resolveCloudImage({ url }, 'url')
    return resolved.url
  }))
}

function buildCalendar(year, month, activities, selectedDate, accent) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const monthDays = new Date(year, month + 1, 0).getDate()
  const previousMonthDays = new Date(year, month, 0).getDate()
  const today = new Date()
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate())

  return Array.from({ length: 42 }, (_, index) => {
    const offset = index - firstWeekday + 1
    let cellYear = year
    let cellMonth = month
    let day = offset
    let currentMonth = true
    if (offset <= 0) {
      cellMonth -= 1
      if (cellMonth < 0) {
        cellMonth = 11
        cellYear -= 1
      }
      day = previousMonthDays + offset
      currentMonth = false
    } else if (offset > monthDays) {
      cellMonth += 1
      if (cellMonth > 11) {
        cellMonth = 0
        cellYear += 1
      }
      day = offset - monthDays
      currentMonth = false
    }
    const date = dateKey(cellYear, cellMonth, day)
    const dayActivities = activities.filter((item) => item.date === date)
    return {
      date,
      day,
      currentMonth,
      isToday: date === todayKey,
      selected: date === selectedDate,
      hasEvent: dayActivities.length > 0,
      eventCount: dayActivities.length,
      dotColor: accent
    }
  })
}

function pickInitialDate(activities) {
  const dated = activities.filter((item) => parseDate(item.date)).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (!dated.length) return dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const today = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const upcoming = dated.find((item) => item.date >= today)
  return (upcoming || dated[dated.length - 1]).date
}

Page({
  data: {
    key: '',
    lang: 'zh',
    loading: true,
    publisher: null,
    activities: [],
    featuredActivities: [],
    selectedDate: '',
    selectedDateActivities: [],
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    calendarTitle: '',
    calendarCells: [],
    weekdays: WEEKDAYS.zh,
    subscriptionLoading: false,
    feedbackModalOpen: false,
    feedbackContent: '',
    feedbackContact: '',
    feedbackSubmitting: false
  },

  onLoad(options) {
    const key = decodeURIComponent(options.key || '')
    if (key === 'pai_space') {
      this._redirectingToPaiSpace = true
      wx.redirectTo({ url: '/packages/activity/pages/paiSpace/paiSpace' })
      return
    }
    this.setData({ key })
  },

  onShow() {
    if (this._redirectingToPaiSpace) return
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, weekdays: WEEKDAYS[lang] || WEEKDAYS.zh })
    if (this._lastLoadAt && Date.now() - this._lastLoadAt < 30000) return
    this.loadProfile()
  },

  async loadProfile() {
    if (!this.data.key) {
      this.setData({ loading: false, publisher: null })
      return
    }
    this.setData({ loading: true })
    try {
      const result = await api.getActivityPublisher(this.data.key)
      if (!result || !result.publisher) throw new Error(this.data.lang === 'en' ? 'Organizer not found' : '活动方不存在')

      const rawPublisher = await resolveCloudImage(await resolveCloudImage(result.publisher, 'coverUrl'), 'logoUrl')
      const galleryUrls = await resolveGalleryUrls(rawPublisher.galleryUrls)
      const activities = await Promise.all((result.activities || []).map(async (item) => {
        const resolved = await resolveCloudImage(item, 'coverUrl')
        return displayActivity(resolved, this.data.lang)
      }))
      const isEn = this.data.lang === 'en'
      const fallbackCover = (activities.find((item) => item.coverUrl) || {}).coverUrl || ''
      const totalInterest = activities.reduce((sum, item) => sum + Number(item.joinCount || 0), 0)
      const types = new Set(activities.map((item) => item.displayType).filter(Boolean))
      const publisher = Object.assign({}, rawPublisher, {
        displayName: isEn ? (rawPublisher.name || rawPublisher.nameZh || '') : (rawPublisher.nameZh || rawPublisher.name || ''),
        taglineText: isEn ? (rawPublisher.tagline || rawPublisher.description || rawPublisher.descriptionZh || '') : (rawPublisher.taglineZh || rawPublisher.descriptionZh || rawPublisher.description || ''),
        descriptionText: isEn ? (rawPublisher.description || rawPublisher.descriptionZh || '') : (rawPublisher.descriptionZh || rawPublisher.description || ''),
        locationText: isEn ? (rawPublisher.location || rawPublisher.locationZh || '') : (rawPublisher.locationZh || rawPublisher.location || ''),
        officialLabel: isEn ? (rawPublisher.foundedLabel || 'Verified organizer') : (rawPublisher.foundedLabelZh || '认证活动方'),
        // 未认证活动方展示来源标注：摘自 xx
        sourceChannelText: (!rawPublisher.verified && rawPublisher.sourceChannel) ? (isEn ? `From ${rawPublisher.sourceChannel}` : `摘自 ${rawPublisher.sourceChannel}`) : '',
        storyTitleText: isEn ? (rawPublisher.storyTitle || 'About us') : (rawPublisher.storyTitleZh || '关于我们'),
        storyText: isEn ? (rawPublisher.story || rawPublisher.description || '') : (rawPublisher.storyZh || rawPublisher.descriptionZh || ''),
        contentTags: isEn ? (rawPublisher.contentTags || rawPublisher.contentTagsZh || []) : (rawPublisher.contentTagsZh || rawPublisher.contentTags || []),
        contactLabelText: isEn ? (rawPublisher.contactLabel || 'Contact organizer') : (rawPublisher.contactLabelZh || '联系活动方'),
        initial: (rawPublisher.nameZh || rawPublisher.name || '活').slice(0, 1),
        coverUrl: rawPublisher.coverUrl || fallbackCover,
        accent: rawPublisher.accent || '#35c76f',
        stats: [
          { value: String(activities.length), label: isEn ? 'events' : '场活动' },
          { value: String(totalInterest), label: isEn ? 'interested' : '人感兴趣' },
          { value: String(types.size), label: isEn ? 'formats' : '类内容' }
        ],
        galleryUrls
      })
      const selectedDate = pickInitialDate(activities)
      const featuredActivities = activities
        .slice()
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 4)

      wx.setNavigationBarTitle({ title: publisher.displayName })
      // 日历始终展示当前真实月份，选中日期跟随 pickInitialDate
      const now = new Date()
      this.setData({
        loading: false,
        publisher,
        activities,
        featuredActivities,
        selectedDate,
        calendarYear: now.getFullYear(),
        calendarMonth: now.getMonth()
      }, () => this.refreshCalendar())
    } catch (error) {
      this.setData({ loading: false, publisher: null })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
    }
  },

  refreshCalendar() {
    if (!this.data.publisher) return
    const year = this.data.calendarYear
    const month = this.data.calendarMonth
    const isEn = this.data.lang === 'en'
    this.setData({
      calendarTitle: isEn ? `${month + 1}/${year}` : `${year}年${month + 1}月`,
      calendarCells: buildCalendar(year, month, this.data.activities, this.data.selectedDate, this.data.publisher.accent),
      selectedDateActivities: this.data.activities.filter((item) => item.date === this.data.selectedDate)
    })
  },

  shiftMonth(event) {
    const step = Number(event.currentTarget.dataset.step)
    const target = new Date(this.data.calendarYear, this.data.calendarMonth + step, 1)
    const monthPrefix = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-`
    const firstEvent = this.data.activities.find((item) => String(item.date || '').startsWith(monthPrefix))
    this.setData({
      calendarYear: target.getFullYear(),
      calendarMonth: target.getMonth(),
      selectedDate: firstEvent ? firstEvent.date : dateKey(target.getFullYear(), target.getMonth(), 1)
    }, () => this.refreshCalendar())
  },

  selectDate(event) {
    const selectedDate = event.currentTarget.dataset.date
    const selected = parseDate(selectedDate)
    this.setData({
      selectedDate,
      calendarYear: selected ? selected.getFullYear() : this.data.calendarYear,
      calendarMonth: selected ? selected.getMonth() : this.data.calendarMonth
    }, () => this.refreshCalendar())
  },

  openActivity(event) {
    const id = event.currentTarget.dataset.id
    const target = (this.data.activities || []).find((item) => item.id === id)
    // 自研预约（模块 3）：优先进站内预约页；点击同样上报
    if (target && isNativeReservation(target)) {
      api.trackActivityClick(id, target.jumpType)
      wx.navigateTo({ url: `/packages/activity/pages/reservation/reservation?activityId=${encodeURIComponent(id)}` })
      return
    }
    // 第三方跳转活动（模块 2）：先上报点击，完成后全屏跳转目标小程序
    if (target && isJumpActivity(target)) {
      this.openJumpActivity(target)
      return
    }
    if (target) api.trackActivityClick(id, target.jumpType || '')
    wx.navigateTo({ url: `/packages/activity/pages/activityDetail/activityDetail?id=${encodeURIComponent(id)}` })
  },

  // 第三方小程序跳转：上报完成后全屏跳转（上报失败也照跳）
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

  async toggleSubscription() {
    if (!this.data.publisher || this.data.subscriptionLoading) return
    this.setData({ subscriptionLoading: true })
    try {
      const list = await api.toggleActivitySubscription(this.data.publisher.key)
      const updated = (list || []).find((item) => item.key === this.data.publisher.key)
      this.setData({
        'publisher.subscribed': updated ? updated.subscribed : !this.data.publisher.subscribed,
        subscriptionLoading: false
      })
    } catch (error) {
      this.setData({ subscriptionLoading: false })
      wx.showToast({ title: error.message || '更新失败', icon: 'none' })
    }
  },

  openContactForm() {
    if (!this.data.publisher) return
    this.setData({ feedbackModalOpen: true })
  },

  closeContactForm() {
    if (this.data.feedbackSubmitting) return
    this.setData({ feedbackModalOpen: false })
  },

  noop() {},

  onFeedbackContentInput(event) {
    this.setData({ feedbackContent: event.detail.value })
  },

  onFeedbackContactInput(event) {
    this.setData({ feedbackContact: event.detail.value })
  },

  async submitPublisherFeedback() {
    if (this.data.feedbackSubmitting) return
    const content = this.data.feedbackContent.trim()
    if (!content) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Please write something first' : '请先写下你的建议',
        icon: 'none'
      })
      return
    }
    this.setData({ feedbackSubmitting: true })
    try {
      await api.submitFeedback({
        content,
        contact: this.data.feedbackContact.trim(),
        publisherKey: this.data.publisher ? this.data.publisher.key : ''
      })
      this.setData({
        feedbackSubmitting: false,
        feedbackModalOpen: false,
        feedbackContent: '',
        feedbackContact: ''
      })
      wx.showToast({
        title: this.data.lang === 'en' ? 'Sent to the organizer' : '已提交给活动方',
        icon: 'success'
      })
    } catch (error) {
      this.setData({ feedbackSubmitting: false })
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Submit failed' : '提交失败'),
        icon: 'none'
      })
    }
  },

  // 保留旧方法名兼容历史模板入口
  contactPublisher() {
    this.openContactForm()
  },

  onShareAppMessage() {
    const publisher = this.data.publisher
    return {
      title: publisher ? publisher.displayName : 'Xipoo 活动方',
      path: `/packages/activity/pages/activityPublisher/activityPublisher?key=${encodeURIComponent(this.data.key)}`,
      imageUrl: publisher ? publisher.coverUrl : ''
    }
  }
})
