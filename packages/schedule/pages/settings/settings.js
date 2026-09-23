const api = require('../../../../utils/api')

// 课程提醒订阅消息模板 ID：在微信公众平台订阅消息模板库申请后填入。
// 占位值无法发起订阅授权，替换为真实模板 ID 后「授权并预约」才会生效。
const COURSE_REMINDER_TEMPLATE_ID = 'REPLACE_WITH_COURSE_REMINDER_TEMPLATE_ID'

// 课程可在设置页的 AI 导入记录中删除；主日程页仍在栈内时必须同步失效，
// 否则它会在 30 秒缓存窗口内继续渲染已经删除的旧课程。
function refreshScheduleAfterCourseMutation() {
  const app = getApp()
  app.setCached('schedules', null)
  const schedulePage = getCurrentPages()
    .slice()
    .reverse()
    .find((page) => page.route === 'pages/schedule/schedule')
  if (!schedulePage) return
  schedulePage._lastLoadAt = 0
  schedulePage.loadData()
}

function formatImportTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '导入时间未知'
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function orderedImportCourses(courses, batchId) {
  const list = (courses || []).filter((course) => course.importBatchId === batchId)
  return list
    .map((course, position) => {
      const explicit = Number(course.ocrIndex)
      // 兼容早期记录：其 id 尾部保留了 mapOcrCourses 的零基顺序。
      const legacyMatch = String(course.id || '').match(/-(\d+)$/)
      const legacy = legacyMatch ? Number(legacyMatch[1]) + 1 : 0
      const verificationIndex = Number.isFinite(explicit) && explicit > 0 ? explicit : (legacy || position + 1)
      return Object.assign({}, course, { verificationIndex })
    })
    .sort((a, b) => a.verificationIndex - b.verificationIndex)
}

Page({
  data: {
    statusBarHeight: 20,

    weekCount: 20,
    weekPickerOpen: false,
    weekOptions: [],
    startDate: '2026-09-07',
    calendarOpen: false,
    calSelected: '',
    calMonths: [],
    weekStart: '周一',
    weekStartPickerOpen: false,



    hourOptions: [],
    aiImportBatches: [],
    aiImportBatchesLoading: false,
    deletingImportBatchId: '',
    importBatchDetailOpen: false,
    importBatchDetailLoading: false,
    selectedImportBatch: null,
    selectedImportCourses: [],
    selectedImportCourseCount: 0,
    importBatchVerificationLoading: false,
    importBatchVerificationPath: '',
    importBatchVerificationNotice: '',
    deletingCourseId: '',
    clearingCourses: false
  },

  onLoad(options = {}) {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null)
    this.setData({ statusBarHeight: win && win.statusBarHeight ? win.statusBarHeight : 20 })
    const opts = []
    for (let i = 10; i <= 30; i++) opts.push(i)
    const hours = []
    for (let h = 0; h < 24; h++) hours.push(h)
    const saved = wx.getStorageSync('weekStart')
    const savedStartDate = wx.getStorageSync('semesterStartDate')
    this.setData({
      weekOptions: opts,
      hourOptions: hours,
      weekStart: saved || '周一',
      startDate: savedStartDate || this.data.startDate,
      focusAiImports: options.focus === 'aiImports'
    })
    this.buildCalMonths()
    this.loadAiImportBatches()
  },

  onShow() {
    if (this._lastLoadAt && Date.now() - this._lastLoadAt < 30000) return
    this.loadAiImportBatches()
  },

  async loadAiImportBatches() {
    this.setData({ aiImportBatchesLoading: true })
    try {
      const batches = await api.listAiImportBatches()
      this.setData({
        aiImportBatches: (batches || []).map((batch) => Object.assign({}, batch, {
          displayTime: formatImportTime(batch.importedAt),
          previewText: (batch.preview || []).join('、') || '未命名课程'
        }))
      })
    } catch (error) {
      console.warn('[schedule settings] load AI import batches failed', error)
    } finally {
      this.setData({ aiImportBatchesLoading: false })
      this._lastLoadAt = Date.now()
    }
  },

  buildCalMonths() {
    const months = []
    for (let y = 2025; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const firstDay = new Date(y, m - 1, 1).getDay()
        const daysInMonth = new Date(y, m, 0).getDate()
        const days = []
        const offset = firstDay === 0 ? 6 : firstDay - 1
        for (let i = 0; i < offset; i++) days.push({ day: '', empty: true })
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          days.push({ day: d, empty: false, date: ds })
        }
        months.push({ year: y, month: m, label: `${y}年${m}月`, days })
      }
    }
    this.setData({ calMonths: months })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  switchSemester() {
    wx.navigateTo({ url: '/packages/schedule/pages/semester/semester' })
  },

  openWeekPicker() {
    this.setData({ weekPickerOpen: true })
  },

  closeWeekPicker() {
    this.setData({ weekPickerOpen: false })
  },

  selectWeekCount(e) {
    this.setData({ weekCount: Number(e.currentTarget.dataset.val) })
  },

  confirmWeekCount() {
    wx.setStorageSync('totalWeeks', this.data.weekCount)
    this.setData({ weekPickerOpen: false })
  },

  editWeekCount() {
    this.openWeekPicker()
  },

  editStartDate() {
    this.openCalendar()
  },

  // ----- 日历 -----
  openCalendar() {
    this.setData({ calendarOpen: true, calSelected: this.data.startDate })
  },

  closeCalendar() {
    this.setData({ calendarOpen: false })
  },

  selectCalDate(e) {
    this.setData({ calSelected: e.currentTarget.dataset.date })
  },

  confirmDate() {
    if (this.data.calSelected) {
      wx.setStorageSync('semesterStartDate', this.data.calSelected)
      this.setData({ startDate: this.data.calSelected, calendarOpen: false })
    }
  },

  openWeekStartPicker() {
    this.setData({ weekStartPickerOpen: true })
  },

  closeWeekStartPicker() {
    this.setData({ weekStartPickerOpen: false })
  },

  selectWeekStart(e) {
    this.setData({ weekStart: e.currentTarget.dataset.val })
  },

  confirmWeekStart() {
    wx.setStorageSync('weekStart', this.data.weekStart)
    this.setData({ weekStartPickerOpen: false })
  },

  editWeekStart() {
    this.openWeekStartPicker()
  },

  toggleDailyReminder(e) {
    this.setData({ dailyReminder: e.detail.value })
  },

  openTimePicker() {
    this.setData({ timePickerOpen: true })
  },

  closeTimePicker() {
    this.setData({ timePickerOpen: false })
  },

  selectRemindHour(e) {
    this.setData({ remindHour: Number(e.currentTarget.dataset.val) })
  },

  confirmRemindTime() {
    const h = this.data.remindHour
    this.setData({ remindTime: '当天' + h + ':00', timePickerOpen: false })
  },

  editRemindTime() {
    if (!this.data.dailyReminder) return
    this.openTimePicker()
  },

  // 阻止弹窗内容区域的点击事件冒泡到遮罩层
  noop() {},

  async openAiImportBatch(e) {
    const batchId = e.currentTarget.dataset.batchId
    const batch = this.data.aiImportBatches.find((item) => item.id === batchId)
    if (!batch) return
    // 每次打开详情生成一个令牌，避免用户快速切换记录时旧请求覆盖新记录。
    const requestToken = `${batchId}-${Date.now()}`
    this._importDetailRequestToken = requestToken
    this.setData({
      importBatchDetailOpen: true,
      // 课程列表优先从主课表缓存渲染，避免详情页被核验图请求阻塞。
      importBatchDetailLoading: false,
      selectedImportBatch: batch,
      selectedImportCourses: [],
      selectedImportCourseCount: Number(batch.courseCount) || 0,
      importBatchVerificationLoading: true,
      importBatchVerificationPath: '',
      importBatchVerificationNotice: ''
    })
    const app = getApp()
    const cachedCourses = app.getCached && app.getCached('schedules')
    if (Array.isArray(cachedCourses)) {
      const cachedImportCourses = orderedImportCourses(cachedCourses, batchId)
      this.setData({ selectedImportCourses: cachedImportCourses, selectedImportCourseCount: cachedImportCourses.length })
    }

    // 课程数据和核验图独立加载：图片慢或失效时不影响课程详情打开。
    api.getSchedule().then((courses) => {
      if (this._importDetailRequestToken !== requestToken) return
      const importCourses = orderedImportCourses(courses, batchId)
      this.setData({ selectedImportCourses: importCourses, selectedImportCourseCount: importCourses.length })
    }).catch((error) => {
      if (this._importDetailRequestToken === requestToken && !Array.isArray(cachedCourses)) {
        this.setData({ importBatchDetailLoading: false })
        wx.showToast({ title: (error && error.message) || '加载课程失败', icon: 'none' })
      }
    })

    api.getAiImportVerificationImage(batch).then(async (verification) => {
      if (this._importDetailRequestToken !== requestToken) return
      if (verification && verification.success && verification.filePath) {
        this.setData({ importBatchVerificationPath: verification.filePath, importBatchVerificationNotice: '' })
        // 老批次补存放到后台执行，不阻塞图片展示。
        if (verification.source !== 'storage') {
          try {
            const saved = await api.saveAiImportVerificationImage(batchId, verification.filePath, verification.mime, verification.fileID)
            if (this._importDetailRequestToken === requestToken) {
              batch.verificationFileId = saved.verificationFileId || batch.verificationFileId
              batch.verificationMime = saved.verificationMime || verification.mime
              batch.verificationStatus = 'available'
              this.setData({ selectedImportBatch: batch })
            }
          } catch (error) { /* 回存失败不影响查看 */ }
        }
      } else {
        this.setData({ importBatchVerificationNotice: '本次历史记录未保存核验图，且当前无法从识别服务补取。新识别完成后会自动保存。' })
      }
    }).catch(() => {
      if (this._importDetailRequestToken === requestToken) this.setData({ importBatchVerificationNotice: '核验图暂时无法加载，课程详情仍可正常查看。' })
    }).finally(() => {
      if (this._importDetailRequestToken === requestToken) this.setData({ importBatchVerificationLoading: false })
    })
  },

  closeImportBatchDetail() {
    this._importDetailRequestToken = ''
    this.setData({
      importBatchDetailOpen: false,
      selectedImportBatch: null,
      selectedImportCourses: [],
      selectedImportCourseCount: 0,
      importBatchVerificationPath: '',
      importBatchVerificationNotice: ''
    })
  },

  previewImportVerificationImage() {
    const current = this.data.importBatchVerificationPath
    if (!current) return
    wx.previewImage({ current, urls: [current] })
  },

  editImportedCourse(e) {
    const courseId = e.currentTarget.dataset.id
    if (!courseId) return
    const pages = getCurrentPages()
    const schedulePage = pages.slice().reverse().find((page) => page.route === 'pages/schedule/schedule')
    this.closeImportBatchDetail()
    if (schedulePage) {
      schedulePage.pendingEditCourseId = courseId
      wx.navigateBack()
      return
    }
    wx.navigateTo({ url: `/pages/schedule/schedule?editCourseId=${encodeURIComponent(courseId)}` })
  },

  deleteImportedCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const course = this.data.selectedImportCourses.find((item) => item.id === courseId)
    if (!course || this.data.deletingCourseId) return
    wx.showModal({
      title: '删除这门课程？',
      content: `只删除“${course.title || '未命名课程'}”，同一次识别中的其他课程会保留。`,
      confirmText: '删除课程',
      confirmColor: '#d94b4b',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ deletingCourseId: courseId })
        try {
          await api.deleteCourse(courseId)
          this.setData({ selectedImportCourses: this.data.selectedImportCourses.filter((item) => item.id !== courseId) })
          refreshScheduleAfterCourseMutation()
          await this.loadAiImportBatches()
          wx.showToast({ title: '课程已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '删除课程失败', icon: 'none' })
        } finally {
          this.setData({ deletingCourseId: '' })
        }
      }
    })
  },

  clearAllCourses() {
    if (this.data.clearingCourses) return
    wx.showModal({
      title: '清空当前账户课程？',
      content: '这会删除手动添加和所有 AI 导入的课程，删除后无法恢复。',
      confirmText: '继续',
      confirmColor: '#4e9d70',
      success: (firstResult) => {
        if (!firstResult.confirm) return
        wx.showModal({
          title: '最后确认',
          content: '确定清空当前账户的全部课程吗？',
          confirmText: '确认清空',
          confirmColor: '#4e9d70',
          success: async (secondResult) => {
            if (!secondResult.confirm) return
            this.setData({ clearingCourses: true })
            wx.showLoading({ title: '正在清空', mask: true })
            try {
              const response = await api.clearCourses()
              this.setData({ importBatchDetailOpen: false, selectedImportBatch: null, selectedImportCourses: [] })
              refreshScheduleAfterCourseMutation()
              await this.loadAiImportBatches()
              wx.showToast({ title: `已清空${response.removed || 0}门课程`, icon: 'success' })
            } catch (error) {
              wx.showToast({ title: (error && error.message) || '清空课程失败', icon: 'none' })
            } finally {
              wx.hideLoading()
              this.setData({ clearingCourses: false })
            }
          }
        })
      }
    })
  },

  deleteAiImportBatch(e) {
    const batchId = e.currentTarget.dataset.batchId
    const batch = this.data.aiImportBatches.find((item) => item.id === batchId)
    if (!batchId || !batch || this.data.deletingImportBatchId) return

    wx.showModal({
      title: '删除本次 AI 导入？',
      content: `将删除 ${batch.displayTime} 导入的 ${batch.courseCount} 门课程，其他课程不会受影响。`,
      confirmText: '删除本次',
      confirmColor: '#d94b4b',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ deletingImportBatchId: batchId })
        wx.showLoading({ title: '正在删除', mask: true })
        try {
          const response = await api.deleteAiImportBatch(batchId)
          refreshScheduleAfterCourseMutation()
          wx.showToast({ title: `已删除${response.removed || 0}门课程`, icon: 'success' })
          await this.loadAiImportBatches()
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '删除导入记录失败', icon: 'none' })
        } finally {
          wx.hideLoading()
          this.setData({ deletingImportBatchId: '' })
        }
      }
    })
  }
})
