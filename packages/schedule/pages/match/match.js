const api = require('../../../../utils/api')
const { groupCourses, countExcluded } = require('../../common/courseExclusion')
const { DISPLAY_RANGE, buildAvailabilityView } = require('../../common/decisionView')
const { getActivitySuggestions, validSuggestions } = require('../../common/activitySuggestions')

const { defaultDateRange, earliestCourseDate, monthTitle } = require('../../common/matchDateRange')

function normalizeFriends(friendsResult) {
  if (Array.isArray(friendsResult)) return friendsResult
  return friendsResult && Array.isArray(friendsResult.friends) ? friendsResult.friends : []
}

function decorateFriends(friendsResult, selectedIds) {
  return normalizeFriends(friendsResult).map((item) => {
    const myPerm = item.myPermission || {}
    const friendPerm = item.friendPermission || {}
    const mutuallyShared = Boolean(
      (myPerm.level && myPerm.level !== 'none') && (friendPerm.level && friendPerm.level !== 'none')
    )
    const allowCalc = myPerm.allowFreeTimeCalc !== false && friendPerm.allowFreeTimeCalc !== false
    let ineligibleReason = ''
    if (!mutuallyShared) ineligibleReason = 'notMutual'
    else if (!allowCalc) ineligibleReason = 'notAllowedCalc'
    return Object.assign({}, item, {
      selected: selectedIds.includes(item.friend.id),
      mutuallyShared,
      eligible: mutuallyShared && allowCalc,
      ineligibleReason
    })
  })
}

Page({
  _active: true,
  _saveLocked: false,
  _dateRangeTouched: false,

  data: {
    selfInfo: null,
    selfIncluded: true,
    friends: [],
    selectedFriendIds: [],
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    startTime: DISPLAY_RANGE.start,
    endTime: DISPLAY_RANGE.end,
    preview: null,
    calendarMonth: '2026-07-01',
    calendarTitle: '2026年7月',
    calendarCells: [],
    selectedDate: '2026-07-01',
    selectedDay: null,
    setupOpen: true,
    monthStats: { participantCount: 0, longDayCount: 0 },
    monthNarrative: [],
    timeline: { ticks: [], sharedFreeSlots: [], longestSlot: null, longestText: '', memberRows: [] },
    activitySuggestions: [],
    activitiesLoading: false,
    activitiesFallback: false,
    activityVariant: 0,
    loading: false,
    saving: false,
    loadingFriends: true,
    hasFriends: false,
    hasOwnCourses: false,
    ownCourseSections: [],
    excludedCount: 0,
    excludeOpen: false,
    excludeKeyword: '',
    windows: [],
    lang: 'zh',
    weekdays: ['一', '二', '三', '四', '五', '六', '日']
  },

  onLoad(options) {
    this._active = true
    this.pendingFriendId = options.friendId || ''
    // 时间小组：一次预选多位联系人
    this.pendingFriendIds = options.friendIds
      ? String(options.friendIds).split(',').map((id) => id.trim()).filter(Boolean)
      : []
    // 默认日期范围：31 天窗口（保持后端单次计算上限）。
    // 先用学期起算日做临时起点；loadOwnCourses 拉到课程后，再按课程的具体日期精确锚定。
    // 目的：避免把开课前的空闲期（例如 8 月）纳入共同空闲计算。
    this.setData(defaultDateRange(new Date(), wx.getStorageSync('semesterStartDate')))
  },

  onShow() {
    this._active = true
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang }, () => {
      if (!this._active) return
      wx.setNavigationBarTitle({ title: this.data.lang === 'en' ? 'Shared free time' : '多人共同空闲' })
      this.loadFriends()
    })
  },

  onUnload() {
    this._active = false
  },

  onHide() {
    this._active = false
  },

  async loadFriends() {
    try {
      const [friends, selfInfo] = await Promise.all([
        api.getFriendships(),
        api.me().catch(() => null)
      ])
      if (!this._active) return
      let selectedFriendIds = this.data.selectedFriendIds
      const pending = (this.pendingFriendIds || []).concat(this.pendingFriendId ? [this.pendingFriendId] : [])
      pending.forEach((id) => {
        if (id && !selectedFriendIds.includes(id) && selectedFriendIds.length < 8) {
          selectedFriendIds = selectedFriendIds.concat(id)
        }
      })
      this.pendingFriendId = ''
      this.pendingFriendIds = []
      const friendList = normalizeFriends(friends)
      const decorated = decorateFriends(friendList, selectedFriendIds)
      this.setData({
        selfInfo: selfInfo ? {
          id: selfInfo.id,
          name: selfInfo.name || '我',
          avatar: selfInfo.avatar || '我',
          signature: selfInfo.signature || ''
        } : null,
        friends: decorated,
        selectedFriendIds,
        loadingFriends: false,
        hasFriends: friendList.length > 0
      })
      this.loadOwnCourses()
    } catch (error) {
      if (!this._active) return
      this.setData({ loadingFriends: false, hasFriends: false })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load friends' : '联系人加载失败'),
        icon: 'none'
      })
    }
  },

  goToFindBuddy() {
    // 切到日程共享页并自动打开「邀请同学」面板，避免只落在首页无法选人
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.pendingFriendsView = 'add'
    }
    wx.switchTab({ url: '/pages/friends/friends' })
  },

  async loadOwnCourses() {
    try {
      const courses = await api.getSchedule()
      if (!this._active) return
      this._ownCourses = Array.isArray(courses) ? courses : []
      this.setData({
        hasOwnCourses: this._ownCourses.length > 0,
        ownCourseSections: groupCourses(this._ownCourses, this.data.lang, this.data.excludeKeyword),
        excludedCount: countExcluded(this._ownCourses)
      })
      // 依据课程的具体日期调整默认范围（用户未手动改动日期、且尚未开始计算时）。
      if (!this._dateRangeTouched && !this.data.preview) {
        const semesterStart = wx.getStorageSync('semesterStartDate')
        const earliest = earliestCourseDate(this._ownCourses, semesterStart)
        const range = defaultDateRange(new Date(), semesterStart, earliest)
        if (range.startDate !== this.data.startDate || range.endDate !== this.data.endDate) {
          this.setData(range)
        }
      }
    } catch (error) {
      // 课程列表加载失败不阻塞匹配流程
    }
  },

  toggleExcludeOpen() {
    this.setData({ excludeOpen: !this.data.excludeOpen })
  },

  onExcludeSearch(event) {
    const excludeKeyword = event.detail.value || ''
    this.setData({
      excludeKeyword,
      ownCourseSections: groupCourses(this._ownCourses || [], this.data.lang, excludeKeyword)
    })
  },

  // 一次开关整类课：同一门课同一时段（如 CCT009 的所有 Lecture）的所有记录一起更新
  async toggleCourseExclude(event) {
    const key = event.currentTarget.dataset.key
    let group = null
    ;(this.data.ownCourseSections || []).forEach((section) => {
      const hit = (section.groups || []).find((item) => item.key === key)
      if (hit) group = hit
    })
    if (!group) return
    const target = !group.excluded
    const changed = (this._ownCourses || []).filter((item) => group.ids.includes(item.id))
    if (!changed.length) return
    changed.forEach((item) => { item.excludedFromFreeTime = target })
    this.setData({
      ownCourseSections: groupCourses(this._ownCourses, this.data.lang, this.data.excludeKeyword),
      excludedCount: countExcluded(this._ownCourses),
      preview: null
    })
    try {
      await api.upsertCoursesBatch(changed)
    } catch (error) {
      if (!this._active) return
      changed.forEach((item) => { item.excludedFromFreeTime = !target })
      this.setData({
        ownCourseSections: groupCourses(this._ownCourses, this.data.lang, this.data.excludeKeyword),
        excludedCount: countExcluded(this._ownCourses)
      })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to update course' : '课程更新失败'),
        icon: 'none'
      })
    }
  },

  toggleFriend(event) {
    const id = event.currentTarget.dataset.id
    const friend = (this.data.friends || []).find((item) => item.friend && item.friend.id === id)
    const selected = this.data.selectedFriendIds.slice()
    const index = selected.indexOf(id)
    if (index >= 0) {
      selected.splice(index, 1)
    } else {
      // 前置校验：未双向共享 / 未开启空闲计算的联系人禁止勾选
      if (friend && !friend.eligible) {
        const tip = friend.ineligibleReason === 'notMutual'
          ? (this.data.lang === 'en' ? 'Schedules are not shared mutually' : '该联系人尚未双向共享日程')
          : (this.data.lang === 'en' ? 'Free-time calculation is not enabled' : '该联系人未开启空闲计算权限')
        wx.showToast({ title: tip, icon: 'none' })
        return
      }
      if (selected.length < 8) selected.push(id)
      else {
        wx.showToast({
          title: this.data.lang === 'en' ? 'You can select up to 8 contacts' : '最多选择 8 位联系人',
          icon: 'none'
        })
        return
      }
    }
    this.setData({
      selectedFriendIds: selected,
      friends: decorateFriends(this.data.friends, selected),
      preview: null
    })
  },

  toggleSelf() {
    const selfIncluded = !this.data.selfIncluded
    if (!selfIncluded && this.data.selectedFriendIds.length === 0) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Please select at least one participant' : '请至少选择一位参与者',
        icon: 'none'
      })
      return
    }
    this.setData({ selfIncluded, preview: null })
  },

  onStartDate(event) {
    this._dateRangeTouched = true
    this.setData({
      startDate: event.detail.value,
      calendarMonth: `${event.detail.value.slice(0, 7)}-01`,
      calendarTitle: monthTitle(event.detail.value),
      preview: null
    })
  },

  onEndDate(event) {
    this._dateRangeTouched = true
    this.setData({ endDate: event.detail.value, preview: null })
  },

  onStartTime(event) {
    this.setData({ startTime: event.detail.value, preview: null })
  },

  onEndTime(event) {
    this.setData({ endTime: event.detail.value, preview: null })
  },

  async previewMatch() {
    if (!this._active) return
    const totalParticipants = (this.data.selfIncluded ? 1 : 0) + this.data.selectedFriendIds.length
    if (totalParticipants < 1) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Please select at least one participant' : '请至少选择一位参与者',
        icon: 'none'
      })
      return
    }
    const start = new Date(`${this.data.startDate}T00:00:00`)
    const end = new Date(`${this.data.endDate}T00:00:00`)
    const rangeDays = Math.round((end - start) / 86400000)
    if (Number.isNaN(rangeDays) || rangeDays < 0 || rangeDays > 30) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Choose a valid range within 31 days' : '请选择不超过 31 天的有效日期范围',
        icon: 'none'
      })
      return
    }
    this.setData({ loading: true })
    try {
      const preview = await api.groupFreeSlots(
        this.data.selectedFriendIds,
        this.data.startDate,
        this.data.endDate,
        DISPLAY_RANGE
      )
      if (!this._active) return
      const firstAvailableDay = preview.days.find((day) => day.freeMinutes > 0)
      const selectedDate = firstAvailableDay ? firstAvailableDay.date : preview.startDate
      this.setData({
        preview,
        selectedDate,
        calendarMonth: `${selectedDate.slice(0, 7)}-01`,
        calendarTitle: monthTitle(selectedDate),
        startTime: DISPLAY_RANGE.start,
        endTime: DISPLAY_RANGE.end,
        setupOpen: false,
        activityVariant: 0
      })
      this.refreshResultView()
    } catch (error) {
      if (!this._active) return
      // 直接透传后端真实原因（缺少关系/未双向共享/未开启计算），不再被 mock 降级误导为「云端不可用」
      const message = (error && error.message)
        || (this.data.lang === 'en' ? 'Calculation failed' : '计算失败')
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  refreshResultView() {
    if (!this._active) return
    const view = buildAvailabilityView(
      this.data.preview,
      this.data.calendarMonth,
      this.data.selectedDate,
      DISPLAY_RANGE
    )
    this.setData({
      calendarCells: view.calendarCells,
      selectedDay: view.selectedDay,
      selectedDate: view.selectedDay ? view.selectedDay.date : this.data.selectedDate,
      timeline: view.timeline,
      monthStats: view.stats,
      monthNarrative: view.narrative
    })
    this.refreshActivitySuggestions(view.selectedDay, view.timeline, this.data.activityVariant)
  },

  toggleSetup() {
    this.setData({ setupOpen: !this.data.setupOpen })
  },

  refreshActivities() {
    this.setData({ activityVariant: this.data.activityVariant + 1 })
    this.refreshActivitySuggestions(this.data.selectedDay, this.data.timeline, this.data.activityVariant + 1)
  },

  async refreshActivitySuggestions(day, timeline, variant) {
    const requestId = (this._activityRequestId || 0) + 1
    this._activityRequestId = requestId
    const slots = (timeline && timeline.sharedFreeSlots || []).map((slot) => ({
      start: slot.start,
      end: slot.end,
      durationMinutes: slot.duration
    }))
    const longestSlotMinutes = timeline && timeline.longestSlot ? timeline.longestSlot.duration : 0
    const context = {
      participantCount: (this.data.preview && this.data.preview.participants || []).length,
      date: day && day.date,
      sharedFreeSlots: slots,
      longestSlotMinutes,
      variant: Number(variant || 0)
    }
    const fallback = getActivitySuggestions(context, variant)
    if (!slots.length) {
      this.setData({ activitySuggestions: [], activitiesLoading: false, activitiesFallback: false })
      return
    }
    this.setData({ activitiesLoading: true, activitySuggestions: [], activitiesFallback: false })
    try {
      const response = await api.getActivitySuggestions(context)
      if (!this._active || requestId !== this._activityRequestId) return
      const suggestions = validSuggestions(response && response.suggestions, longestSlotMinutes)
      this.setData({
        activitySuggestions: suggestions || fallback,
        activitiesLoading: false,
        activitiesFallback: !suggestions
      })
    } catch (error) {
      if (!this._active || requestId !== this._activityRequestId) return
      this.setData({ activitySuggestions: fallback, activitiesLoading: false, activitiesFallback: true })
    }
  },

  selectDay(event) {
    if (!this._active) return
    const date = event.currentTarget.dataset.date
    const day = this.data.preview.days.find((item) => item.date === date)
    if (!day) return
    this.setData({ selectedDate: date, activityVariant: 0 })
    this.refreshResultView()
  },

  shiftMonth(event) {
    const step = Number(event.currentTarget.dataset.step)
    const date = new Date(`${this.data.calendarMonth}T00:00:00`)
    date.setMonth(date.getMonth() + step)
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    const minMonth = this.data.preview.startDate.slice(0, 7)
    const maxMonth = this.data.preview.endDate.slice(0, 7)
    if (next.slice(0, 7) < minMonth || next.slice(0, 7) > maxMonth) return
    const firstDay = this.data.preview.days.find((day) => day.date.slice(0, 7) === next.slice(0, 7))
    const selectedDate = firstDay ? firstDay.date : this.data.selectedDate
    this.setData({
      calendarMonth: next,
      calendarTitle: monthTitle(next),
      selectedDate,
      activityVariant: 0
    })
    this.refreshResultView()
  },

  async saveResult() {
    if (this._saveLocked) return
    this._saveLocked = true
    this.setData({ saving: true })
    try {
      const sharePreview = {
        date: this.data.selectedDate,
        participantCount: this.data.monthStats.participantCount,
        sharedFreeSlots: (this.data.timeline.sharedFreeSlots || []).map((slot) => ({
          start: slot.start,
          end: slot.end,
          duration: slot.duration
        })),
        longestText: this.data.timeline.longestText,
        suggestion: this.data.activitySuggestions[0] || null
      }
      wx.setStorageSync('xipoo_match_share_preview', sharePreview)
      const record = await api.createScheduleMatch({
        friendIds: this.data.selectedFriendIds,
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        range: { start: this.data.startTime, end: this.data.endTime }
      })
      if (!this._active) return
      wx.navigateTo({ url: `/packages/schedule/pages/matchResult/matchResult?matchId=${record.id}` })
    } catch (error) {
      if (!this._active) return
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Save failed' : '保存失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ saving: false })
      setTimeout(() => { this._saveLocked = false }, 1500)
    }
  }
})
