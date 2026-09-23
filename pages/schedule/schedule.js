const api = require('../../utils/api')
const { isStatutoryHoliday, getCalendarMark } = require('../../utils/holidays')
const { dictionaries } = require('../../utils/i18n')
const { normalizeCourseWeeks, buildWeekSet, formatTeachingWeeks } = require('../../utils/courseWeeks')
const { getWindowInfo } = require('../../utils/device')
const { isCompanionEnabled } = require('../../utils/companionSettings')
const scheduleCache = require('../../utils/scheduleCache')

const STAGS = [
  { id: 'tag_study_01', zh: '图书馆卷王', en: 'Library King', category: 'study' },
  { id: 'tag_study_02', zh: '晨读党', en: 'Morning Reader', category: 'study' },
  { id: 'tag_study_03', zh: 'DDL战神', en: 'DDL Warrior', category: 'study' },
  { id: 'tag_study_04', zh: '笔记共享', en: 'Note Sharing', category: 'study' },
  { id: 'tag_study_05', zh: '期末抱佛脚', en: 'Last-Minute Crammer', category: 'study' },
  { id: 'tag_sport_01', zh: '健身撸铁', en: 'Gym Rat', category: 'sport' },
  { id: 'tag_sport_02', zh: '跑步', en: 'Runner', category: 'sport' },
  { id: 'tag_sport_03', zh: '羽毛球', en: 'Badminton', category: 'sport' },
  { id: 'tag_sport_04', zh: '游泳', en: 'Swimmer', category: 'sport' },
  { id: 'tag_sport_05', zh: '篮球', en: 'Basketball', category: 'sport' },
  { id: 'tag_sport_06', zh: '足球', en: 'Football', category: 'sport' },
  { id: 'tag_meal_01', zh: '食堂干饭人', en: 'Canteen Foodie', category: 'meal' },
  { id: 'tag_meal_02', zh: '外卖拼单', en: 'Takeout Grouper', category: 'meal' },
  { id: 'tag_meal_03', zh: '奶茶搭子', en: 'Milk Tea Buddy', category: 'meal' },
  { id: 'tag_meal_04', zh: '轻食主义', en: 'Light Eater', category: 'meal' },
  { id: 'tag_meal_05', zh: '探店打卡', en: 'Food Explorer', category: 'meal' },
  { id: 'tag_life_01', zh: '早睡早起', en: 'Early Bird', category: 'lifestyle' },
  { id: 'tag_life_02', zh: '夜猫子', en: 'Night Owl', category: 'lifestyle' },
  { id: 'tag_life_03', zh: '午休必睡', en: 'No Nap No Life', category: 'lifestyle' },
  { id: 'tag_ent_01', zh: '游戏开黑', en: 'Game Squad', category: 'entertainment' },
  { id: 'tag_ent_02', zh: '电影搭子', en: 'Movie Buddy', category: 'entertainment' },
  { id: 'tag_ent_03', zh: '逛展', en: 'Exhibition Goer', category: 'entertainment' },
  { id: 'tag_ent_04', zh: 'K歌', en: 'Karaoke', category: 'entertainment' },
  { id: 'tag_ent_05', zh: '桌游', en: 'Board Games', category: 'entertainment' }
]

// 高辨识度实色色板（实色填充 + 白色文字），与 schedule.wxss 的 .color-0 ~ .color-9 一一对应。
// 10 个色相在色环上均匀拉开（紫/蓝/青/绿/橙/金/粉/红/灰蓝/棕），饱和度高、两两不易混淆，
// 按课程键哈希自动分配，同一门课在所有时段颜色一致。
const COURSE_PALETTE = [
  { bg: '#6366F1', border: '#4F46E5' },  // 靛蓝
  { bg: '#0EA5E9', border: '#0284C7' },  // 天蓝
  { bg: '#10B981', border: '#059669' },  // 翡翠绿
  { bg: '#F59E0B', border: '#D97706' },  // 琥珀金
  { bg: '#EF4444', border: '#DC2626' },  // 珊瑚红
  { bg: '#EC4899', border: '#DB2777' },  // 玫粉
  { bg: '#8B5CF6', border: '#7C3AED' },  // 紫罗兰
  { bg: '#14B8A6', border: '#0D9488' },  // 青绿
  { bg: '#F97316', border: '#EA580C' },  // 橘橙
  { bg: '#84CC16', border: '#65A30D' }   // 柠绿
]
const MACARON_COLORS = COURSE_PALETTE

// 课程配色键：去掉课型词（Lecture/Tutorial 等）与符号，保证同一门课的不同课型、
// 不同时段得到同一个哈希，颜色稳定一致。
function courseColorKey(str) {
  return String(str || '')
    .toUpperCase()
    .replace(/LECTURE|TUTORIAL|SEMINAR|PRACTICAL|WORKSHOP|LAB|讲座|实验|辅导|研讨|实践|习题|上机/g, '')
    .replace(/[^0-9A-Z一-龥]/g, '')
}

// 根据课程（优先课程代码，其次标题）分配颜色索引
function getCourseColorIndex(title) {
  const key = courseColorKey(title)
  if (!key) return 0
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % MACARON_COLORS.length
}

// 课程配色的规范键：优先提取基础课程代码（字母 + 3 位数字），
// ebridge 导入的代码带课型后缀（如 IFB215TC=Lecture、IFB215TCT=Tutorial），去掉后缀；
// 无课程代码时退化为清理后的标题。
function courseColorKeyOf(course) {
  const raw = String((course && (course.courseCode || course.title)) || '').toUpperCase()
  const match = raw.match(/[A-Z]{2,}\d{3}/)
  if (match) return match[0]
  return courseColorKey(raw)
}

// ============ 按字头分色系配色 ============
// 规则：课号 + 地点都相同 → 完全同色；同字头（如 DTS、INF）的课程 → 同一色系的相近颜色。
// 色系基色在色环上均匀拉开，色系内成员通过亮度阶梯区分。

// 10 个色系基色（HSL 色相）。按色环跳跃取色排序，使相邻分配到的色系在色环上距离 ≥120°，
// 保证课表里同时出现的不同字头颜色差异足够大。
const FAMILY_HUES = [250, 22, 150, 322, 178, 45, 210, 355, 115, 82]
// 色系内成员的亮度阶梯（白字可读范围内）
const MEMBER_LIGHTS = [50, 40, 56, 34, 46]

function hslToHex(h, s, l) {
  const sn = s / 100
  const ln = l / 100
  const k = (n) => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return ('#' + to(f(0)) + to(f(8)) + to(f(4))).toUpperCase()
}

// 配色身份键：课程代码 + 地点（同课号同地点才是"同一门课"）
function courseColorIdentity(course) {
  return courseColorKeyOf(course) + '|' + String((course && course.place) || '').trim().toUpperCase()
}

// 色系键：课程代码的字母字头（DTS101 → DTS），无代码时归 OTHER
function courseColorFamily(baseKey) {
  const match = String(baseKey || '').match(/^[A-Z]+/)
  return match ? match[0] : 'OTHER'
}

// 为当前课表构建配色表：字头排序分配色系，色系内按身份键排序依次取亮度阶梯
function buildCourseColorContext(courses) {
  const idsByFamily = {}
  ;(courses || []).forEach((c) => {
    const family = courseColorFamily(courseColorKeyOf(c))
    if (!idsByFamily[family]) idsByFamily[family] = new Set()
    idsByFamily[family].add(courseColorIdentity(c))
  })
  const colors = {}
  Object.keys(idsByFamily).sort().forEach((family, fi) => {
    const hue = FAMILY_HUES[fi % FAMILY_HUES.length] + Math.floor(fi / FAMILY_HUES.length) * 7
    Array.from(idsByFamily[family]).sort().forEach((id, mi) => {
      const light = MEMBER_LIGHTS[mi % MEMBER_LIGHTS.length]
      const h = (hue + Math.floor(mi / MEMBER_LIGHTS.length) * 9) % 360
      colors[id] = hslToHex(h, 65, light)
    })
  })
  return { colors }
}

// 解析课程最终颜色：用户手动选色（>=0）优先，否则查课表配色表，再退化为色板哈希
function resolveCourseColor(course, colorCtx) {
  const manual = Number(course && course.colorIdx)
  if (Number.isInteger(manual) && manual >= 0 && manual < MACARON_COLORS.length) {
    return MACARON_COLORS[manual].bg
  }
  const id = courseColorIdentity(course)
  if (colorCtx && colorCtx.colors[id]) return colorCtx.colors[id]
  return MACARON_COLORS[getCourseColorIndex(courseColorKeyOf(course))].bg
}

// 每小时格子高度(rpx)，由 updateHourHeight 按可用高度动态计算（下限 76rpx 保证可读）
let HOUR_HEIGHT = 100
const MIN_HOUR_HEIGHT = 76
const START_HOUR = 0
const END_HOUR = 24

const DEFAULT_SEMESTER_START = '2026-09-07'

function getSemesterStart() {
  const saved = wx.getStorageSync('semesterStartDate') || DEFAULT_SEMESTER_START
  const date = new Date(`${saved}T00:00:00`)
  return Number.isNaN(date.getTime()) ? new Date(`${DEFAULT_SEMESTER_START}T00:00:00`) : date
}

function weekNumberForDate(value) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 1
  const diffDays = Math.floor((date - getSemesterStart()) / (1000 * 60 * 60 * 24))
  return Math.max(1, Math.min(getTotalWeeks(), Math.floor(diffDays / 7) + 1))
}

// 读取缓存的总周数，默认 20
function getTotalWeeks() {
  const total = Number(wx.getStorageSync('totalWeeks'))
  return Number.isInteger(total) && total >= 1 && total <= 60 ? total : 20
}

// 生成 1~totalWeeks 的周数选项
function buildWeekOptions() {
  const total = getTotalWeeks()
  return Array.from({ length: total }, (_, i) => i + 1)
}

function isSundayFirst(weekLabels = []) {
  return weekLabels[0] === '日' || weekLabels[0] === 'Sun'
}

// 根据周数和当前的周起始日计算日期，保证日期行与星期表头一一对应。
function calcWeekDatesForDate(value, weekLabels = []) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return calcWeekDates(1, weekLabels)
  const day = date.getDay()
  const offset = isSundayFirst(weekLabels) ? day : (day === 0 ? 6 : day - 1)
  date.setDate(date.getDate() - offset)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date)
    d.setDate(date.getDate() + i)
    return { day: d.getDate(), month: d.getMonth() + 1, key: dateKey(d) }
  })
}

function calcWeekDates(weekNum, weekLabels = []) {
  const firstDay = getSemesterStart()
  firstDay.setDate(firstDay.getDate() + (weekNum - 1) * 7)
  if (isSundayFirst(weekLabels)) firstDay.setDate(firstDay.getDate() - 1)
  const dates = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(firstDay)
    d.setDate(firstDay.getDate() + i)
    dates.push({
      day: d.getDate(),
      month: d.getMonth() + 1,
      key: dateKey(d)
    })
  }
  return dates
}

// 提取月份标签（如 "9月" 或 "9-10月"）
function getMonthLabel(dates) {
  const months = [...new Set(dates.map(d => d.month))]
  if (months.length === 1) return months[0] + '月'
  return months[0] + '-' + months[months.length - 1] + '月'
}

// 月份标签（按语言）：zh "9月" / en "Sep"
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function getMonthLabelForLang(dates, lang) {
  if (lang !== 'en') return getMonthLabel(dates)
  const months = [...new Set(dates.map(d => d.month))].map((m) => MONTH_SHORT_EN[m - 1])
  if (months.length === 1) return months[0]
  return months[0] + '-' + months[months.length - 1]
}

// 周数标签（按语言）：zh "第 X 周" / en "Week X"
function getWeekLabelForLang(week, lang) {
  return lang === 'en' ? 'Week ' + week : '第 ' + week + ' 周'
}

// 生成节次标签（序号）
function buildTimeSlots() {
  return Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => {
    const hour = START_HOUR + index
    return {
      label: `${String(hour).padStart(2, '0')}:00`,
      scrollId: `week-hour-${String(hour).padStart(2, '0')}`,
      terminal: hour === END_HOUR
    }
  })
}

// 计算课程在网格中的位置
function calcCoursePosition(course) {
  const startParts = (course.start || '08:00').split(':').map(Number)
  const endParts = (course.end || '09:00').split(':').map(Number)
  const startMin = startParts[0] * 60 + startParts[1]
  const endMin = endParts[0] * 60 + endParts[1]
  const baseMin = START_HOUR * 60

  const top = Math.max(0, ((startMin - baseMin) / 60) * HOUR_HEIGHT)
  const durationHours = Math.max(0.5, (endMin - startMin) / 60)
  const height = durationHours * HOUR_HEIGHT - 4

  return { top, height }
}

// 安全获取课程的星期几（1-7），缺失时从 date 推算
function getCourseWeekday(course) {
  // 识别到具体日期时，以日期推导星期为准，避免 OCR 同时返回的 weekday
  //（可能是 0-based 或文本映射）覆盖真实日期。
  if (course.date) {
    try {
      const d = new Date(`${course.date}T00:00:00`)
      if (!isNaN(d.getTime())) {
        const dw = d.getDay()
        return dw === 0 ? 7 : dw
      }
    } catch (_) {}
  }
  const w = Number(course.weekday)
  if (w >= 1 && w <= 7) return w
  return 0
}

function expandCourseSessions(courses) {
  return (courses || []).flatMap((course) => {
    if (!Array.isArray(course.sessions) || course.sessions.length <= 1) return [course]
    return course.sessions.map((session, index) => {
      const sessionWeeks = session.weekSet ?? session.week_set ?? session.weeks ?? session.weekNumbers
      const hasSessionWeeks = Array.isArray(sessionWeeks) ? sessionWeeks.length > 0 : Boolean(sessionWeeks)
      return Object.assign({}, course, {
      id: `${course.id}--session-${index}`,
      type: session.type || course.type,
      // 不要把主课程日期复制给其他教学活动；无具体日期时由 weekday + week_set 推导。
      date: session.date || (session.weekday ? '' : course.date),
      weekday: session.weekday || course.weekday,
      start: session.start || course.start,
      end: session.end || course.end,
      place: session.place || course.place,
      teacher: session.teacher || course.teacher,
      // 每个 session 必须使用自己识别出的周次；禁止回退到主课程周次，
      // 否则周 2-5 的活动会在周 1 被错误渲染。
      week_set: hasSessionWeeks ? sessionWeeks : [],
      sourceCourseId: course.id
      })
    })
  })
}

function courseBelongsToWeek(course, currentWeek) {
  const week = Number(currentWeek)
  if (!Number.isFinite(week) || week < 1) return true

  // OCR 周期课程的具体 date 可能只是识别结果中的示例日期；教学周集合才是
  // 权威来源。否则第 8 周课程会因 date 落在第 1 周而错误显示在第 1 周。
  const weeks = normalizeCourseWeeks(course)
  if (weeks.length) return weeks.includes(week)

  // 没有教学周集合时，才使用具体日期所在教学周。
  if (course.date) {
    const courseDate = new Date(`${course.date}T00:00:00`)
    if (!Number.isNaN(courseDate.getTime())) {
      const diffDays = Math.floor((courseDate - getSemesterStart()) / (1000 * 60 * 60 * 24))
      const courseWeek = Math.floor(diffDays / 7) + 1
      if (courseWeek >= 1 && courseWeek <= getTotalWeeks()) return courseWeek === week
    }
  }

  // 展开的 OCR 教学活动必须有自己的周次；缺失时禁止猜测或继承，避免
  // 在第 1 周等页面错误显示。手动课程（非 session）仍保持兼容。
  if (course.sourceCourseId) return false

  // 历史手动课程缺少周次时，保留显示。
  return true
}

// 构建每日课程列数据
function buildDayCols(courses, weekLabels, currentWeek, colorCtx) {
  const weekDates = calcWeekDates(currentWeek, weekLabels)
  const cols = weekLabels.map((label, dayIdx) => {
    const startsOnSunday = isSundayFirst(weekLabels)
    const expectedWeekday = startsOnSunday
      ? (dayIdx === 0 ? 7 : dayIdx)
      : dayIdx + 1
    const holidayDate = weekDates[dayIdx] && weekDates[dayIdx].key
    const dayCourses = courses
      .filter((c) => {
        // 优先用 weekday 字段，缺失或无效时从 date 推算
        const w = getCourseWeekday(c)
        return w === expectedWeekday && courseBelongsToWeek(c, currentWeek)
      })
      .sort((a, b) => (a.start || '00:00').localeCompare(b.start || '00:00'))
      .map((c) => {
        const pos = calcCoursePosition(c)
        return {
          ...c,
          top: pos.top,
          height: pos.height,
          colorHex: resolveCourseColor(c, colorCtx),
          holiday: Boolean(holidayDate && isStatutoryHoliday(holidayDate)),
          calendarMark: holidayDate ? getCalendarMark(holidayDate) : null
        }
      })
    return { label, holiday: Boolean(holidayDate && isStatutoryHoliday(holidayDate)), holidayDate, calendarMark: holidayDate ? getCalendarMark(holidayDate) : null, courses: dayCourses }
  })
  return cols
}

const today = new Date()

const AI_IMPORT_EXPECTED_SECONDS = 45

function getAiImportCopy(lang) {
  if (lang === 'en') {
    return {
      durationHint: 'Usually takes 30 to 60 seconds',
      preparing: 'Preparing timetable image',
      uploading: 'Uploading securely',
      queued: 'Waiting for an available AI worker',
      cutting: 'Cropping the timetable layout',
      recognizing: 'AI is reading your timetable',
      parsing: 'Organizing course details',
      saving: 'Saving courses to your schedule',
      remaining: 'About %s seconds remaining',
      calculating: 'Calculating remaining time',
      processing: 'Still processing. Please keep this page open.',
      elapsed: 'Elapsed %s seconds',
      steps: ['Prepare', 'Upload', 'Recognize', 'Save']
    }
  }
  return {
    durationHint: '通常需要约 30-60 秒',
    preparing: '正在准备课表图片',
    uploading: '正在安全上传',
    queued: '正在等待 AI 服务处理',
    cutting: '正在裁剪课表区域',
    recognizing: 'AI 正在识别课程信息',
    parsing: '正在整理课程信息',
    saving: '正在保存到我的课表',
    remaining: '预计还需约 %s 秒',
    calculating: '正在计算预计时间',
    processing: '正在继续识别，请保持页面打开',
    elapsed: '已用时 %s 秒',
    steps: ['准备图片', '上传图片', 'AI 识别', '保存课程']
  }
}

function buildAiImportStages(activeIndex, lang) {
  const labels = getAiImportCopy(lang).steps
  return labels.map((label, index) => ({
    label,
    order: index + 1,
    state: index < activeIndex ? 'done' : (index === activeIndex ? 'active' : 'pending')
  }))
}

function getAiImportStage(phase, lang) {
  const copy = getAiImportCopy(lang)
  const stages = {
    preparing: { index: 0, text: copy.preparing },
    uploading: { index: 1, text: copy.uploading },
    submitting: { index: 1, text: copy.uploading },
    queued: { index: 2, text: copy.queued },
    cutting: { index: 2, text: copy.cutting },
    processing: { index: 2, text: copy.recognizing },
    recognizing: { index: 2, text: copy.recognizing },
    parsing: { index: 2, text: copy.parsing },
    organizing: { index: 2, text: copy.recognizing },
    saving: { index: 3, text: copy.saving },
    done: { index: 3, text: copy.saving }
  }
  return stages[phase] || stages.preparing
}

function formatImportTimings(timings, lang) {
  if (!timings || typeof timings !== 'object') return ''
  const total = timings.total_ms || timings.totalMs
  if (!Number.isFinite(Number(total))) return ''
  const prefix = lang === 'en' ? 'Recognition time' : '识别耗时'
  return `${prefix} ${Math.max(0.1, Number(total) / 1000).toFixed(1)}s`
}

function getReviewReasons(fields, lang) {
  const labels = lang === 'en'
    ? { title: 'course title missing', date: 'date missing', time: 'time missing', place: 'location missing', weeks: 'teaching weeks missing' }
    : { title: '缺少课程名称', date: '缺少上课日期', time: '缺少上课时间', place: '缺少上课地点', weeks: '缺少教学周' }
  return (fields || []).map((field) => labels[field]).filter(Boolean)
}

function enrichCourseReview(course, lang) {
  const fields = Array.isArray(course.missingFields) ? course.missingFields : []
  const validationStatus = String(course.validationStatus || course.validation || '').toLowerCase()
  const validationNeedsReview = ['fix', 'needs_review', 'review', 'invalid', 'error'].includes(validationStatus)
  const needsReview = course.needsReview === true || validationNeedsReview || (course.source === 'ocr' && fields.length > 0)
  const reviewReasons = fields.length ? getReviewReasons(fields, lang) : (course.reviewReasons || [])
  return Object.assign({}, course, {
    needsReview,
    reviewReasons,
    missingInfoText: reviewReasons.join(lang === 'en' ? ', ' : '、')
  })
}

function removeReviewField(course, field, lang) {
  const missingFields = (course.missingFields || []).filter((item) => item !== field)
  return Object.assign({}, course, {
    missingFields,
    needsReview: missingFields.length > 0,
    reviewReasons: getReviewReasons(missingFields, lang),
    confirmed: missingFields.length === 0 ? true : course.confirmed
  })
}

function courseSeriesKey(course) {
  return [
    course.courseCode || course.title || '',
    course.section || '',
    course.type || '',
    getCourseWeekday(course),
    course.start || '',
    course.end || ''
  ].map((value) => String(value).trim().toLowerCase()).join('|')
}

function weekFromCourseDate(course) {
  if (!course.date) return 0
  const date = new Date(`${course.date}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0
  const diffDays = Math.floor((date - getSemesterStart()) / (1000 * 60 * 60 * 24))
  const week = Math.floor(diffDays / 7) + 1
  return week >= 1 && week <= 60 ? week : 0
}

function groupReviewCourses(courses, lang) {
  const groups = new Map()
  ;(courses || []).filter((course) => course.needsReview).forEach((course) => {
    const key = courseSeriesKey(course)
    const group = groups.get(key) || {
      course: Object.assign({}, course),
      ids: [],
      weeks: new Set(),
      missingFields: new Set()
    }
    group.ids.push(course.id)
    normalizeCourseWeeks(course).forEach((week) => group.weeks.add(week))
    const dateWeek = weekFromCourseDate(course)
    if (dateWeek) group.weeks.add(dateWeek)
    ;(course.missingFields || []).forEach((field) => group.missingFields.add(field))
    groups.set(key, group)
  })

  return Array.from(groups.values()).map((group) => {
    const weeks = Array.from(group.weeks).sort((a, b) => a - b)
    const missingFields = Array.from(group.missingFields)
    const reviewReasons = getReviewReasons(missingFields, lang)
    const occurrenceText = lang === 'en'
      ? `${group.ids.length} occurrence(s)`
      : `${group.ids.length} 个上课日期`
    const weekText = weeks.length ? formatTeachingWeeks({ week_set: weeks }, lang) : ''
    return Object.assign({}, group.course, {
      seriesIds: group.ids,
      occurrenceCount: group.ids.length,
      week_set: weeks,
      weekStart: weeks[0] || group.course.weekStart,
      weekEnd: weeks[weeks.length - 1] || group.course.weekEnd,
      missingFields,
      reviewReasons,
      missingInfoText: reviewReasons.join(lang === 'en' ? ', ' : '、'),
      reviewSeriesText: [occurrenceText, weekText].filter(Boolean).join(' · ')
    })
  })
}

function prepareEditableCourse(course) {
  const weeks = normalizeCourseWeeks(course)
  // OCR/周期课程可能没有具体 date；编辑器仍需要一个有效日期作为日历锚点。
  // 使用学期起始日 + 首个教学周 + weekday，避免 NaN/null 传入月历。
  let date = course && course.date
  if (!date) {
    const weekday = Number(course && course.weekday)
    if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) {
      const anchor = getSemesterStart()
      anchor.setDate(anchor.getDate() + ((weeks[0] || 1) - 1) * 7 + weekday - 1)
      date = dateKey(anchor)
    }
  }
  const editorWeekOptions = Array.from({ length: 13 }, (_, index) => ({ week: index + 1, selected: weeks.includes(index + 1) }))
  return Object.assign({
    courseCode: '',
    section: '',
    term: '2025-26-S2',
    confirmed: true
  }, course, { date, editorWeekOptions,
    // 编辑器已改为逐周点选，禁止残留起止周范围重新补齐跳过的周次。
    week_set: weeks,
    weekStart: '',
    weekEnd: '',
    week_start: '',
    week_end: ''
  })
}

const text = {
  zh: {
    title: '日程',
    courseTable: '课程表',
    activityTable: '匹配',
    addSchedule: '手动添加',
    aiImport: 'AI 录入',
    day: '日',
    week: '周',
    month: '月',
    selectedDate: '当前日期',
    emptyTitle: '暂无日程',
    emptyDesc: '可手动添加课程，或使用 AI 上传课表截图。',
    emptyActivityTitle: '这一天还没有活动',
    emptyActivityDesc: '在活动详情里加入活动表后，会显示在这里。',
    addTitle: '添加日程',
    editTitle: '编辑日程',
    addSubtitle: '先点选日期，再填写标题、时间和地点。',
    courseTitle: '标题',
    courseType: '类型',
    coursePlace: '地点',
    courseTeacher: '老师（选填）',
    courseColor: '课程颜色',
    colorAuto: '自动',
    courseStart: '开始',
    courseEnd: '结束',
    courseSave: '保存',
    courseDelete: '删除',
    cancel: '取消',
    close: '关闭',
    importReady: '上传 eBridge 周课表截图后，我会识别课程块、时间、星期和地点，并写入你的日程。',
    aiGuideTitle: '课表截图参考',
    aiGuideTips: ['使用 eBridge 周视图完整截图', '课程名称、时间、地点清晰可见', '包含周一至周日整周与左侧时间轴', '图片端正、无遮挡、不模糊'],
    aiGuideConfirm: '选择截图',
    aiResultTitle: 'AI 识别结果',
    aiResultOk: '识别成功',
    aiResultFix: '待补全',
    aiResultLegendOk: '绿色 = 识别成功',
    aiResultLegendFix: '红色 = 需人工确认',
    aiResultDone: '完成',
    aiResultReview: '查看待补全课程',
    voiceTitle: '语音录入日程',
    voiceTemplate: '周一上午10点到12点，DTS101 的 Lecture，教室 TC-D-201，第1到16周。周三下午2点到4点，CCT009 的 Tutorial，教室 MB106，第1到16周。',
    voiceHint: '按住下方按钮，照着模板念出你的课程；说完后可以直接修改文字。',
    voiceHold: '按住 说话',
    voiceRelease: '正在聆听，松开结束',
    voicePlaceholder: '也可以直接在这里输入课程安排……',
    voiceSubmit: '整理并写入课表',
    voiceUnavailable: '语音识别暂不可用，可先手动输入',
    voiceEmpty: '没听出课程，试试照着模板再说一遍',
    voiceRecognizeFail: '识别失败，请重试',
    importDone: '课程已导入，建议切到周视图检查星期和时间。',
    recognitionResult: 'AI 识别结果',
    monthTapHint: '点击日期可切换',
    aiSuccess: 'AI 已写入课程表',
    requiredTitle: '请先填写标题',
    logoutShort: '退出',
    courseMatch: '课程匹配',
    weekCourseMatch: '匹配',

    shareReserve: '分享日程',

    shareTodo: '分享入口已预留',
    addScheduleDesc: '录入课程或临时安排',
    aiImportDesc: '上传课表截图占位入口',

    shareReserveDesc: '转发或共享日程入口',
    matchModuleTitle: '匹配',
    matchModuleDesc: '基于课表智能匹配课搭子、学习搭子、饭搭子、运动搭子、自习搭子、娱乐搭子。',
    studyBuddy: '找搭子',
    studyBuddyDesc: '6种搭子智能推荐',
    courseMatchDesc: '从课程进入同课匹配',
    teamRequest: '组队广场',
    teamRequestDesc: '浏览招募帖',
    scheduleMatch: '日程匹配',
    scheduleMatchDesc: '多人共同空闲'
  },
  en: {
    title: 'Schedule',
    courseTable: 'Courses',
    activityTable: 'Activities',
    addSchedule: 'Add manually',
    aiImport: 'AI import',
    day: 'Day',
    week: 'Week',
    month: 'Month',
    selectedDate: 'Selected date',
    emptyTitle: 'No schedule yet',
    emptyDesc: 'Add a course manually or upload a timetable screenshot with AI.',
    emptyActivityTitle: 'No activity on this day',
    emptyActivityDesc: 'Add activities from detail pages and they will appear here.',
    addTitle: 'Add schedule',
    editTitle: 'Edit schedule',
    addSubtitle: 'Pick a date, then fill in title, time, and place.',
    courseTitle: 'Title',
    courseType: 'Type',
    coursePlace: 'Place',
    courseTeacher: 'Teacher (optional)',
    courseColor: 'Course color',
    colorAuto: 'Auto',
    courseStart: 'Start',
    courseEnd: 'End',
    courseSave: 'Save',
    courseDelete: 'Delete',
    cancel: 'Cancel',
    close: 'Close',
    importReady: 'Upload an eBridge timetable screenshot and I will extract blocks, time, weekdays, and locations into your schedule.',
    aiGuideTitle: 'Screenshot guide',
    aiGuideTips: ['Use a full eBridge weekly-view screenshot', 'Course names, times and rooms must be legible', 'Include the whole Mon–Sun week and the time axis', 'Keep the image upright, clear and unobstructed'],
    aiGuideConfirm: 'Choose screenshot',
    aiResultTitle: 'AI recognition result',
    aiResultOk: 'Recognized',
    aiResultFix: 'Needs review',
    aiResultLegendOk: 'Green = recognized',
    aiResultLegendFix: 'Red = needs review',
    aiResultDone: 'Done',
    aiResultReview: 'Review incomplete courses',
    voiceTitle: 'Voice input',
    voiceTemplate: 'Monday 10am to 12pm, DTS101 Lecture, room TC-D-201, weeks 1 to 16. Wednesday 2pm to 4pm, CCT009 Tutorial, room MB106, weeks 1 to 16.',
    voiceHint: 'Hold the button below and read your courses like the template; you can edit the text afterwards.',
    voiceHold: 'Hold to talk',
    voiceRelease: 'Listening… release to finish',
    voicePlaceholder: 'Or type your course schedule here…',
    voiceSubmit: 'Organize & add to schedule',
    voiceUnavailable: 'Voice recognition is unavailable; please type instead',
    voiceEmpty: 'No course recognized. Try reading the template again.',
    voiceRecognizeFail: 'Recognition failed, please try again',
    importDone: 'Courses imported. Check weekday and time in week view.',
    recognitionResult: 'AI results',
    monthTapHint: 'Tap the date to change',
    aiSuccess: 'Courses imported',
    requiredTitle: 'Please enter a title',
    logoutShort: 'Log out',
    courseMatch: 'Course match',
    weekCourseMatch: 'Match',

    shareReserve: 'Share schedule',

    shareTodo: 'Share entry reserved',
    addScheduleDesc: 'Add courses or plans',
    aiImportDesc: 'Upload timetable image',

    shareReserveDesc: 'Share schedule entry',
    matchModuleTitle: 'Match',
    matchModuleDesc: 'Smart matching for course, study, meal, sport, self-study & entertainment buddies.',
    studyBuddy: 'Find Buddy',
    studyBuddyDesc: '6 types smart match',
    courseMatchDesc: 'Match by selected course',
    teamRequest: 'Team Square',
    teamRequestDesc: 'Browse team posts',
    scheduleMatch: 'Schedule match',
    scheduleMatchDesc: 'Shared free time'
  }
}

const weekLabels = {
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function weekdayFromDate(dateString) {
  const weekday = new Date(`${dateString}T00:00:00`).getDay()
  return weekday === 0 ? 7 : weekday
}

function weekdayLabel(dateString, lang) {
  return weekLabels[lang][weekdayFromDate(dateString) - 1]
}

// 课程可能只有 weekday + week_set（OCR/周期课程），没有具体 date。
// 统一计算其实际发生日期，供日/月视图使用，避免三种视图数据不一致。
function courseOccurrenceDates(course) {
  if (!course) return []
  const weekday = getCourseWeekday(course)
  if (!weekday) return []
  const weeks = normalizeCourseWeeks(course)
  if (!weeks.length && course.date && /^\d{4}-\d{2}-\d{2}$/.test(String(course.date))) return [String(course.date)]
  if (!weeks.length) return []
  const semester = getSemesterStart()
  return weeks.map((week) => {
    const date = new Date(semester)
    date.setDate(date.getDate() + (week - 1) * 7 + weekday - 1)
    return dateKey(date)
  })
}

function buildMonthCells(year, month, courses, activities, kind, selectedDate, colorCtx) {
  const first = new Date(year, month - 1, 1)
  const startOffset = (first.getDay() + 6) % 7
  const gridStart = new Date(year, month - 1, 1 - startOffset)

  const cells = Array.from({ length: 42 }).map((_, index) => {
    const current = new Date(gridStart)
    current.setDate(gridStart.getDate() + index)
    const key = dateKey(current)
    const items = kind === 'course'
      ? courses.filter((item) => courseOccurrenceDates(item).includes(key)).slice(0, 3).map((item) => Object.assign({}, item, {
        // 月视图日程彩色显示：与周视图同一套配色规则
        colorHex: resolveCourseColor(item, colorCtx),
        weekText: normalizeCourseWeeks(item).join('、')
      }))
      : activities.filter((item) => item.date === key).slice(0, 3).map((item) => ({
        id: item.id,
        start: item.start,
        title: item.title
      }))

    return {
      day: current.getDate(),
      date: key,
      inMonth: current.getMonth() === month - 1,
      isToday: key === dateKey(new Date()),
      selected: key === selectedDate,
      holiday: isStatutoryHoliday(key),
      calendarMark: getCalendarMark(key),
      items
    }
  })

  // 点选只高亮单个格子，不再整周行高亮
  return cells
}

function createEmptyCourse(date, lang) {
  return {
    id: '',
    title: '',
    date,
    weekday: weekdayFromDate(date),
    start: '09:00',
    end: '10:00',
    place: '',
    teacher: '',
    courseCode: '',
    section: '',
    term: '2025-26-S2',
    confirmed: true,
    colorIdx: -1,
    type: lang === 'en' ? 'Course' : '课程',
    editorWeekOptions: Array.from({ length: 13 }, (_, index) => ({ week: index + 1, selected: false }))
  }
}

Page({
  data: {
    user: null,
    lang: 'zh',
    t: Object.assign({}, dictionaries.zh, text.zh),
    selectedDate: dateKey(today),
    selectedWeekdayLabel: weekdayLabel(dateKey(today), 'zh'),
    monthWeekdays: weekLabels.zh,
    currentView: 'schedule',
    // 匹配引导气泡
    matchGuideVisible: false,
    matchGuideIndex: 0,
    matchGuideTexts: [],
    matchGuideTimer: null,
    viewMode: 'week',
    scheduleKind: 'course',
    courses: [],
    activitySchedule: [],
    todayCourses: [],
    todayActivities: [],
    monthCells: [],
    monthTitle: '',
    importBlocks: [],
    importing: false,
    aiGuideOpen: false,
    // 语音录入日程弹窗
    voiceImportOpen: false,
    voiceText: '',
    voiceRecording: false,
    voiceAvailable: false,
    voiceParsing: false,
    aiResultOpen: false,
    verificationImagePath: '',
    verificationImageKind: '',
    verificationNotice: '',
    aiResultCourses: [],
    aiResultIncomplete: 0,
    importProgress: 0,
    importProgressDetail: '',
    importStatus: '',
    importDurationHint: '',
    importTimeHint: '',
    importStages: [],
    importTimingText: '',
    reviewCourses: [],
    reviewModalOpen: false,
    courseEditorOpen: false,
    courseSaving: false,
    editingCourse: createEmptyCourse(dateKey(today), 'zh'),
    courseColorOptions: MACARON_COLORS.map((item, idx) => ({ idx, bg: item.bg, border: item.border })),
    editorWeekdayLabel: weekdayLabel(dateKey(today), 'zh'),
    editorMonthYear: today.getFullYear(),
    editorMonthMonth: today.getMonth() + 1,
    editorMonthTitle: '',
    editorWeekOptions: [],
    editorMonthCells: [],
    // 标签选择
    tagPickerOpen: false,
    tagSelected: [],
    tagGroups: [],
    tagBtnText: '标签',
    // ===== 新布局字段 =====
    weekDayHeaders: (() => {
      const ws = wx.getStorageSync('weekStart') || '周一'
      return ws === '周日' ? ['日', '一', '二', '三', '四', '五', '六'] : ['一', '二', '三', '四', '五', '六', '日']
    })(),
    timeSlots: buildTimeSlots(),
    weekScrollTarget: '', // 初始从 00:00 开始，不自动滚动
    hourHeight: HOUR_HEIGHT,
    gridScrollHeight: 900, // onReady 后由 updateHourHeight 按真实可用高度校正
    dayCols: [],
    semesterLabel: '第1周 2026-2027第一学期',
    settingsPopupOpen: false,
    plusPopupOpen: false,
    // 课程导出 .ics 状态
    exportingIcs: false,
    isGuest: false,
    // 噗噗助手开关：关闭时日程页恢复旧 FAB「+」作为手动/AI 录入口
    companionOn: true,
    statusBarHeight: 20,
    themePrimary: '#7c83c7',
    detailPopup: { show: false, course: {} },
    // 新手引导
    introGuideVisible: false,
    introSteps: [],
    // 周选择
    currentWeek: (() => {
      return weekNumberForDate(new Date())
    })(),
    weekPickerOpen: false,
    weekOptions: buildWeekOptions(),
    dateHeaders: [],
    monthLabel: '',
    currentMonthText: (() => {
      const d = new Date()
      return (d.getMonth() + 1) + '月'
    })(),
  },

  onLoad(options = {}) {
    const windowInfo = getWindowInfo()
    this.setData({ statusBarHeight: Number(windowInfo.statusBarHeight) || 20 })
    if (options.date) {
      this.pendingFocus = {
        date: options.date,
        // 匹配功能已隐藏：外部跳转带 scheduleKind=activity 时统一回到课程表
        scheduleKind: 'course',
        viewMode: options.viewMode || 'week'
      }
    }
    if (options.editCourseId) this.pendingEditCourseId = decodeURIComponent(options.editCourseId)
  },

  onShow() {
    const app = getApp()
    const isGuest = app.isLoggedIn ? !app.isLoggedIn() : false
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const pendingFocus = this.pendingFocus
    const selectedDate = pendingFocus && pendingFocus.date
      ? pendingFocus.date
      : (this.data.selectedDate || dateKey(new Date()))
    const weekStart = wx.getStorageSync('weekStart') || '周一'
    const langChanged = this._lastLang !== lang
    const weekStartChanged = this._lastWeekStart !== weekStart
    // 同步总周数：重新生成选项并修正越界周数
    const weekOptions = buildWeekOptions()
    const currentWeek = weekNumberForDate(selectedDate)
    const selectedDateObj = new Date(`${selectedDate}T00:00:00`)
    const patch = {
      lang,
      isGuest,
      companionOn: isCompanionEnabled(),
      selectedDate,
      selectedWeekdayLabel: weekdayLabel(selectedDate, lang),
      scheduleKind: pendingFocus && pendingFocus.scheduleKind ? pendingFocus.scheduleKind : this.data.scheduleKind,
      viewMode: pendingFocus && pendingFocus.viewMode ? pendingFocus.viewMode : this.data.viewMode,
      weekOptions,
      currentWeek,
      currentMonthText: lang === 'en' ? MONTH_SHORT_EN[selectedDateObj.getMonth()] : (selectedDateObj.getMonth() + 1) + '月',
      weekLabelText: getWeekLabelForLang(currentWeek, lang)
    }
    // 语言未变时跳过整个文案字典的大对象 setData，避免切 tab 时的全量 diff
    if (langChanged) {
      patch.t = Object.assign({}, dictionaries[lang], text[lang])
      patch.monthWeekdays = weekLabels[lang]
    }
    if (langChanged || weekStartChanged) {
      const baseHeaders = lang === 'en' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['一', '二', '三', '四', '五', '六', '日']
      patch.weekDayHeaders = weekStart === '周日' ? ['日', '一', '二', '三', '四', '五', '六'] : baseHeaders
    }
    this._lastLang = lang
    this._lastWeekStart = weekStart
    // 已登录用户每次打开日程页时固定到周视图并对齐 09:00；带明确定位参数的跳转除外。
    if (!isGuest && !pendingFocus) {
      patch.viewMode = 'week'
      patch.weekScrollTarget = 'week-hour-09'
    }
    this.setData(patch, () => {
      this.updateWeekView(currentWeek)
      this.updateHourHeight()
      // 游客只渲染空课表框架，不加载个人数据
      if (isGuest) return
      const cacheFresh = !pendingFocus && this._lastLoadAt && Date.now() - this._lastLoadAt < 30000
      // 缓存新鲜时数据无变化，仅当语言/周起始变化影响视图构建时才重算，
      // 否则 refreshViews 的全量 enrich + 大 setData 纯属浪费（切回日程 tab 卡顿的根因）
      if (cacheFresh) {
        if (langChanged || weekStartChanged) this.refreshViews()
      } else {
        this.loadData()
      }
    })
    if (pendingFocus) {
      this.pendingFocus = null
    }
    // 从其他 tab 页的小章鱼助手跳转过来：自动打开 AI 上传课表流程
    if (!isGuest && app.globalData && app.globalData.pendingAiImport) {
      app.globalData.pendingAiImport = false
      setTimeout(() => this.openAiImport(), 400)
    }
    // 新手引导入口：延迟执行确保 DOM 渲染完毕
    setTimeout(() => this.checkIntroGuide(), 600)
  },

  onUnload() {
    this.stopAiImportTimer()
  },

  async loadData() {
    // 防止快速切换页面/卡片时并发加载互相覆盖
    if (this._loading) return
    this._loading = true
    const app = getApp()

    try {
      // 先尝试全局缓存，命中则立即渲染，后台异步刷新
      const cachedUser = app.getCached('me') || (app.getUserInfo ? app.getUserInfo() : null)
      const cachedSchedules = app.getCached('schedules')
      if (cachedUser && cachedSchedules && this.data.courses.length === 0) {
        this.setData({ user: cachedUser, courses: cachedSchedules })
        this.refreshViews(cachedSchedules)
        this._renderedSnapshot = scheduleCache.scheduleSnapshot(cachedSchedules, this.data.activitySchedule)
      }

      // 冷启动时全局内存缓存为空（app 刚启动、prefetch 未命中），用本地持久化缓存
      // 先渲染上一版课表，消除「短暂空白」，随后云端返回再静默更新。
      const cacheOwnerId = cachedUser && (cachedUser.xipooId || cachedUser.id)
      const diskCache = !cachedSchedules ? scheduleCache.readCachedSchedules(cacheOwnerId) : null
      if (diskCache && this.data.courses.length === 0) {
        this.setData({
          user: cachedUser || this.data.user,
          courses: diskCache.courses,
          activitySchedule: diskCache.activitySchedule
        })
        this.refreshViews(diskCache.courses, diskCache.activitySchedule)
        this._renderedSnapshot = scheduleCache.scheduleSnapshot(diskCache.courses, diskCache.activitySchedule)
      }

      // 冷启动数据预拉取：只作为临时首屏数据，之后仍必须请求实时云端。
      // 不能直接 return，否则预拉取快照可能覆盖用户刚刚新增/修改的课程。
      let prefetched = null
      if (!this._prefetchConsumed && !this.pendingEditCourseId && app.getPrefetchData) {
        prefetched = await app.getPrefetchData()
      }
      this._prefetchConsumed = true
      if (prefetched && !prefetched.guest && Array.isArray(prefetched.courses)) {
        const user = prefetched.me || cachedUser || this.data.user
        const courses = prefetched.courses
        const activitySchedule = Array.isArray(prefetched.activitySchedule) ? prefetched.activitySchedule : []
        if (prefetched.me) app.setCached('me', prefetched.me)
        app.setCached('schedules', courses)

        this.setData({ user, courses, activitySchedule })
        this.refreshViews(courses, activitySchedule)
        this._lastLoadAt = Date.now()
      }

      const settle = async (request) => {
        try {
          return { status: 'fulfilled', value: await request() }
        } catch (reason) {
          return { status: 'rejected', reason }
        }
      }
      // 冷启动首屏优化：me / 课表 / 活动日程三者相互独立，并行拉取，
      // 把首屏等待从「三次串行」压到「一次并发」；settle 保证各自失败仍独立兜底。
      const [userRes, coursesRes, activityRes] = await Promise.all([
        cachedUser ? Promise.resolve({ status: 'fulfilled', value: cachedUser }) : settle(() => api.me()),
        settle(() => api.getSchedule()),
        settle(() => api.getActivitySchedule())
      ])

      // 云函数调用失败时 api 层会回退为 mock 数据并打上 __cloudFailed 标记。
      // 这类结果绝不能覆盖已有的真实数据，也不能写入全局缓存，
      // 否则一次短暂的云端抖动就会把课表清空（切换卡片后数据丢失的根因）。
      const userFailed = userRes.status === 'rejected' || Boolean(userRes.value && userRes.value.__cloudFailed)
      const coursesFailed = coursesRes.status === 'rejected' || Boolean(coursesRes.value && coursesRes.value.__cloudFailed)
      const activityFailed = activityRes.status === 'rejected' || Boolean(activityRes.value && activityRes.value.__cloudFailed)

      const user = userFailed ? this.data.user : userRes.value
      const courses = coursesFailed ? this.data.courses : (coursesRes.value || [])
      const activitySchedule = activityFailed ? this.data.activitySchedule : (activityRes.value || [])

      // 更新全局缓存（仅真实成功的结果）
      if (!userFailed) app.setCached('me', user)
      if (!coursesFailed) app.setCached('schedules', courses)

      // 云端结果与当前已渲染内容一致时，跳过 courses 的大 setData + refreshViews，
      // 避免后台静默更新期间造成功无谓的二次渲染（user 轻量，始终同步）。
      const nextSnapshot = scheduleCache.scheduleSnapshot(courses, activitySchedule)
      const coursesUnchanged = this._renderedSnapshot === nextSnapshot
      this.setData(Object.assign({ user }, coursesUnchanged ? {} : { courses, activitySchedule }))
      if (!coursesUnchanged) {
        this.refreshViews(courses, activitySchedule)
        this._renderedSnapshot = nextSnapshot
      }
      if (!coursesFailed) scheduleCache.writeCachedSchedules(courses, activitySchedule, user && (user.xipooId || user.id))
      this._lastLoadAt = Date.now()

      // 日程首屏完成后再预拉活动第一页，切换到活动页时可直接消费。
      if (!app._activitiesPrefetch) {
        setTimeout(() => {
          if (!app._activitiesPrefetch) {
            app._activitiesPrefetch = api.getActivities({ page: 1, pageSize: 20 }).catch(() => null)
          }
        }, 300)
      }

      if (this.pendingEditCourseId) {
        const course = courses.find((item) => item.id === this.pendingEditCourseId)
        this.pendingEditCourseId = null
        if (course) {
          this.setData({ courseEditorOpen: true, editingCourse: prepareEditableCourse(course) })
          this.syncEditorCalendar(course.date || this.data.selectedDate)
        }
      }

      // 只有课表本身加载失败才提示（活动日程为空是正常的）
      if (coursesRes.status === 'rejected') {
        wx.showToast({
          title: (coursesRes.reason && coursesRes.reason.message) || (this.data.lang === 'en' ? 'Schedule failed to load' : '日程加载失败'),
          icon: 'none'
        })
      } else if (coursesFailed) {
        wx.showToast({
          title: this.data.lang === 'en' ? 'Cloud unavailable, local data kept' : '云服务暂不可用，已保留现有日程',
          icon: 'none'
        })
      }
    } finally {
      this._loading = false
    }
  },

  refreshViews(courses = this.data.courses, activitySchedule = this.data.activitySchedule) {
    const lang = this.data.lang
    const reviewedCourses = (courses || []).map((course) => enrichCourseReview(course, lang))
    const selectedDate = this.data.selectedDate
    const date = new Date(`${selectedDate}T00:00:00`)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const colorCtx = buildCourseColorContext(reviewedCourses)
    const calendarCourses = expandCourseSessions(reviewedCourses)
    const todayCourses = calendarCourses
      .filter((item) => courseOccurrenceDates(item).includes(selectedDate))
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
      .map((item) => Object.assign({}, item, { colorHex: resolveCourseColor(item, colorCtx), holiday: isStatutoryHoliday(selectedDate), calendarMark: getCalendarMark(selectedDate) }))

    const dayCols = buildDayCols(
      calendarCourses,
      this.data.weekDayHeaders || ['一', '二', '三', '四', '五', '六', '日'],
      this.data.currentWeek,
      colorCtx
    )

    this.setData({
      courses: reviewedCourses,
      reviewCourses: groupReviewCourses(reviewedCourses, lang),
      dayCols,
      todayCourses,
      selectedDateHoliday: isStatutoryHoliday(selectedDate),
      selectedDateCalendarMark: getCalendarMark(selectedDate),
      monthCells: buildMonthCells(year, month, reviewedCourses, activitySchedule, 'course', selectedDate, colorCtx),
      monthTitle: `${year}.${pad(month)}`,
      selectedWeekdayLabel: weekdayLabel(selectedDate, lang)
    })
  },

  closeFab() {
    const data = {}
    if (this.data.plusPopupOpen) data.plusPopupOpen = false
    if (this.data.weekPickerOpen) data.weekPickerOpen = false
    if (Object.keys(data).length) this.setData(data)
  },

  openReviewModal() {
    if (!this.data.reviewCourses.length) return
    this.setData({ reviewModalOpen: true })
  },

  closeReviewModal() {
    this.setData({ reviewModalOpen: false })
  },

  editCourseFromReview(event) {
    const id = event.currentTarget.dataset.id
    const course = this.data.reviewCourses.find((item) => item.id === id)
    if (!course) return
    this.setData({
      reviewModalOpen: false,
      courseEditorOpen: true,
      editingCourse: prepareEditableCourse(course)
    })
    this.syncEditorCalendar(course.date || this.data.selectedDate)
  },

  openAiImport() {
    if (!getApp().requireLogin()) return
    if (this.data.importing) return
    this.setData({ plusPopupOpen: false })
    if (api.getPendingScheduleImport()) {
      this.resumeAiImport()
      return
    }
    this.importByAI()
  },

  startAiImportProgress() {
    const lang = this.data.lang
    const copy = getAiImportCopy(lang)
    this.stopAiImportTimer()
    this._aiImportStartedAt = Date.now()
    this.setData({
      importing: true,
      importProgress: 8,
      importProgressDetail: '',
      importStatus: copy.preparing,
      importDurationHint: copy.durationHint,
      importTimeHint: copy.remaining.replace('%s', AI_IMPORT_EXPECTED_SECONDS),
      importStages: buildAiImportStages(0, lang)
    })
    this._aiImportTimer = setInterval(() => this.refreshAiImportTime(), 1000)
  },

  refreshAiImportTime() {
    if (!this.data.importing || !this._aiImportStartedAt) return
    const elapsed = Math.floor((Date.now() - this._aiImportStartedAt) / 1000)
    const copy = getAiImportCopy(this.data.lang)
    const serverEstimate = Number(this._aiImportEstimatedRemainingMs)
    const serverEstimateAge = Date.now() - (this._aiImportEstimatedAt || Date.now())
    const remaining = Number.isFinite(serverEstimate)
      ? Math.max(0, Math.ceil((serverEstimate - serverEstimateAge) / 1000))
      : Math.max(0, AI_IMPORT_EXPECTED_SECONDS - elapsed)
    const timeHint = this._aiImportAwaitingEstimate
      ? copy.calculating
      : Number.isFinite(serverEstimate)
      ? (remaining > 0 ? copy.remaining.replace('%s', remaining) : copy.calculating)
      : (remaining > 0 ? copy.remaining.replace('%s', remaining) : copy.processing)
    // 服务端长时间不回报进度时，按已耗时缓慢保底推进，避免进度条长时间停在原地
    const creep = Math.min(92, Math.round(6 + (1 - Math.exp(-elapsed / 40)) * 86))
    const currentProgress = Number(this.data.importProgress) || 0
    const updates = {
      importTimeHint: `${copy.elapsed.replace('%s', elapsed)} · ${timeHint}`
    }
    if (creep > currentProgress && currentProgress < 98) {
      updates.importProgress = creep
    }
    this.setData(updates)
  },

  updateAiImportProgress(payload = {}) {
    const completed = Number(payload.completed)
    const total = Number(payload.total)
    const hasItemProgress = Number.isFinite(completed) && Number.isFinite(total) && total > 0 && completed >= 0
    const phase = hasItemProgress && completed > 0 && ['preparing', 'queued', 'processing'].includes(payload.phase)
      ? 'recognizing'
      : payload.phase
    const stage = getAiImportStage(phase, this.data.lang)
    const hasServerProgress = Number.isFinite(Number(payload.progress))
    const recognitionProgress = hasItemProgress
      ? Math.round(34 + Math.min(1, completed / total) * 56)
      : null
    const nextProgress = stage.index === 2 && Number.isFinite(recognitionProgress)
      ? (phase === 'parsing' && hasServerProgress ? Math.max(recognitionProgress, Number(payload.progress)) : recognitionProgress)
      : (hasServerProgress ? Number(payload.progress) : (this.data.importProgress || 0))
    if (Object.prototype.hasOwnProperty.call(payload, 'estimatedRemainingMs')) {
      const remainingMs = Number(payload.estimatedRemainingMs)
      this._aiImportAwaitingEstimate = !Number.isFinite(remainingMs)
      this._aiImportEstimatedRemainingMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : null
      this._aiImportEstimatedAt = Date.now()
    }
    this.setData({
      // 进度只增不减：服务端偶发回报较小值时进度条不回退
      importProgress: Math.max(0, Math.min(100, Math.max(nextProgress, Number(this.data.importProgress) || 0))),
      importProgressDetail: hasItemProgress ? `${completed}/${total}` : this.data.importProgressDetail,
      importStatus: stage.text,
      importStages: buildAiImportStages(stage.index, this.data.lang)
    })
  },

  stopAiImportTimer() {
    if (this._aiImportTimer) {
      clearInterval(this._aiImportTimer)
      this._aiImportTimer = null
    }
    this._aiImportStartedAt = null
    this._aiImportEstimatedRemainingMs = null
    this._aiImportEstimatedAt = null
    this._aiImportAwaitingEstimate = false
  },

  openAddCourse() {
    if (!getApp().requireLogin()) return
    this.setData({ plusPopupOpen: false })
    wx.navigateTo({ url: '/packages/schedule/pages/addSchedule/addSchedule' })
  },

  // ===== 语音录入日程：同声传译插件实时转写 → 可编辑文本 → 混元整理 =====
  openVoiceImport() {
    if (!getApp().requireLogin()) return
    this.setData({ plusPopupOpen: false, voiceImportOpen: true, voiceParsing: false })
    this.initVoiceRecognition()
  },

  closeVoiceImport() {
    if (this.data.voiceRecording && this._voiceManager) {
      try { this._voiceManager.stop() } catch (_) {}
    }
    this.setData({ voiceImportOpen: false, voiceRecording: false, voiceParsing: false })
  },

  // 插件未申请/未过审时 requirePlugin 会抛错：降级为纯文本输入
  initVoiceRecognition() {
    if (this._voiceManager) {
      this.setData({ voiceAvailable: true })
      return
    }
    let manager = null
    try {
      manager = requirePlugin('WechatSI').getRecordRecognitionManager()
    } catch (error) {
      console.warn('[schedule] WechatSI 插件不可用:', error && error.message)
      manager = null
    }
    if (!manager) {
      this.setData({ voiceAvailable: false })
      return
    }
    manager.onRecognize((res) => {
      if (res && res.result) this.setData({ voiceText: (this._voiceBaseText || '') + res.result })
    })
    manager.onStop((res) => {
      this.setData({ voiceRecording: false })
      const result = res && res.result ? String(res.result).trim() : ''
      if (result) this.setData({ voiceText: ((this._voiceBaseText || '') + result).trim() })
    })
    manager.onError((res) => {
      console.warn('[schedule] 语音识别失败:', res && res.msg)
      this.setData({ voiceRecording: false })
      wx.showToast({ title: (res && res.msg) || this.data.t.voiceRecognizeFail, icon: 'none' })
    })
    this._voiceManager = manager
    this.setData({ voiceAvailable: true })
  },

  startVoiceRecord() {
    if (!this._voiceManager || this.data.voiceRecording || this.data.voiceParsing) return
    // 已有文本保留，新识别结果追加在后
    this._voiceBaseText = this.data.voiceText ? `${this.data.voiceText.trim()}\n` : ''
    this.setData({ voiceRecording: true })
    this._voiceManager.start({
      lang: this.data.lang === 'en' ? 'en_US' : 'zh_CN',
      duration: 60000
    })
  },

  stopVoiceRecord() {
    if (!this._voiceManager || !this.data.voiceRecording) return
    this._voiceManager.stop()
  },

  onVoiceTextInput(event) {
    this.setData({ voiceText: event.detail.value })
  },

  async submitVoiceImport() {
    const text = String(this.data.voiceText || '').trim()
    if (!text || this.data.voiceParsing) return
    this.setData({ voiceParsing: true })
    try {
      const courses = await api.parseScheduleText(text)
      if (!courses.length) {
        this.setData({ voiceParsing: false })
        wx.showToast({ title: this.data.t.voiceEmpty, icon: 'none' })
        return
      }
      this.setData({ voiceImportOpen: false, voiceParsing: false, voiceText: '' })
      // 语音无 OCR 核验图：只写库 + 弹结果面板
      await this.finishCoursesImport(courses)
    } catch (error) {
      this.setData({ voiceParsing: false })
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Import failed' : '导入失败'),
        icon: 'none'
      })
    }
  },

  // 噗噗助手关闭时的 FAB：提供与小章鱼点击一致的入口（AI 拍照 / 语音录入 / 手动添加）
  onFabTap() {
    if (!getApp().requireLogin()) return
    const zh = this.data.lang !== 'en'
    wx.showActionSheet({
      itemList: zh
        ? ['📷 AI 拍照上传课表', '🎙️ 语音录入日程', '✏️ 手动添加日程']
        : ['📷 Upload schedule with AI', '🎙️ Voice input', '✏️ Add manually'],
      success: (res) => {
        if (res.tapIndex === 0) this.openAiImport()
        else if (res.tapIndex === 1) this.openVoiceImport()
        else if (res.tapIndex === 2) this.openAddCourse()
      }
    })
  },

  editCourse(event) {
    if (this.data.scheduleKind !== 'course') return
    const id = event.currentTarget.dataset.id
    let course = this.data.courses.find((item) => item.id === id)
    if (!course) {
      const parent = this.data.courses.find((item) => Array.isArray(item.sessions) && item.sessions.some((session, index) => `${item.id}--session-${index}` === id))
      if (parent) {
        const index = parent.sessions.findIndex((session, position) => `${parent.id}--session-${position}` === id)
        const session = parent.sessions[index] || {}
        course = Object.assign({}, parent, session, {
          title: parent.title,
          type: session.type || parent.type,
          date: session.date || '',
          weekday: session.weekday || parent.weekday,
          week_set: Array.isArray(session.weekSet) ? session.weekSet : [],
          weekStart: Array.isArray(session.weekSet) && session.weekSet.length ? session.weekSet[0] : '',
          weekEnd: Array.isArray(session.weekSet) && session.weekSet.length ? session.weekSet[session.weekSet.length - 1] : '',
          _sessionParentId: parent.id,
          _sessionIndex: index
        })
      }
    }
    if (!course) return
    this.setData({
      courseEditorOpen: true,
      editingCourse: prepareEditableCourse(course)
    })
    this.syncEditorCalendar(course.date)
  },

  viewCourseDetail(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    // 周视图多时段课程会展开为临时 session ID，详情页需回到持久化的主课程 ID。
    const rendered = this.data.courses.find((item) => item.id === id)
      || this.data.courses.find((item) => Array.isArray(item.sessions) && item.sessions.some((session, index) => `${item.id}--session-${index}` === id))
    const targetId = rendered ? rendered.id : id
    const sessionIndex = rendered && rendered.id !== id && Array.isArray(rendered.sessions)
      ? rendered.sessions.findIndex((session, index) => `${rendered.id}--session-${index}` === id)
      : -1
    wx.navigateTo({
      url: `/packages/schedule/pages/scheduleDetail/scheduleDetail?id=${encodeURIComponent(targetId)}${sessionIndex >= 0 ? `&sessionIndex=${sessionIndex}` : ''}`
    })
  },

  openCourseBuddy(event) {
    const courseId = event.currentTarget.dataset.id
    if (!courseId) {
      wx.navigateTo({ url: '/packages/social/pages/matchmaking/center?type=course' })
      return
    }
    wx.navigateTo({
      url: `/packages/social/pages/matchmaking/center?type=course&courseId=${encodeURIComponent(courseId)}`
    })
  },

  openStudyBuddy() {
    wx.navigateTo({ url: '/packages/social/pages/matchmaking/center' })
  },

  openCourseMatchModule() {
    const course = this.data.todayCourses[0] || this.data.courses[0]
    const suffix = course && course.id ? `?courseId=${encodeURIComponent(course.id)}` : '?tab=people&scope=course'
    wx.navigateTo({ url: `/packages/social/pages/buddyCenter/buddyCenter${suffix}` })
  },

  openTeamRequests() {
    wx.navigateTo({ url: '/packages/social/pages/buddySquare/buddySquare' })
  },

  openScheduleMatch() {
    wx.navigateTo({ url: '/packages/schedule/pages/match/match' })
  },

  // ===== 新布局事件处理 =====

  // 课程详情弹出
  showCourseDetail(e) {
    const id = e.currentTarget.dataset.id
    const course = this.data.courses.find((c) => c.id === id)
    if (!course) return
    // 规范化 colorIdx：-1 表示自动配色，便于快捷面板色板正确高亮
    const colorIdx = Number.isInteger(course.colorIdx) && course.colorIdx >= 0 && course.colorIdx < MACARON_COLORS.length
      ? course.colorIdx
      : -1
    this.setData({
      detailPopup: { show: true, course: Object.assign({}, course, { colorIdx }) }
    })
  },

  closeDetailPopup() {
    this.setData({ 'detailPopup.show': false })
  },

  // 快捷面板调色：先更新本地视图让课程块即时变色，再持久化到云端
  onQuickColorPick(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const colorIdx = Number.isInteger(idx) && idx >= 0 && idx < MACARON_COLORS.length ? idx : -1
    const popupCourse = this.data.detailPopup.course
    if (!popupCourse || !popupCourse.id) return
    const courses = this.data.courses.map((item) => (
      item.id === popupCourse.id ? Object.assign({}, item, { colorIdx }) : item
    ))
    this.setData({
      courses,
      'detailPopup.course.colorIdx': colorIdx
    })
    this.refreshViews(courses)
    const target = courses.find((item) => item.id === popupCourse.id)
    api.upsertCourse(target).then((result) => {
      if (result && result.__cloudFailed) {
        wx.showToast({
          title: this.data.lang === 'en' ? 'Cloud unavailable, color not synced' : '云服务暂不可用，颜色暂未同步到云端',
          icon: 'none'
        })
      }
    }).catch((error) => {
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Save failed' : '保存失败'),
        icon: 'none'
      })
    })
  },

  // 快捷面板「查看详情」：关闭面板并跳转课程详情页
  viewDetailFromPopup() {
    const course = this.data.detailPopup.course
    if (!course || !course.id) return
    this.setData({ 'detailPopup.show': false })
    wx.navigateTo({
      url: `/packages/schedule/pages/scheduleDetail/scheduleDetail?id=${encodeURIComponent(course.id)}`
    })
  },

  editFromDetail() {
    const course = this.data.detailPopup.course
    if (!course) return
    this.setData({
      detailPopup: { show: false, course: {} },
      courseEditorOpen: true,
      editingCourse: prepareEditableCourse(course)
    })
    this.syncEditorCalendar(course.date)
  },

  openCourseBuddyFromDetail() {
    const courseId = this.data.detailPopup.course.id
    this.setData({ 'detailPopup.show': false })
    if (courseId) {
      wx.navigateTo({
        url: `/packages/social/pages/matchmaking/center?type=course&courseId=${encodeURIComponent(courseId)}`
      })
    } else {
      wx.navigateTo({ url: '/packages/social/pages/matchmaking/center?type=course' })
    }
  },

  // 周选择下拉
  toggleWeekPicker() {
    this.setData({ weekPickerOpen: !this.data.weekPickerOpen })
  },

  closeWeekPicker() {
    this.setData({ weekPickerOpen: false })
  },

  selectWeek(e) {
    const week = Number(e.currentTarget.dataset.week)
    if (!Number.isInteger(week) || week < 1 || week > getTotalWeeks()) return
    const dates = calcWeekDates(week, this.data.weekDayHeaders)
    const selectedDate = dates[0].key
    this.setData({
      currentWeek: week,
      selectedDate,
      selectedWeekdayLabel: weekdayLabel(selectedDate, this.data.lang),
      weekPickerOpen: false
    }, () => {
      this.updateWeekView(week)
      this.refreshViews()
    })
  },

  updateWeekView(week) {
    const dates = calcWeekDates(week, this.data.weekDayHeaders)
    const dateHeaders = dates.map(d => d.day)
    const monthLabel = getMonthLabelForLang(dates, this.data.lang)
    this.setData({
      dateHeaders,
      monthLabel,
      currentMonthText: monthLabel,
      weekLabelText: getWeekLabelForLang(week, this.data.lang)
    })
  },

  // 设置按钮 - 跳转设置页
  toggleSettingsPopup() {
    wx.navigateTo({ url: '/packages/schedule/pages/settings/settings' })
  },

  // ====================================================================
  //  导出课程到系统日历 (.ics)
  //
  //  设备判断 → 分两套完全不同的路径：
  //
  //  【Android / 鸿蒙】
  //    ① 调云函数 → 生成 ICS → 上传云存储 → 返回 HTTPS downloadUrl
  //    ② wx.downloadFile 下载到本地临时文件
  //    ③ wx.openDocument({ fileType:'ics' }) → 系统选择日历打开
  //
  //  【iOS / iPhone】
  //    ① 下载 .ics 到本地临时文件
  //    ② wx.openDocument 打开系统文件预览，并开启分享菜单
  //    ③ 若系统预览不可用，再进入复制 HTTPS 链接到 Safari 的兜底页
  //
  //  注意：小程序不能可靠地自动唤起 Safari 或系统日历，不能把 web-view
  //        当作自动导入通道。iOS 必须给用户一个可见、可重试的系统入口。
  // ====================================================================
  async exportToSystemCalendar() {
    var app = getApp()
    if (app.requireLogin && !app.requireLogin()) return

    var courses = this.data.courses || []
    var lang = this.data.lang

    // ── 边界检查 ──
    if (!courses.length) {
      wx.showToast({
        title: lang === 'en' ? 'No courses to export' : '没有可导出的课程',
        icon: 'none', duration: 2000
      })
      return
    }

    var validCourses = courses.filter(function (c) {
      var w = Number(c.weekday)
      return w >= 1 && w <= 7 && (c.start || c.startTime) && (c.end || c.endTime)
    })
    if (!validCourses.length) {
      wx.showToast({
        title: lang === 'en' ? 'No valid courses' : '课程缺少上课时间，无法导出',
        icon: 'none', duration: 2000
      })
      return
    }

    // ── 检测设备平台 ──
    var deviceOS = this._getDeviceOS()

    // ── 开始导出 ──
    this.setData({ exportingIcs: true })
    wx.showLoading({
      title: lang === 'en' ? 'Generating…' : '正在生成日历文件…',
      mask: true
    })

    try {
      // ① 调用云函数：生成 ICS → 上传云存储 → 获取 HTTPS 下载链接
      var result = await api.exportCourseIcs(validCourses)
      wx.hideLoading()

      if (!result || !result.downloadUrl) {
        throw new Error(lang === 'en' ? 'No download URL returned' : '未获取到下载链接，请重试')
      }

      var downloadUrl = result.downloadUrl
      console.log('[Xipoo] ICS 云存储下载链接: ' + downloadUrl)

      // ── ② 按设备分支 ──
      if (deviceOS === 'ios') {
        await this._exportForIOS(downloadUrl, validCourses.length, lang)
      } else {
        await this._exportForAndroid(downloadUrl, lang)
      }

    } catch (err) {
      wx.hideLoading()
      var msg = String(err && (err.message || err.errMsg || err) || '')
      console.error('[Xipoo] 导出日历失败:', msg)

      if (msg.indexOf('尚未部署') !== -1 || msg.indexOf('-501000') !== -1) {
        wx.showToast({ title: lang === 'en' ? 'Cloud func not deployed' : '云函数未部署，请先上传', icon: 'none', duration: 3000 })
      } else if (msg.indexOf('云环境不可用') !== -1) {
        wx.showToast({ title: lang === 'en' ? 'Cloud unavailable' : '云环境不可用', icon: 'none', duration: 2500 })
      } else if (msg.indexOf('课程') !== -1 && msg.indexOf('时间') !== -1) {
        wx.showToast({ title: msg.slice(0, 14), icon: 'none', duration: 2000 })
      } else {
        wx.showModal({
          title: lang === 'en' ? 'Export Failed' : '导出失败',
          content: msg.slice(0, 200),
          showCancel: false,
          confirmText: lang === 'en' ? 'OK' : '知道了'
        })
      }
    } finally {
      this.setData({ exportingIcs: false })
    }
  },

  /**
   * 获取设备操作系统
   * @returns {'ios'|'android'}
   */
  _getDeviceOS: function () {
    try {
      var info = wx.getSystemInfoSync()
      var platform = (info && info.platform) ? String(info.platform).toLowerCase() : ''
      if (platform.indexOf('ios') !== -1 || platform.indexOf('iphone') !== -1 || platform.indexOf('ipad') !== -1) {
        return 'ios'
      }
      // android / devtools / ohos（鸿蒙）等统统走 Android 路径
      return 'android'
    } catch (_) {
      return 'android'
    }
  },

  /**
   * iOS 导出路径：先走本地 .ics 文件预览，再使用 Safari 链接兜底。
   * iOS 不允许小程序自动拉起 Safari，因此这里不再依赖 web-view 的错误假设。
   */
  _exportForIOS: function (downloadUrl, courseCount, lang) {
    return new Promise(function (resolve) {
      wx.showModal({
        title: lang === 'en' ? 'Import to Calendar' : '导入系统日历',
        content: (lang === 'en'
          ? 'A calendar file for ' + courseCount + ' courses will open. Use the share menu to add it to Calendar. If it cannot open, a Safari link will be provided.'
          : '将打开 ' + courseCount + ' 门课程的日历文件。请在系统预览的分享菜单中添加到日历；若无法打开，会提供 Safari 导入链接。'),
        confirmText: lang === 'en' ? 'Continue' : '打开文件',
        cancelText: lang === 'en' ? 'Cancel' : '取消',
        success: function (modalRes) {
          if (!modalRes.confirm) { resolve(false); return }
          wx.showLoading({ title: lang === 'en' ? 'Downloading…' : '正在下载日历文件…', mask: true })
          wx.downloadFile({
            url: downloadUrl,
            success: function (downloadRes) {
              wx.hideLoading()
              if (downloadRes.statusCode !== 200 || !downloadRes.tempFilePath) {
                wx.navigateTo({ url: '/pages/schedule/ics-bridge/ics-bridge?icsUrl=' + encodeURIComponent(downloadUrl) })
                resolve(false)
                return
              }
              wx.openDocument({
                filePath: downloadRes.tempFilePath,
                fileType: 'ics',
                showMenu: true,
                success: function () { resolve(true) },
                fail: function () {
                  wx.navigateTo({ url: '/pages/schedule/ics-bridge/ics-bridge?icsUrl=' + encodeURIComponent(downloadUrl) })
                  resolve(false)
                }
              })
            },
            fail: function () {
              wx.hideLoading()
              wx.navigateTo({ url: '/pages/schedule/ics-bridge/ics-bridge?icsUrl=' + encodeURIComponent(downloadUrl) })
              resolve(false)
            }
          })
        },
        fail: function () { resolve(false) }
      })
    })
  },

  /**
   * Android / 鸿蒙导出路径：downloadFile → openDocument → 系统日历
   */
  _exportForAndroid: function (downloadUrl, lang) {
    var self = this
    return new Promise(function (resolve) {
      wx.showLoading({ title: lang === 'en' ? 'Downloading…' : '正在下载…', mask: true })

      wx.downloadFile({
        url: downloadUrl,
        success: function (downloadRes) {
          wx.hideLoading()
          if (downloadRes.statusCode !== 200) {
            wx.showToast({ title: lang === 'en' ? 'Download failed' : '下载失败', icon: 'none' })
            resolve(false)
            return
          }
          // 用 openDocument 打开，fileType:'ics' 让系统优先匹配日历 App
          wx.openDocument({
            filePath: downloadRes.tempFilePath,
            fileType: 'ics',
            success: function () {
              console.log('[Xipoo] Android openDocument 成功')
              resolve(true)
            },
            fail: function (err) {
              console.warn('[Xipoo] Android openDocument 失败', err && err.errMsg)
              wx.showToast({
                title: lang === 'en' ? 'No calendar app found' : '未找到日历应用，请安装系统日历',
                icon: 'none',
                duration: 2500
              })
              resolve(false)
            }
          })
        },
        fail: function (err) {
          wx.hideLoading()
          console.error('[Xipoo] Android downloadFile 失败', err)
          wx.showToast({
            title: lang === 'en' ? 'Network error' : '网络异常，请重试',
            icon: 'none',
            duration: 2000
          })
          resolve(false)
        }
      })
    })
  },

  // 月视图右上角的 AI 识别记录快捷入口
  openAiImportRecords() {
    wx.navigateTo({ url: '/packages/schedule/pages/settings/settings?focus=aiImports' })
  },

  // 加号弹出双录入入口
  togglePlusPopup() {
    if (!getApp().requireLogin()) return // 添加课程/AI 录入需登录
    this.setData({
      plusPopupOpen: !this.data.plusPopupOpen,
      settingsPopupOpen: false
    })
  },

  onGridScroll(e) {
    // 只记录滚动位置（不 setData），供格子点击换算小时
    this._gridScrollTop = (e.detail && e.detail.scrollTop) || 0
  },

  // ==================== 日历滑动翻页 ====================
  // 左右滑动：周视图翻周、月视图翻月、日视图翻日；垂直滚动不受影响
  onCalendarTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._calTouchStart = { x: touch.clientX, y: touch.clientY }
  },

  onCalendarTouchEnd(e) {
    const start = this._calTouchStart
    this._calTouchStart = null
    if (!start) return
    const touch = e.changedTouches && e.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    // 横向位移需超过 60px 且明显大于纵向，避免与上下滚动冲突
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    // 左滑下一页，右滑上一页
    this.flipCalendarPage(dx < 0 ? 1 : -1)
  },

  flipCalendarPage(step) {
    if (this.data.scheduleKind !== 'course') return
    const mode = this.data.viewMode
    if (mode === 'week') {
      const next = this.data.currentWeek + step
      if (!Number.isInteger(next) || next < 1 || next > getTotalWeeks()) return
      this.selectWeek({ currentTarget: { dataset: { week: next } } })
      return
    }
    if (mode === 'month') {
      const date = new Date(`${this.data.selectedDate}T00:00:00`)
      date.setDate(1) // 避免 31 日翻月溢出
      date.setMonth(date.getMonth() + step)
      this.setSelectedDate(dateKey(date))
      return
    }
    if (mode === 'day') {
      this.shiftSelectedDate({ currentTarget: { dataset: { step } } })
    }
  },

  onDayColTap(e) {
    // 点击空白格子：按点击位置换算「星期几 + 第几小时」，打开课程编辑器并预填该格子
    const app = getApp()
    if (app.requireLogin && !app.requireLogin()) return
    const dayIdx = Number(e.currentTarget.dataset.day)
    if (!Number.isInteger(dayIdx) || dayIdx < 0) return
    const win = getWindowInfo()
    if (!win || !win.windowWidth) return
    wx.createSelectorQuery().in(this).selectAll('.day-col').boundingClientRect((rects) => {
      const rect = rects && rects[dayIdx]
      if (!rect) return
      const touchY = (e.detail && typeof e.detail.y === 'number') ? e.detail.y : rect.top
      const offsetPx = touchY - rect.top + (this._gridScrollTop || 0)
      const hhPx = (this.data.hourHeight / 750) * win.windowWidth
      if (!hhPx) return
      const hour = Math.max(0, Math.min(23, Math.floor(offsetPx / hhPx)))
      const labels = this.data.weekDayHeaders || []
      const weekDates = calcWeekDatesForDate(this.data.selectedDate, labels)
      const dateInfo = weekDates[dayIdx]
      if (!dateInfo) return
      const startsOnSunday = isSundayFirst(labels)
      const weekday = startsOnSunday ? (dayIdx === 0 ? 7 : dayIdx) : dayIdx + 1
      const editingCourse = prepareEditableCourse({
        date: dateInfo.key,
        weekday,
        start: `${String(hour).padStart(2, '0')}:00`,
        end: `${String(hour + 1).padStart(2, '0')}:00`,
        weekStart: this.data.currentWeek,
        weekEnd: this.data.currentWeek
      })
      this.setData({ courseEditorOpen: true, editingCourse })
      this.syncEditorCalendar(dateInfo.key)
    }).exec()
  },

  // ---- 标签选择 ----

  async openTagPicker() {
    // 优先读取本地缓存
    const cached = wx.getStorageSync('schedule_tags') || []
    let selected = [...cached]
    // 尝试从云端同步
    try {
      const me = await api.me()
      if (me && me.selectedTags && me.selectedTags.length > 0) {
        selected = [...me.selectedTags]
      }
    } catch (e) { /* 云端不可用，用缓存 */ }
    this.setData({ tagPickerOpen: true, tagSelected: selected })
    this.buildTagGroups()
  },

  noop() {},

  // 游客点击"去登录"
  onGuestLogin() {
    getApp().requireLogin()
  },
  prepareCourseForEditor(course) { return prepareEditableCourse(course) },
  closeTagPicker() { this.setData({ tagPickerOpen: false }) },

  toggleTag(e) {
    const id = e.currentTarget.dataset.id
    let selected = [...this.data.tagSelected]
    const idx = selected.indexOf(id)
    if (idx >= 0) { selected.splice(idx, 1) }
    else {
      if (selected.length >= 10) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Max 10 tags' : '最多10个标签', icon: 'none' })
        return
      }
      selected.push(id)
    }
    this.setData({ tagSelected: selected })
    this.buildTagGroups()
  },

  buildTagGroups() {
    const catOrder = ['study', 'sport', 'meal', 'lifestyle', 'entertainment']
    const catLabel = {
      zh: { study: '学习', sport: '运动', meal: '饮食', lifestyle: '作息', entertainment: '娱乐' },
      en: { study: 'Study', sport: 'Sports', meal: 'Food', lifestyle: 'Lifestyle', entertainment: 'Entertainment' }
    }
    const lang = this.data.lang
    const selected = this.data.tagSelected
    const groups = catOrder.map((cat) => ({
      category: cat,
      label: catLabel[lang][cat] || cat,
      tags: STAGS.filter((t) => t.category === cat).map((t) => ({ ...t, selected: selected.includes(t.id) }))
    }))
    this.setData({
      tagGroups: groups,
      tagBtnText: selected.length > 0 ? `${lang === 'en' ? 'Tags' : '标签'}(${selected.length})` : (lang === 'en' ? 'Tags' : '标签')
    })
  },

  async saveTags() {
    const selected = this.data.tagSelected
    // 本地缓存兜底
    wx.setStorageSync('schedule_tags', selected)
    try {
      await api.updateMatchSelectedTags(selected)
    } catch (e) {
      // 云函数不可用时本地缓存已保存
    }
    this.setData({ tagPickerOpen: false })
    this.buildTagGroups()
    wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
  },

  closeCourseEditor() {
    this.setData({ courseEditorOpen: false })
  },

  syncEditorCalendar(dateString) {
    const candidate = new Date(`${dateString || ''}T00:00:00`)
    const date = Number.isNaN(candidate.getTime()) ? getSemesterStart() : candidate
    const safeDateString = dateKey(date)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    this.setData({
      editorMonthYear: year,
      editorMonthMonth: month,
      editorMonthTitle: `${year}.${pad(month)}`,
      editorMonthCells: buildMonthCells(year, month, this.data.editingCourse && this.data.editingCourse.title ? [this.data.editingCourse] : [], [], 'course', safeDateString),
      editorWeekdayLabel: weekdayLabel(safeDateString, this.data.lang)
    })
  },

  shiftEditorMonth(event) {
    const step = Number(event.currentTarget.dataset.step)
    let year = this.data.editorMonthYear
    let month = this.data.editorMonthMonth + step
    if (month < 1) {
      month = 12
      year -= 1
    } else if (month > 12) {
      month = 1
      year += 1
    }
    this.setData({
      editorMonthYear: year,
      editorMonthMonth: month,
      editorMonthTitle: `${year}.${pad(month)}`,
      editorMonthCells: buildMonthCells(year, month, [], [], 'course', this.data.editingCourse.date)
    })
  },

  pickEditorDate(event) {
    const selectedDate = event.currentTarget.dataset.date
    const nextCourse = removeReviewField(Object.assign({}, this.data.editingCourse, {
      date: selectedDate,
      weekday: weekdayFromDate(selectedDate)
    }), 'date', this.data.lang)
    this.setData({ editingCourse: nextCourse })
    this.syncEditorCalendar(selectedDate)
  },

  selectDate(event) {
    this.setSelectedDate(event.currentTarget.dataset.date)
  },

  onDatePickerChange(event) {
    this.setSelectedDate(event.detail.value)
  },

  shiftSelectedDate(event) {
    const step = Number(event.currentTarget.dataset.step)
    if (!step) return
    const date = new Date(`${this.data.selectedDate}T00:00:00`)
    date.setDate(date.getDate() + step)
    this.setSelectedDate(dateKey(date))
  },

  setSelectedDate(selectedDate) {
    const date = new Date(`${selectedDate}T00:00:00`)
    if (Number.isNaN(date.getTime())) return
    const currentWeek = weekNumberForDate(date)
    const lang = this.data.lang
    const currentMonthText = lang === 'en' ? MONTH_SHORT_EN[date.getMonth()] : (date.getMonth() + 1) + '月'

    this.setData({
      selectedDate,
      currentWeek,
      currentMonthText,
      weekLabelText: getWeekLabelForLang(currentWeek, lang)
    }, () => {
      this.updateWeekView(currentWeek)
      this.refreshViews()
    })
  },

  switchMainView(event) {
    const view = event.currentTarget.dataset.view
    this.setData({ currentView: view })
    if (view === 'match') {
      const shown = wx.getStorageSync('match_guide_shown')
      if (!shown) {
        const lang = this.data.lang
        this.setData({
          matchGuideVisible: true,
          matchGuideIndex: 0,
          matchGuideTexts: [
            lang === 'en' ? 'Find Buddy · Interest match & recruitment' : '找搭子 · 兴趣匹配与兴趣招募',
            lang === 'en' ? 'Find Classmate · Same course & team groups' : '找课友 · 同课同学与课程小组',
            lang === 'en' ? 'Sync Time · Shared free time calculator' : '约时间 · 多人共同空闲计算'
          ]
        })
        this.startGuideBubble()
      }
    } else {
      this.stopGuideBubble()
      this.setData({ matchGuideVisible: false })
    }
  },

  startGuideBubble() {
    this.stopGuideBubble()
    let index = 0
    this.data.matchGuideTimer = setInterval(() => {
      index += 1
      if (index >= this.data.matchGuideTexts.length) {
        this.stopGuideBubble()
        this.setData({ matchGuideVisible: false, matchGuideIndex: 0 })
        wx.setStorageSync('match_guide_shown', true)
        return
      }
      this.setData({ matchGuideIndex: index })
    }, 2500)
  },

  stopGuideBubble() {
    if (this.data.matchGuideTimer) {
      clearInterval(this.data.matchGuideTimer)
      this.data.matchGuideTimer = null
    }
  },

  switchView(event) {
    // 节流：300ms 内不重复切换视图
    const now = Date.now()
    if (this._lastViewSwitchAt && now - this._lastViewSwitchAt < 300) return
    this._lastViewSwitchAt = now

    const viewMode = event.currentTarget.dataset.mode
    if (!['day', 'week', 'month'].includes(viewMode)) return
    // 切换日/周/月视图时重置小章鱼位置并收起建议面板，避免浮层残留在日历上遮挡课程
    const companion = this.selectComponent('.ai-companion-entry')
    if (companion && typeof companion.resetPosition === 'function') companion.resetPosition()
    this.setData({ viewMode }, () => {
      if (viewMode === 'week') this.updateHourHeight()
    })
    this.refreshViews()
  },

  /**
   * 动态计算时间轴密度：
   * hourHeight = 课表可用高度 / 24，下限 76rpx（高度不足时课表内部滚动）。
   * 可用高度 = 窗口高 - 课表容器顶部 - 底部导航(56px) - 底部安全区 - 余量。
   */
  updateHourHeight() {
    if (this.data.scheduleKind !== 'course' || this.data.viewMode !== 'week') return
    if (typeof wx.createSelectorQuery !== 'function') return
    const win = getWindowInfo()
    if (!win || !win.windowWidth || !win.windowHeight) return
    wx.createSelectorQuery().in(this).select('.timetable-wrapper').boundingClientRect((rect) => {
      if (!rect || !rect.top) return
      const safeBottom = win.safeArea ? Math.max(0, win.screenHeight - win.safeArea.bottom) : 0
      const tabbarPx = 56 + safeBottom
      const availPx = Math.max(240, win.windowHeight - rect.top - tabbarPx - 8)
      const availRpx = Math.floor((availPx * 750) / win.windowWidth)
      const next = Math.max(MIN_HOUR_HEIGHT, Math.floor(availRpx / 24))
      const changed = next !== this.data.hourHeight
      if (changed) HOUR_HEIGHT = next
      this.setData({ hourHeight: next, gridScrollHeight: availRpx }, () => {
        if (!changed) return
        this.refreshViews()
        // hourHeight 变化后原滚动偏移会错位，重新触发 scroll-into-view 对齐目标时刻
        const target = this.data.weekScrollTarget
        if (target) {
          this.setData({ weekScrollTarget: '' }, () => {
            this.setData({ weekScrollTarget: target })
          })
        }
      })
    }).exec()
  },

  onReady() {
    this.updateHourHeight()
  },

  switchScheduleKind(event) {
    const now = Date.now()
    if (this._lastKindSwitchAt && now - this._lastKindSwitchAt < 300) return
    this._lastKindSwitchAt = now

    const kind = event.currentTarget.dataset.kind
    this.setData({ scheduleKind: kind }, () => {
      const courses = this.data.courses || []
      const activitySchedule = this.data.activitySchedule || []
      this.refreshViews(courses, activitySchedule)
      if (kind === 'course' && this.data.viewMode === 'week') this.updateHourHeight()
    })
  },

  onCourseInput(event) {
    const field = event.currentTarget.dataset.field
    const nextCourse = Object.assign({}, this.data.editingCourse, { [field]: event.detail.value })
    const reviewField = field === 'title' ? 'title' : (field === 'place' ? 'place' : '')
    const patch = { editingCourse: reviewField ? removeReviewField(nextCourse, reviewField, this.data.lang) : nextCourse }
    if (field === 'title' && event.detail.value && event.detail.value.trim()) {
      patch['editingCourse.titleError'] = false
    }
    this.setData(patch)
  },

  onCourseStart(event) {
    const nextCourse = Object.assign({}, this.data.editingCourse, { start: event.detail.value })
    this.setData({ editingCourse: removeReviewField(nextCourse, 'time', this.data.lang) })
  },

  onCourseEnd(event) {
    const nextCourse = Object.assign({}, this.data.editingCourse, { end: event.detail.value })
    this.setData({ editingCourse: removeReviewField(nextCourse, 'time', this.data.lang) })
  },

  onCourseWeekInput(event) {
    const field = event.currentTarget.dataset.field
    const nextCourse = Object.assign({}, this.data.editingCourse, { [field]: event.detail.value })
    const weekSet = buildWeekSet(nextCourse.weekStart, nextCourse.weekEnd)
    if (weekSet.length) {
      Object.assign(nextCourse, {
        week_set: weekSet,
        week_start: weekSet[0],
        week_end: weekSet[weekSet.length - 1]
      })
      this.setData({ editingCourse: removeReviewField(nextCourse, 'weeks', this.data.lang) })
      return
    }
    this.setData({ editingCourse: nextCourse })
  },

  toggleEditorWeek(event) {
    const week = Number(event.currentTarget.dataset.week)
    if (!Number.isInteger(week) || week < 1 || week > 13) return
    const current = new Set(Array.isArray(this.data.editingCourse.week_set) ? this.data.editingCourse.week_set.map(Number) : [])
    if (current.has(week)) current.delete(week)
    else current.add(week)
    const weekSet = Array.from(current).sort((a, b) => a - b)
    const nextCourse = Object.assign({}, this.data.editingCourse, {
      week_set: weekSet,
      weekStart: '',
      weekEnd: '',
      week_start: '',
      week_end: ''
    })
    this.setData({
      editingCourse: removeReviewField(nextCourse, 'weeks', this.data.lang),
      'editingCourse.editorWeekOptions': Array.from({ length: 13 }, (_, index) => ({ week: index + 1, selected: current.has(index + 1) }))
    })
    this.syncEditorCalendar(nextCourse.date || this.data.selectedDate)
  },

  onCourseConfirmed(event) {
    const confirmed = event.detail.value
    this.setData({
      'editingCourse.confirmed': confirmed,
      'editingCourse.needsReview': !confirmed && (this.data.editingCourse.missingFields || []).length > 0,
      'editingCourse.missingFields': confirmed ? [] : this.data.editingCourse.missingFields,
      'editingCourse.reviewReasons': confirmed ? [] : this.data.editingCourse.reviewReasons
    })
  },

  // 选择课程颜色；data-idx="-1" 表示恢复自动配色（按课程名 hash）
  onCourseColorPick(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const colorIdx = Number.isInteger(idx) && idx >= 0 && idx < MACARON_COLORS.length ? idx : -1
    this.setData({ 'editingCourse.colorIdx': colorIdx })
  },

  async saveCourse() {
    if (this.data.courseSaving) return
    const title = String(this.data.editingCourse.title || '').trim()
    if (!title) {
      this.setData({ 'editingCourse.titleError': true })
      wx.showToast({
        title: this.data.t.requiredTitle,
        icon: 'none'
      })
      return
    }
    const start = String(this.data.editingCourse.start || '').trim()
    const end = String(this.data.editingCourse.end || '').trim()
    if (start && end && end <= start) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'End time must be after start time' : '结束时间需晚于开始时间',
        icon: 'none'
      })
      return
    }

    this.setData({ courseSaving: true, 'editingCourse.titleError': false })
    const course = Object.assign({}, this.data.editingCourse, {
      title,
      weekday: this.data.editingCourse.date ? weekdayFromDate(this.data.editingCourse.date) : this.data.editingCourse.weekday,
      // 方格选择是唯一权威周次，避免旧 weekStart/weekEnd 再次补齐范围。
      week_set: Array.isArray(this.data.editingCourse.week_set) ? this.data.editingCourse.week_set.map(Number).filter((week) => Number.isInteger(week) && week >= 1 && week <= 13) : []
    })

    try {
      // 编辑 OCR 教学活动时只更新对应 session，不覆盖同一门课的其他活动。
      if (course._sessionParentId && Number.isInteger(Number(course._sessionIndex))) {
        const parent = this.data.courses.find((item) => item.id === course._sessionParentId)
        const index = Number(course._sessionIndex)
        if (parent && Array.isArray(parent.sessions) && parent.sessions[index]) {
          const sessions = parent.sessions.map((session, position) => position === index
            ? Object.assign({}, session, {
              type: course.type,
              weekday: course.weekday,
              date: course.date || '',
              start: course.start,
              end: course.end,
              place: course.place,
              teacher: course.teacher,
              weekSet: normalizeCourseWeeks(course),
              week_set: normalizeCourseWeeks(course),
              weekStart: normalizeCourseWeeks(course)[0] || '',
              weekEnd: normalizeCourseWeeks(course).slice(-1)[0] || ''
            })
            : session)
          const updatedParent = Object.assign({}, parent, { sessions })
          // 先更新本地视图/缓存，云端请求完成后不会出现“保存了但界面没变”。
          const localCourses = this.data.courses.map((item) => item.id === parent.id ? updatedParent : item)
          this.setData({ courses: localCourses, courseEditorOpen: false, selectedDate: course.date })
          getApp().setCached('schedules', localCourses)
          this.refreshViews(localCourses)
          await api.upsertCourse(updatedParent)
          this._lastLoadAt = 0
          this.loadData()
          return
        }
      }
      const seriesIds = Array.isArray(course.seriesIds) ? course.seriesIds : []
      if (seriesIds.length > 1) {
        const commonFields = {
          title: course.title,
          place: course.place,
          teacher: course.teacher,
          courseCode: course.courseCode,
          section: course.section,
          term: course.term,
          type: course.type,
          confirmed: course.confirmed,
          colorIdx: Number.isInteger(course.colorIdx) ? course.colorIdx : -1,
          missingFields: course.missingFields || [],
          needsReview: course.needsReview === true,
          reviewReasons: course.reviewReasons || [],
          week_set: course.week_set,
          weekStart: course.weekStart,
          weekEnd: course.weekEnd,
          week_start: course.week_start || course.weekStart,
          week_end: course.week_end || course.weekEnd
        }
        const updates = this.data.courses
          .filter((item) => seriesIds.includes(item.id))
          .map((item) => Object.assign({}, item, commonFields))
        await api.upsertCoursesBatch(updates)
      } else {
        const saveResult = await api.upsertCourse(course)
        if (saveResult && saveResult.__cloudFailed) {
          wx.showToast({
            title: this.data.lang === 'en' ? 'Cloud unavailable, save not synced' : '云服务暂不可用，修改暂未同步到云端',
            icon: 'none'
          })
        }
      }
      // 保存后立即同步本地课表，避免随即刷新把刚改的活动覆盖回旧云端快照。
      const savedCourses = this.data.courses.map((item) => item.id === course.id ? Object.assign({}, item, course) : item)
      this.setData({
        courseEditorOpen: false,
        selectedDate: course.date || this.data.selectedDate,
        courses: savedCourses
      })
      getApp().setCached('schedules', savedCourses)
      this.refreshViews(savedCourses)
      this._lastLoadAt = Date.now()
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Save failed' : '保存失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ courseSaving: false })
    }
  },

  confirmDeleteCourse() {
    wx.showModal({
      title: this.data.lang === 'en' ? 'Delete course?' : '删除课程？',
      content: this.data.lang === 'en'
        ? 'This will remove the course and all its occurrences. This cannot be undone.'
        : '删除后将移除该课程及其所有上课日期，无法恢复。',
      confirmText: this.data.lang === 'en' ? 'Delete' : '删除',
      confirmColor: '#D94B4B',
      success: (res) => {
        if (res.confirm) this.deleteCourse()
      }
    })
  },

  async deleteCourse() {
    const seriesIds = Array.isArray(this.data.editingCourse.seriesIds)
      ? this.data.editingCourse.seriesIds
      : [this.data.editingCourse.id].filter(Boolean)
    
    // 乐观更新：立即从本地数据移除，关闭编辑框
    const idsToDelete = new Set(seriesIds)
    const nextCourses = this.data.courses.filter(c => !idsToDelete.has(c.id))
    this.setData({ courseEditorOpen: false, courses: nextCourses }, () => {
      this.refreshViews(nextCourses)
    })

    // 后台发送删除请求
    try {
      const result = await api.deleteCourse(null, seriesIds)
      if (result && result.__cloudFailed) {
        // 云端不可用：删除只写进了本地 mock，并未同步到云端
        wx.showToast({
          title: this.data.lang === 'en' ? 'Cloud unavailable, delete not synced' : '云服务暂不可用，删除暂未同步到云端',
          icon: 'none'
        })
        return
      }
      // 删除成功后失效本地缓存标志，确保下次 onShow 必定重新加载
      this._lastLoadAt = 0
      // 同步更新全局缓存，防止其他模块/页面读到已删除的脏数据
      getApp().setCached('schedules', nextCourses)
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || (this.data.lang === 'en' ? 'Delete failed' : '删除失败'),
        icon: 'none'
      })
      // 删除失败则重新加载完整数据
      this.loadData()
    }
  },

  // OCR 与语音录入共用的收尾：写库 → 统计待补全 → 刷新课表 → 弹结果面板
  async finishCoursesImport(normalizedCourses) {
    await api.upsertCoursesBatch(normalizedCourses)
    const importedReviewCourses = normalizedCourses
      .filter((course) => course.needsReview)
      .map((course) => enrichCourseReview(course, this.data.lang))
    const incompleteCount = groupReviewCourses(importedReviewCourses, this.data.lang).length
    await this.loadData()
    // 识别完成：弹出结果面板（逐门课程识别状态），替代简单的 toast
    this.openAiResultModal(normalizedCourses, incompleteCount)
  },

  async completeAiImport(result) {
    const normalizedCourses = (result.courses || []).map((course) => {
      const courseDate = course.date || ''
      return Object.assign({}, course, {
        date: courseDate,
        weekday: course.weekday || '',
        type: course.type || (this.data.lang === 'en' ? 'Course' : '课程')
      })
    })

    this.updateAiImportProgress({ phase: 'saving', progress: 98 })
    await this.finishCoursesImport(normalizedCourses)
    this.setData({
      importing: false,
      importProgress: 100,
      importBlocks: result.blocks || [],
      importTimingText: formatImportTimings(result.timings, this.data.lang)
    })
    this.stopAiImportTimer()
    this.fillAiResultAnnotatedImage(result.jobId)
  },

  // 只展示后端生成的标注核验图；404、超时或本地写入失败时才明确降级为原始截图。
  async fillAiResultAnnotatedImage(jobId) {
    const annotated = await api.fetchScheduleAnnotatedImage(jobId)
    if (annotated && annotated.success && annotated.filePath) {
      // 课程已按 jobId 形成导入批次。把成功取得的核验图持久化，供“AI 识别记录”后续查看。
      try {
        await api.saveAiImportVerificationImage(jobId, annotated.filePath, annotated.mime, annotated.fileID)
      } catch (error) {
        // 保存历史附件失败不能影响本次识别结果和核验展示。
        console.warn('[schedule] persist OCR verification image failed', error && error.message)
      }
      if (!this.data.aiResultOpen) return
      this.setData({
        verificationImagePath: annotated.filePath,
        verificationImageKind: 'annotated',
        verificationNotice: ''
      })
      return
    }
    const showOriginal = Boolean(annotated && annotated.fallbackToOriginal && this._aiImportImagePath)
    this.setData({
      verificationImagePath: showOriginal ? this._aiImportImagePath : '',
      verificationImageKind: showOriginal ? 'original' : '',
      verificationNotice: showOriginal
        ? (this.data.lang === 'en' ? 'Annotated verification image is temporarily unavailable. The original screenshot is shown below.' : '核验标注图暂不可用，以下为原始截图')
        : (this.data.lang === 'en' ? 'Annotated verification image is temporarily unavailable.' : '核验标注图暂不可用')
    })
  },

  // 组装识别结果面板数据：每门课程一行，绿色=识别成功，红色=需人工确认
  openAiResultModal(normalizedCourses, incompleteCount) {
    const lang = this.data.lang
    // 结果面板按教学活动展开，避免把 Lecture/Tutorial/Lab 合并成一行课程。
    const activities = (normalizedCourses || []).flatMap((course) => {
      if (!Array.isArray(course.sessions) || !course.sessions.length) return [course]
      return course.sessions.map((session) => Object.assign({}, course, {
        type: session.type || course.type,
        date: session.date || '',
        weekday: session.weekday || course.weekday,
        start: session.start || '',
        end: session.end || '',
        place: session.place || '',
        teacher: session.teacher || course.teacher,
        week_set: session.weekSet || session.week_set || []
      }))
    })
    const rows = activities.map((course, index) => {
      const needsReview = Boolean(course.needsReview)
      const weeks = normalizeCourseWeeks(course)
      return {
        index: index + 1,
        title: course.title || (lang === 'en' ? 'Untitled' : '未命名'),
        activityType: course.type || (lang === 'en' ? 'Course' : '课程'),
        date: course.date || '',
        weekdayText: course.date ? weekdayLabel(course.date, lang) : (course.weekday ? weekLabels[lang][Number(course.weekday) - 1] : (lang === 'en' ? 'Date TBD' : '日期待确认')),
        time: course.start && course.end ? `${course.start}-${course.end}` : (lang === 'en' ? 'Time TBD' : '时间待确认'),
        place: course.place || (lang === 'en' ? 'Location TBD' : '地点待确认'),
        weeksText: weeks.length ? formatTeachingWeeks(course, lang) : (lang === 'en' ? 'Weeks TBD' : '周次待定'),
        status: needsReview ? 'fix' : 'ok',
        statusText: needsReview ? this.data.t.aiResultFix : this.data.t.aiResultOk,
        reasons: (course.reviewReasons || []).join('、')
      }
    })
    this.setData({
      aiResultOpen: true,
      // 标注图需要额外请求；先显示本地原图，避免识别完成后出现长时间空白。
      verificationImagePath: this._aiImportImagePath || '',
      verificationImageKind: this._aiImportImagePath ? 'original' : '',
      verificationNotice: this._aiImportImagePath
        ? (lang === 'en' ? 'Generating the annotated verification image…' : '正在生成核验标注图…')
        : '',
      aiResultCourses: rows,
      aiResultIncomplete: incompleteCount || 0
    })
  },

  closeAiResult() {
    this.setData({ aiResultOpen: false })
  },

  /** 从 AI 核验结果弹窗返回日程首页 */
  goToScheduleMain() {
    this.setData({ aiResultOpen: false })
    wx.switchTab({ url: '/pages/schedule/schedule' })
  },

  /** 从课程编辑器弹窗返回日程首页 */
  goToScheduleMainFromEditor() {
    this.setData({ courseEditorOpen: false })
    wx.switchTab({ url: '/pages/schedule/schedule' })
  },

  // 结果面板「查看待补全课程」：关闭面板并打开补全弹窗
  openReviewFromAiResult() {
    this.setData({ aiResultOpen: false, reviewModalOpen: true })
  },

  handleAiImportError(error) {
    const code = error && error.code
    const scheduleFunctionMissing = code === 'SCHEDULE_FUNCTION_MISSING'
    const message = code === 'OCR_PENDING'
      ? (this.data.lang === 'en' ? 'Recognition is still in progress. You can query it again later.' : '识别仍在进行，可稍后继续查询')
      : scheduleFunctionMissing
      ? (this.data.lang === 'en'
        ? 'The schedule cloud function is not deployed in the current prod environment. Deploy it, then try again.'
        : '当前 prod 云环境尚未部署 schedule 云函数。请先上传并部署该函数，再重新识别。')
      : ((error && error.message) || (this.data.lang === 'en' ? 'Import failed' : '导入失败'))
    const canResume = !scheduleFunctionMissing && Boolean(api.getPendingScheduleImport())
    this.setData({ importing: false })
    this.stopAiImportTimer()

    wx.showModal({
      title: scheduleFunctionMissing
        ? (this.data.lang === 'en' ? 'Cloud function not deployed' : '云函数尚未部署')
        : (code === 'OCR_FAILED' ? (this.data.lang === 'en' ? 'Recognition failed' : '课表识别失败') : (code === 'OCR_PENDING' ? (this.data.lang === 'en' ? 'Recognition in progress' : '识别仍在进行') : (this.data.lang === 'en' ? 'Import interrupted' : '录入已中断'))),
      content: message,
      confirmText: scheduleFunctionMissing
        ? (this.data.lang === 'en' ? 'OK' : '知道了')
        : (code === 'OCR_FAILED' ? (this.data.lang === 'en' ? 'Upload again' : '重新上传') : (canResume ? (this.data.lang === 'en' ? 'Resume' : '继续查询') : (this.data.lang === 'en' ? 'OK' : '确定'))),
      showCancel: canResume && code !== 'OCR_FAILED',
      cancelText: this.data.lang === 'en' ? 'Cancel' : '取消',
      success: (res) => {
        if (!res.confirm) return
        if (scheduleFunctionMissing) return
        if (code === 'OCR_FAILED') this.importByAI(true)
        else if (canResume) this.resumeAiImport()
      }
    })
  },

  async resumeAiImport() {
    if (this.data.importing) return
    this.startAiImportProgress()
    this.updateAiImportProgress({ phase: 'queued', progress: this.data.importProgress })
    try {
      const result = await api.resumeScheduleImport({
        onProgress: (payload) => this.updateAiImportProgress(payload)
      })
      await this.completeAiImport(result)
    } catch (error) {
      this.handleAiImportError(error)
    }
  },

  importByAI(forceNew = false) {
    if (this.data.importing) return
    if (!forceNew && api.getPendingScheduleImport()) {
      this.resumeAiImport()
      return
    }
    // 新录入先展示参考图与截图要求，用户确认后再调起选图
    if (!forceNew) {
      this.setData({ aiGuideOpen: true, plusPopupOpen: false })
      return
    }
    this.chooseAiImportImage(forceNew)
  },

  confirmAiGuide() {
    this.setData({ aiGuideOpen: false })
    this.chooseAiImportImage(false)
  },

  cancelAiGuide() {
    this.setData({ aiGuideOpen: false })
  },

  // 参考图与识别结果图均为小视图展示，点击调起系统全屏预览
  previewAiGuideImage() {
    const url = '/assets/schedule/ebridge-sample.jpg'
    wx.previewImage({ current: url, urls: [url] })
  },

  previewAiResultImage() {
    const url = this.data.verificationImagePath
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  chooseAiImportImage(forceNew) {
    this.setData({ importBlocks: [], importTimingText: '' })
    // HarmonyOS 微信版本对 chooseMedia 的支持并不一致；chooseImage
    // 返回的临时路径足够完成 OCR 上传，因此优先使用新 API，失败或
    // 不存在时自动回退到兼容性更好的 chooseImage。
    const chooseImage = (onSuccess, onFail) => {
      const modern = typeof wx.chooseMedia === 'function'
      if (modern) {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['original'],
          success: onSuccess,
          fail: (error) => {
            console.warn('[Xipoo] chooseMedia failed, fallback to chooseImage:', error)
            if (typeof wx.chooseImage !== 'function') return onFail(error)
            wx.chooseImage({ count: 1, sourceType: ['album', 'camera'], sizeType: ['original'], success: onSuccess, fail: onFail })
          }
        })
        return
      }
      if (typeof wx.chooseImage === 'function') {
        wx.chooseImage({ count: 1, sourceType: ['album', 'camera'], sizeType: ['original'], success: onSuccess, fail: onFail })
        return
      }
      onFail(new Error('当前微信版本不支持选择图片'))
    }

    chooseImage(async (res) => {
      const selected = (res && res.tempFiles && res.tempFiles[0]) || {}
      // 鸿蒙微信可能将路径命名为 path/filePath，不能只依赖 tempFilePath。
      const selectedPath = selected.tempFilePath || selected.filePath || selected.path ||
        (res && res.tempFilePath) || (res && res.tempFilePaths && res.tempFilePaths[0])
      const file = Object.assign({}, selected, { tempFilePath: selectedPath })
      if (!selectedPath) {
        this.handleAiImportError(new Error('未获取到图片临时路径'))
        return
      }
      this.startAiImportProgress()
      try {
        // Reaching the picker means the user explicitly selected a new
        // screenshot. Never let a stale pending job replace this file.
        if (forceNew) api.clearPendingScheduleImport()
        // 留存原始截图路径，识别完成后在结果面板中展示检测图
        this._aiImportImagePath = file.tempFilePath
        const result = await api.importScheduleImage(file.tempFilePath, {
          // forceNew: true 仅用于用户明确选择另一张新图片；普通重试走 pending job。
          forceNew: forceNew === true,
          onProgress: (payload) => this.updateAiImportProgress(payload)
        })
        await this.completeAiImport(result)
      } catch (error) {
        this.handleAiImportError(error)
      }
    }, () => {
      this.setData({ importing: false })
      this.stopAiImportTimer()
    })
  },

  logout() {
    api.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  },

  onShareAppMessage() {
    return {
      title: this.data.lang === 'en' ? 'Plan your schedule with Xipoo' : '用 Xipoo 管理课表和日程',
      path: '/pages/schedule/schedule',
      imageUrl: '/images/schedule-share/share-banner.jpg'
    }
  },

  /* ===== 新手引导 ===== */
  buildIntroSteps(lang) {
    const isEn = lang === 'en'
    return [
      { selector: '.date-card', text: isEn ? 'Tap date to switch schedules' : '点击日期切换日程' },
      { selector: '.range-switch', text: isEn ? 'Day / Week / Month views' : '日/周/月视图切换' },
      { selector: '.ai-companion-entry', text: isEn ? 'Tap Pupu the octopus (bottom right) to upload your schedule with AI or add courses manually' : '点右下角小章鱼「噗噗」：AI 拍照生成课表或手动添加日程' },
      { selector: '.export-cal-btn', text: isEn ? 'Export schedule to system calendar' : '导出日程到手机日历' }
    ]
  },
  checkIntroGuide() {
    if (this.data.isGuest) return
    if (wx.getStorageSync('introGuideFinished') || wx.getStorageSync('introGuideScheduleDone')) return
    if (this.data.introGuideVisible) return
    this.setData({ introGuideVisible: true, introSteps: this.buildIntroSteps(this.data.lang) })
  },
  onIntroComplete() { this.setData({ introGuideVisible: false, introSteps: [] }) },
  onIntroExit() { this.setData({ introGuideVisible: false, introSteps: [] }) }

})
