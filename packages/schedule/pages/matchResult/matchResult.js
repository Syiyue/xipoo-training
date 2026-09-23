const api = require('../../../../utils/api')
const { decorateResult } = require('../../common/availabilityView')
const { groupCourses, countExcluded } = require('../../common/courseExclusion')

function monthTitle(dateString) {
  const date = new Date(`${dateString}T00:00:00`)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

Page({
  _active: true,

  data: {
    matchId: '',
    record: null,
    result: null,
    calendarMonth: '',
    calendarTitle: '',
    calendarCells: [],
    selectedDate: '',
    selectedDay: null,
    onlyAvailable: false,
    conflictOpen: false,
    selectedHour: null,
    ownCourseSections: [],
    excludedCount: 0,
    excludeOpen: false,
    recomputing: false,
    windows: [],
    sharePreview: null,
    lang: 'zh',
    weekdays: ['一', '二', '三', '四', '五', '六', '日']
  },

  onLoad(options) {
    this._active = true
    const rawSharePreview = wx.getStorageSync('xipoo_match_share_preview') || null
    const sharePreview = rawSharePreview ? Object.assign({}, rawSharePreview, {
      sharedSlotsText: (rawSharePreview.sharedFreeSlots || []).map((slot) => `${slot.start}–${slot.end}`).join('、')
    }) : null
    this.setData({
      matchId: options.matchId || '',
      sharePreview
    })
  },

  onShow() {
    this._active = true
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang }, () => {
      if (!this._active) return
      wx.setNavigationBarTitle({ title: this.data.lang === 'en' ? 'Shared free time result' : '共同空闲结果' })
      this.loadResult()
    })
  },

  onUnload() {
    this._active = false
  },

  async loadResult() {
    try {
      const record = await api.getScheduleMatch(this.data.matchId)
      if (!this._active) return
      const result = record.result
      const firstAvailableDay = result.days.find((day) => day.freeMinutes > 0)
      const selectedDate = firstAvailableDay ? firstAvailableDay.date : result.startDate
      this.setData({
        record,
        result,
        selectedDate,
        calendarMonth: `${selectedDate.slice(0, 7)}-01`,
        calendarTitle: monthTitle(selectedDate)
      })
      this.refreshView()
      this.loadOwnCourses()
    } catch (error) {
      if (!this._active) return
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load result' : '结果加载失败'),
        icon: 'none'
      })
    }
  },

  refreshView() {
    if (!this._active) return
    const view = decorateResult(
      this.data.result,
      this.data.selectedDate,
      this.data.onlyAvailable,
      this.data.calendarMonth,
      this.data.lang
    )
    this.setData({
      calendarCells: view.calendarCells,
      selectedDay: view.selectedDay,
      selectedDate: view.selectedDay ? view.selectedDay.date : this.data.selectedDate,
      windows: view.windows
    })
  },

  async loadOwnCourses() {
    try {
      const [me, courses] = await Promise.all([
        api.me().catch(() => null),
        api.getSchedule()
      ])
      if (!this._active) return
      this._selfId = me ? me.id : ''
      this._ownCourses = Array.isArray(courses) ? courses : []
      this.setData({
        ownCourseSections: groupCourses(this._ownCourses, this.data.lang),
        excludedCount: countExcluded(this._ownCourses)
      })
    } catch (error) {
      // 课程列表加载失败时仅隐藏排除开关，不影响结果查看
    }
  },

  toggleExcludeOpen() {
    this.setData({ excludeOpen: !this.data.excludeOpen })
  },

  async toggleCourseExclude(event) {
    if (this.data.recomputing) return
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
      ownCourseSections: groupCourses(this._ownCourses, this.data.lang),
      excludedCount: countExcluded(this._ownCourses)
    })
    try {
      await api.upsertCoursesBatch(changed)
      await this.recomputeResult()
    } catch (error) {
      if (!this._active) return
      changed.forEach((item) => { item.excludedFromFreeTime = !target })
      this.setData({
        ownCourseSections: groupCourses(this._ownCourses, this.data.lang),
        excludedCount: countExcluded(this._ownCourses)
      })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to update course' : '课程更新失败'),
        icon: 'none'
      })
    }
  },

  // 排除变化后按原参数重新计算共同空闲（保存的 record.result 是静态快照）
  async recomputeResult() {
    const record = this.data.record
    if (!record || !this._selfId || !this._active) return
    const friendIds = (record.participantIds || []).filter((id) => id !== this._selfId)
    this.setData({ recomputing: true })
    try {
      const result = await api.groupFreeSlots(
        friendIds,
        record.result.startDate,
        record.result.endDate,
        record.result.range
      )
      if (!this._active) return
      this.setData({ result })
      this.refreshView()
    } catch (error) {
      if (!this._active) return
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Recalculation failed' : '重新计算失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ recomputing: false })
    }
  },

  selectDay(event) {
    if (!this._active) return
    const date = event.currentTarget.dataset.date
    const day = this.data.result.days.find((item) => item.date === date)
    if (!day || (this.data.onlyAvailable && !day.freeMinutes)) return
    this.setData({ selectedDate: date })
    this.refreshView()
  },

  shiftMonth(event) {
    const date = new Date(`${this.data.calendarMonth}T00:00:00`)
    date.setMonth(date.getMonth() + Number(event.currentTarget.dataset.step))
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    if (next.slice(0, 7) < this.data.result.startDate.slice(0, 7) ||
      next.slice(0, 7) > this.data.result.endDate.slice(0, 7)) return
    const firstDay = this.data.result.days.find((day) => (
      day.date.slice(0, 7) === next.slice(0, 7) &&
      (!this.data.onlyAvailable || day.freeMinutes > 0)
    ))
    const selectedDate = firstDay ? firstDay.date : this.data.selectedDate
    this.setData({ calendarMonth: next, calendarTitle: monthTitle(next), selectedDate })
    this.refreshView()
  },

  toggleOnlyAvailable(event) {
    this.setData({ onlyAvailable: event.detail.value })
    this.refreshView()
  },

  openHour(event) {
    this.setData({
      selectedHour: this.data.selectedDay.hours[Number(event.currentTarget.dataset.index)],
      conflictOpen: true
    })
  },

  closeHour() {
    this.setData({ conflictOpen: false, selectedHour: null })
  },

  onHide() {
    this._active = false
  },

  onShareAppMessage() {
    const preview = this.data.sharePreview
    const title = preview && preview.date && preview.sharedFreeSlots && preview.sharedFreeSlots.length
      ? `${preview.date} · ${preview.sharedFreeSlots.map((slot) => `${slot.start}-${slot.end}`).join('、')}`
      : 'Xipoo 共同空闲时间'
    return {
      title,
      path: `/packages/schedule/pages/matchResult/matchResult?matchId=${this.data.matchId}`
    }
  }
})
