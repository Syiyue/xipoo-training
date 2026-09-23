const api = require('../../../../utils/api')

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function safeInitialDate(courses, current = new Date()) {
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate())
  const dated = (courses || [])
    .map((course) => String(course.date || course.termStartDate || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .map((value) => new Date(`${value}T00:00:00`))
    .filter((value) => !Number.isNaN(value.getTime()) && Math.abs(value - today) <= 366 * 86400000)
    .sort((a, b) => Math.abs(a - today) - Math.abs(b - today))
  return dateKey(dated[0] || today)
}

function occursOn(course, dateString) {
  if (course.date === dateString) return true
  const date = new Date(`${dateString}T00:00:00`)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // 没有明确学期边界的旧课程不能无限递推到遥远年份。
  if (!course.termStartDate && !course.termEndDate && Math.abs(date - today) > 366 * 86400000) return false
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  if (Number(course.weekday) !== weekday) return false
  if (course.termStartDate && dateString < course.termStartDate) return false
  if (course.termEndDate && dateString > course.termEndDate) return false
  return true
}

function buildMonthCells(selectedDate, courses) {
  const selected = new Date(`${selectedDate}T00:00:00`)
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const key = dateKey(date)
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === selected.getMonth(),
      selected: key === selectedDate,
      courseCount: courses.filter((course) => occursOn(course, key)).length
    }
  })
}

Page({
  data: {
    friendId: '',
    commonOnly: false,
    profile: null,
    selectedDate: dateKey(new Date()),
    courses: [],
    dayCourses: [],
    monthCells: [],
    monthTitle: '',
    pageTitle: '',
    lang: 'zh',
    weekdays: ['一', '二', '三', '四', '五', '六', '日']
  },

  onLoad(options) {
    this.setData({ friendId: options.friendId || '', commonOnly: options.commonOnly === '1' })
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang }, () => {
      if (this._lastLoadAt && Date.now() - this._lastLoadAt < 30000) return
      this.loadData()
    })
  },

  async loadData() {
    try {
      const lang = this.data.lang
      if (this.data.commonOnly) {
        const [myCourses, profile, friendCourses] = await Promise.all([
          api.getSchedule(),
          api.getFriendProfile(this.data.friendId),
          api.getFriendSchedule(this.data.friendId)
        ])
        const myCodes = new Set(myCourses.map(c => (c.courseCode || c.title || '').trim().toUpperCase()).filter(Boolean))
        const common = friendCourses.filter(c => {
          const code = (c.courseCode || c.title || '').trim().toUpperCase()
          return code && myCodes.has(code)
        })
        const pageTitle = lang === 'en' ? `Common courses (${common.length})` : `共同课程（${common.length}门）`
        this.setData({ profile, courses: common, pageTitle, selectedDate: safeInitialDate(common) })
        wx.setNavigationBarTitle({ title: pageTitle })
        this.refresh()
        return
      }
      const [profile, courses] = await Promise.all([
        api.getFriendProfile(this.data.friendId),
        api.getFriendSchedule(this.data.friendId)
      ])
      const pageTitle = lang === 'en'
        ? `${profile.name || 'Contact'}'s shared schedule`
        : `${profile.name || '联系人'}的共享日程`
      const level = ((profile.friendPermission || {}).level) || (profile.friendScheduleShared ? 'busy' : 'none')
      const subtitleMap = {
        busy: lang === 'en' ? 'They only share busy/free status with you.' : '对方仅向你共享忙碌/空闲状态。',
        title: lang === 'en' ? 'They share course names and times with you (no places).' : '对方向你共享课程名称和时间（不含地点）。',
        detail: lang === 'en' ? 'They share their full schedule with you.' : '对方向你共享完整日程。'
      }
      this.setData({ profile, courses, pageTitle, subtitle: subtitleMap[level] || subtitleMap.busy, selectedDate: safeInitialDate(courses) })
      wx.setNavigationBarTitle({ title: pageTitle })
      this.refresh()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load schedule' : '共享日程加载失败'),
        icon: 'none'
      })
    }
  },

  onDate(event) {
    this.setData({ selectedDate: event.detail.value })
    this.refresh()
  },

  selectDate(event) {
    this.setData({ selectedDate: event.currentTarget.dataset.date })
    this.refresh()
  },

  shiftMonth(event) {
    const date = new Date(`${this.data.selectedDate}T00:00:00`)
    date.setMonth(date.getMonth() + Number(event.currentTarget.dataset.step))
    date.setDate(1)
    this.setData({ selectedDate: dateKey(date) })
    this.refresh()
  },

  refresh() {
    const selected = new Date(`${this.data.selectedDate}T00:00:00`)
    // 展示层去重：同一课程（代码+开始+结束+星期）只保留一条，
    // 避免数据源重复导致 iOS 端同一课程重复渲染（安卓端各自数据源无重复故无此现象）。
    const seen = new Set()
    const dayCourses = this.data.courses
      .filter((course) => occursOn(course, this.data.selectedDate))
      .filter((course) => {
        const key = `${course.courseCode || course.title || ''}|${course.start || ''}|${course.end || ''}|${course.weekday || ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => a.start.localeCompare(b.start))
    this.setData({
      dayCourses,
      monthCells: buildMonthCells(this.data.selectedDate, this.data.courses),
      monthTitle: `${selected.getFullYear()}年${selected.getMonth() + 1}月`
    })
  }
})
