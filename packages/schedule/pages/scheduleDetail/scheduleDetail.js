const api = require('../../../../utils/api')
const { dictionaries } = require('../../../../utils/i18n')
const { normalizeCourseWeeks, formatTeachingWeeks } = require('../../../../utils/courseWeeks')

// 高辨识度色板（浅色底 + 实色边），与 pages/schedule/schedule.js 的 COURSE_PALETTE 同序同色
const MACARON_COLORS = [
  { bg: 'rgba(99, 102, 241, 0.18)', border: '#6366F1' },  // 靛蓝
  { bg: 'rgba(14, 165, 233, 0.18)', border: '#0EA5E9' },  // 天蓝
  { bg: 'rgba(16, 185, 129, 0.18)', border: '#10B981' },  // 翡翠绿
  { bg: 'rgba(245, 158, 11, 0.18)', border: '#F59E0B' },   // 琥珀金
  { bg: 'rgba(239, 68, 68, 0.18)', border: '#EF4444' },   // 珊瑚红
  { bg: 'rgba(236, 72, 153, 0.18)', border: '#EC4899' },  // 玫粉
  { bg: 'rgba(139, 92, 246, 0.18)', border: '#8B5CF6' },  // 紫罗兰
  { bg: 'rgba(20, 184, 166, 0.18)', border: '#14B8A6' },  // 青绿
  { bg: 'rgba(249, 115, 22, 0.18)', border: '#F97316' },  // 橘橙
  { bg: 'rgba(132, 204, 22, 0.18)', border: '#84CC16' },  // 柠绿
]

// 与课表页相同的自动配色逻辑：去课型词后哈希，同一门课颜色稳定
function courseColorKey(str) {
  return String(str || '')
    .toUpperCase()
    .replace(/LECTURE|TUTORIAL|SEMINAR|PRACTICAL|WORKSHOP|LAB|讲座|实验|辅导|研讨|实践|习题|上机/g, '')
    .replace(/[^0-9A-Z一-龥]/g, '')
}

function getCourseColorIndex(title) {
  const key = courseColorKey(title)
  if (!key) return 0
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % MACARON_COLORS.length
}

function normalizeColorIdx(course) {
  return Number.isInteger(course.colorIdx) && course.colorIdx >= 0 && course.colorIdx < MACARON_COLORS.length
    ? course.colorIdx
    : -1
}

function resolveAccentColor(course, activeColorIdx) {
  const idx = activeColorIdx >= 0 ? activeColorIdx : getCourseColorIndex(course.courseCode || course.title)
  return MACARON_COLORS[idx].border
}

const weekLabels = {
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}

function formatWeeks(course, lang) {
  return formatTeachingWeeks(course, lang)
}

function sameCourseSeries(left, right) {
  const leftCode = String(left.courseCode || left.title || '').trim().toUpperCase()
  const rightCode = String(right.courseCode || right.title || '').trim().toUpperCase()
  return leftCode === rightCode &&
    String(left.section || '').trim().toUpperCase() === String(right.section || '').trim().toUpperCase() &&
    String(left.type || '').trim().toUpperCase() === String(right.type || '').trim().toUpperCase() &&
    Number(left.weekday) === Number(right.weekday) &&
    String(left.start || '') === String(right.start || '') &&
    String(left.end || '') === String(right.end || '')
}

Page({
  data: {
    lang: 'zh',
    t: {},
    course: null,
    weekLabel: '',
    showDeleteConfirm: false,
    loading: true,
    colorOptions: MACARON_COLORS.map((item, idx) => ({ idx, bg: item.bg, border: item.border })),
    activeColorIdx: -1,
    savedColorIdx: -1,
    colorSaving: false,
    accentColor: '',
    statusBarHeight: 20
  },

  onLoad(options) {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null)
    this.setData({
      lang,
      t: Object.assign({}, dictionaries[lang]),
      statusBarHeight: win && win.statusBarHeight ? win.statusBarHeight : 20
    })

    if (!options.id) {
      wx.showToast({ title: '缺少课程ID', icon: 'none' })
      wx.navigateBack()
      return
    }

    try {
      this.courseId = decodeURIComponent(String(options.id))
    } catch (_) {
      this.courseId = String(options.id)
    }
    this.sessionIndex = Number.isInteger(Number(options.sessionIndex)) ? Number(options.sessionIndex) : -1
    this.loadDetail()
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]) })
    if (this.courseId && this.data.course) {
      this.loadDetail()
    }
  },

  async loadDetail() {
    this.setData({ loading: true })
    try {
      // 主路径：从课表查找；失败时从全局缓存/重新请求兜底
      const app = getApp()
      const cachedSchedule = app.getCached ? app.getCached('schedules') : null
      // 从日程页点击进入时通常已有同一账户的缓存，先渲染详情，避免等待云函数。
      let courses = Array.isArray(cachedSchedule) ? cachedSchedule : await api.getSchedule().catch(() => [])
      let course = (courses || []).find(c => String(c.id || '') === String(this.courseId))
      // 兼容旧数据/导入数据：id 可能尚未标准化，使用 courseId 或组合键兜底匹配。
      if (!course) course = (courses || []).find(c => String(c.courseId || '') === String(this.courseId))
      if (!course) {
        if (cachedSchedule && Array.isArray(cachedSchedule)) {
          course = cachedSchedule.find(c => String(c.id || '') === String(this.courseId) || String(c.courseId || '') === String(this.courseId))
        }
      }
      if (this.sessionIndex >= 0 && Array.isArray(course.sessions) && course.sessions[this.sessionIndex]) {
        const session = course.sessions[this.sessionIndex]
        course = Object.assign({}, course, session, {
          id: course.id,
          title: course.title,
          courseCode: course.courseCode,
          section: course.section,
          type: session.type || course.type,
          date: session.date || '',
          weekday: session.weekday || course.weekday,
          week_set: session.weekSet || session.week_set || [],
          sessions: course.sessions
        })
        course._sessionParentId = course.id
        course._sessionIndex = this.sessionIndex
      }
      if (!course) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Course not found' : '课程未找到', icon: 'none' })
        wx.navigateBack()
        return
      }
      const weekday = Number(course.weekday) || 1
      const weekLabel = weekLabels[this.data.lang][weekday - 1] || ''
      // 已指定 session 时，严格使用该教学活动自己的周次；不能再用主课程
      // 或同系列课程汇总，否则 Tutorial(第2-5周) 会被覆盖成 Lecture(第1-5周)。
      const seriesWeeks = this.sessionIndex >= 0
        ? normalizeCourseWeeks(course)
        : Array.from(new Set(
          (courses || [])
            .filter((item) => sameCourseSeries(item, course))
            .flatMap((item) => normalizeCourseWeeks(item))
        )).sort((a, b) => a - b)
      const courseWithWeeks = seriesWeeks.length
        ? Object.assign({}, course, {
          week_set: seriesWeeks,
          weekStart: seriesWeeks[0],
          weekEnd: seriesWeeks[seriesWeeks.length - 1]
        })
        : course
      const sessions = Array.isArray(courseWithWeeks.sessions) && courseWithWeeks.sessions.length
        ? courseWithWeeks.sessions
        : [courseWithWeeks]

      wx.setNavigationBarTitle({
        title: this.data.lang === 'en' ? 'Course Detail' : '课程详情'
      })

      const activeColorIdx = normalizeColorIdx(courseWithWeeks)
      this.setData({
        course: Object.assign({}, courseWithWeeks, {
          weeksDisplay: formatWeeks(courseWithWeeks, this.data.lang),
          // WXML 不保证支持 Array.join() 方法调用；预先计算文本，避免鸿蒙真机渲染异常退出。
          reviewReasonsText: Array.isArray(courseWithWeeks.reviewReasons)
            ? courseWithWeeks.reviewReasons.filter(Boolean).join(this.data.lang === 'en' ? ', ' : '、')
            : '',
          sessionsDisplay: sessions.map((session) => Object.assign({}, session, {
            weeksDisplay: formatWeeks({ week_set: session.weekSet || session.week_set }, this.data.lang)
          }))
        }),
        weekLabel,
        loading: false,
        activeColorIdx,
        savedColorIdx: activeColorIdx,
        accentColor: resolveAccentColor(courseWithWeeks, activeColorIdx)
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Load failed' : '加载失败'),
        icon: 'none'
      })
    }
  },

  // 调色第一步：仅暂存选择并即时预览（标题色点/色板高亮），不写云端
  onColorPick(event) {
    if (!this.data.course || !this.data.course.id) return
    const idx = Number(event.currentTarget.dataset.idx)
    const colorIdx = Number.isInteger(idx) && idx >= 0 && idx < MACARON_COLORS.length ? idx : -1
    if (colorIdx === this.data.activeColorIdx) return

    const course = Object.assign({}, this.data.course, { colorIdx })
    this.setData({
      course,
      activeColorIdx: colorIdx,
      accentColor: resolveAccentColor(course, colorIdx)
    })
  },

  // 调色第二步：确认后持久化，同步课表页并自动返回周视图
  async confirmColorPick() {
    if (!this.data.course || !this.data.course.id) return
    if (this.data.colorSaving) return
    const colorIdx = this.data.activeColorIdx
    if (colorIdx === this.data.savedColorIdx) {
      // 未改动颜色，直接返回
      this.backToWeekView(colorIdx, false)
      return
    }
    this.setData({ colorSaving: true })
    try {
      const payload = Object.assign({}, this.data.course, { colorIdx })
      delete payload.weeksDisplay
      const result = await api.upsertCourse(payload)
      this.setData({ savedColorIdx: colorIdx, colorSaving: false })
      if (result && result.__cloudFailed) {
        wx.showToast({
          title: this.data.lang === 'en' ? 'Cloud unavailable, color not synced' : '云服务暂不可用，颜色暂未同步到云端',
          icon: 'none'
        })
      }
      this.backToWeekView(colorIdx, true)
    } catch (error) {
      this.setData({ colorSaving: false })
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Save failed' : '保存失败'),
        icon: 'none'
      })
    }
  },

  // 把新颜色写回课表页并切到该课程实际所在周后返回。
  backToWeekView(colorIdx, switchedToWeek) {
    const courseId = this.data.course.id
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    if (prevPage && prevPage.route === 'pages/schedule/schedule') {
      const nextCourses = (prevPage.data.courses || []).map((item) => (
        item.id === courseId ? Object.assign({}, item, { colorIdx }) : item
      ))
      prevPage.setData({ courses: nextCourses })
      if (switchedToWeek) {
        // showCourseInSchedule 自己负责返回上一页，避免这里再次 navigateBack 跳过日程页。
        this.showCourseInSchedule('week', nextCourses)
        return
      }
      if (typeof prevPage.refreshViews === 'function') prevPage.refreshViews(nextCourses)
    }
    wx.navigateBack()
  },

  openEdit() {
    if (!this.data.course) return
    const course = this.data.course
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]

    if (prevPage && prevPage.route === 'pages/schedule/schedule') {
      const editingCourse = typeof prevPage.prepareCourseForEditor === 'function'
        ? prevPage.prepareCourseForEditor(course)
        : course
      prevPage.setData({
        courseEditorOpen: true,
        editingCourse
      })
      prevPage.syncEditorCalendar(editingCourse.date)
      wx.navigateBack()
      return
    }

    wx.redirectTo({
      url: `/pages/schedule/schedule?editCourseId=${encodeURIComponent(course.id)}`
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  backToDayView() {
    this.showCourseInSchedule('day')
  },

  showCourseInWeek() {
    this.showCourseInSchedule('week')
  },

  // 以课程日期作为日历锚点，保证详情页返回后不会停在旧日期或旧周。
  showCourseInSchedule(viewMode, courses) {
    if (!this.data.course || !this.data.course.date) return
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    if (prevPage && prevPage.route === 'pages/schedule/schedule') {
      if (typeof prevPage.setSelectedDate === 'function') prevPage.setSelectedDate(this.data.course.date)
      prevPage.setData({
        courses: courses || prevPage.data.courses,
        viewMode,
        scheduleKind: 'course'
      }, () => {
        if (viewMode === 'week' && typeof prevPage.updateHourHeight === 'function') prevPage.updateHourHeight()
        if (typeof prevPage.refreshViews === 'function') prevPage.refreshViews(courses || prevPage.data.courses)
      })
    }
    wx.navigateBack()
  },

  confirmDelete() {
    this.setData({ showDeleteConfirm: true })
  },

  cancelDelete() {
    this.setData({ showDeleteConfirm: false })
  },

  async doDelete() {
    if (!this.data.course || !this.data.course.id) return
    const deletedId = this.data.course.id
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]

    // 先同步上一页的本地课表，避免周视图在返回前继续显示已删除课程。
    // 云端删除随后执行；失败时重新加载以恢复真实数据。
    const updatePreviousPage = () => {
      if (!prevPage || prevPage.route !== 'pages/schedule/schedule') return
      const nextCourses = (prevPage.data.courses || []).filter((item) => item.id !== deletedId)
      prevPage.setData({ courses: nextCourses }, () => {
        if (typeof prevPage.refreshViews === 'function') prevPage.refreshViews(nextCourses)
      })
      prevPage._lastLoadAt = 0
      const app = getApp()
      if (app && typeof app.setCached === 'function') app.setCached('schedules', nextCourses)
    }

    updatePreviousPage()
    try {
      await api.deleteCourse(deletedId)
      wx.showToast({
        title: this.data.lang === 'en' ? 'Deleted' : '已删除',
        icon: 'success'
      })

      if (prevPage && prevPage.route === 'pages/schedule/schedule') {
        // 后台校验云端状态，但不阻塞返回；loadData 内置并发保护。
        prevPage.loadData()
      }

      this.setData({ showDeleteConfirm: false })
      setTimeout(() => wx.navigateBack(), 400)
    } catch (error) {
      if (prevPage && prevPage.route === 'pages/schedule/schedule') prevPage.loadData()
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Delete failed' : '删除失败'),
        icon: 'none'
      })
      this.setData({ showDeleteConfirm: false })
    }
  },

  noop() {}
})
