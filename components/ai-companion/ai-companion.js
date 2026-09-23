const api = require('../../utils/api')
const { buildSuggestions, coursesOnDate, dateKey, toMinutes } = require('../../utils/companionAdvisor')
const companionAi = require('../../utils/companionAi')
const { ambientLine } = require('../../utils/companionLines')
const { isCompanionEnabled, setCompanionEnabled } = require('../../utils/companionSettings')
const { getWindowInfo } = require('../../utils/device')

const COOLDOWN_KEY = 'xipoo_companion_cooldown'
const AD_BLOCK_KEY = 'xipoo_companion_ad_block'
const AD_DAILY_KEY = 'xipoo_companion_ads_daily'
const POS_KEY = 'xipoo_companion_pos'
const AD_DAILY_IMPRESSION_CAP = 2 // 每用户每天推广展示上限
const AD_DAILY_BUBBLE_CAP = 1 // 每用户每天推广气泡上限
const CLASSMATE_CHECK_HOURS = 12
const REFRESH_INTERVAL = 60000
const BUBBLE_DURATION = 8000
const AMBIENT_MIN_INTERVAL = 75000 // 环境气泡：75-150 秒随机冒一次
const AMBIENT_MAX_INTERVAL = 150000
const AMBIENT_MAX_PER_SHOW = 4 // 每次页面停留最多冒 4 次，避免烦人
const QUIET_START = 22 // 22:00 - 07:00 不主动弹气泡
const QUIET_END = 7

// 小章鱼随机皮肤：多张形象轮换，打破单一形象（每 10s 换一张随机图）
const MASCOT_FRAMES = [
  '/images/companion/octopus-1.png',
  '/images/companion/octopus-2.png',
  '/images/companion/octopus-3.png',
  '/images/companion/octopus-4.png',
  '/images/companion/octopus-5.png',
  '/images/companion/octopus-6.png',
  '/images/companion/octopus-7.png',
  '/images/companion/octopus-8.png'
]
const DEFAULT_MASCOT = '/images/companion/octopus-8.png'
const MASCOT_CYCLE_INTERVAL = 10000
const SCHEDULE_TAP_LINES = {
  zh: [
    '收到～想补充日程的话，拍张课表给我就好。',
    '噗噗在！继续上传课表，或看看以前识别过的记录吧～',
    '日程再多也不怕，我帮你一条条整理清楚。',
    '今天也要把时间留给重要的人和事呀。'
  ],
  en: [
    'Pupu is here. Snap your timetable and I will organize it.',
    'Want to add more? Upload a schedule or revisit your past imports.',
    'No matter how busy the day is, we can sort it out together.',
    'Save some time today for what matters to you.'
  ]
}

function readCooldowns() {
  try {
    return wx.getStorageSync(COOLDOWN_KEY) || {}
  } catch (error) {
    return {}
  }
}

function pruneCooldowns(map, now) {
  const cutoff = now - 7 * 24 * 3600 * 1000
  Object.keys(map).forEach((key) => {
    if (!map[key] || map[key] < cutoff) delete map[key]
  })
  return map
}

function readAdBlocklist() {
  try {
    return wx.getStorageSync(AD_BLOCK_KEY) || []
  } catch (error) {
    return []
  }
}

function readAdDaily() {
  const today = dateKey(new Date())
  try {
    const value = wx.getStorageSync(AD_DAILY_KEY) || {}
    if (value.date === today) return value
  } catch (error) {}
  return { date: today, impressions: 0, bubbles: 0 }
}

// 与 pages/schedule/schedule.js 口径一致：学期起算日 + 总周数（供教学周过滤）
const DEFAULT_SEMESTER_START = '2026-09-07'

function readSemester() {
  let start = DEFAULT_SEMESTER_START
  let total = 20
  try {
    start = wx.getStorageSync('semesterStartDate') || start
    const saved = Number(wx.getStorageSync('totalWeeks'))
    if (Number.isInteger(saved) && saved >= 1 && saved <= 60) total = saved
  } catch (error) {}
  return { start, total }
}

// ===== 跨页面共享的数据缓存 =====
// 四个 tab 页各有一个组件实例，实例级缓存会导致每切一个 tab 就重拉 4 个接口；
// 模块级缓存让所有实例共享同一份数据与同一次进行中请求。
let sharedData = null
let sharedDataAt = 0
let sharedDataPromise = null

function normalizeActivities(result) {
  if (Array.isArray(result)) return result
  return (result && (result.activities || result.list)) || []
}

function loadSharedData(force) {
  const now = Date.now()
  if (!force && sharedData && now - sharedDataAt < REFRESH_INTERVAL) {
    return Promise.resolve(sharedData)
  }
  if (sharedDataPromise) return sharedDataPromise
  sharedDataPromise = Promise.all([
    api.getSchedule().catch(() => []),
    api.getFriendships().catch(() => []),
    api.getActivitySubscriptions().catch(() => []),
    api.getActivities({ page: 1, pageSize: 20 }).catch(() => []),
    api.getCompanionAds().catch(() => []),
    api.me().catch(() => null)
  ]).then(([courses, friendships, subscriptions, activitiesResult, ads, me]) => {
    sharedData = {
      courses: Array.isArray(courses) ? courses : [],
      friendships: Array.isArray(friendships) ? friendships : [],
      subscriptions: Array.isArray(subscriptions) ? subscriptions : [],
      activities: normalizeActivities(activitiesResult),
      ads: Array.isArray(ads) ? ads : [],
      me: me || null
    }
    sharedDataAt = Date.now()
    sharedDataPromise = null
    return sharedData
  }, (error) => {
    sharedDataPromise = null
    throw error
  })
  return sharedDataPromise
}

Component({
  properties: {
    // 当前所在 tab 页：schedule / activities / friends / profile
    page: { type: String, value: '' }
  },

  data: {
    visible: false,
    bubble: null,
    panelOpen: false,
    suggestions: [],
    hasSuggestions: false,
    greeting: '',
    lang: 'zh',
    posStyle: '',
    dragging: false,
    snapping: false,
    wiggle: false,
    mascotPop: false,
    mascotSrc: DEFAULT_MASCOT,
    mascotSwitching: false
  },

  lifetimes: {
    attached() {
      this._lastRefresh = 0
      this._bubbleTimer = null
      this._ambientTimer = null
      this._wiggleTimer = null
      this._mascotTimer = null
      this._mascotIndex = -1
      this._ambientCount = 0
      this._context = null
      this._sharedCourses = []
      this._drag = null
      // 组件已改为纯点击入口，不再允许旧版拖拽坐标把小章鱼留在屏幕外。
      // 清掉历史位置后使用 CSS 的固定右下角位置，保证每个页面都能看见并点击。
      try { wx.removeStorageSync(POS_KEY) } catch (error) {}
      this._pos = null
      this.setData({ posStyle: '' })
    },
    detached() {
      this.clearBubbleTimer()
      this.stopAmbient()
      this.stopWiggle()
      this.stopMascotCycle()
    }
  },

  pageLifetimes: {
    show() {
      const app = getApp()
      const lang = app.getLanguage ? app.getLanguage() : 'zh'
      this.setData({ lang })
      const loggedIn = app.isLoggedIn && app.isLoggedIn()
      if (!loggedIn || !isCompanionEnabled()) {
        this.setData({ visible: false, bubble: null, suggestions: [], hasSuggestions: false })
        this.stopAmbient()
        return
      }
      // 页面恢复时再次清除旧坐标，防止热重载沿用上一个版本的 transform。
      this._pos = null
      this.setData({ visible: true, posStyle: '' })
      this._ambientCount = 0
      this.refresh()
      this.startAmbient()
      this.startWiggle()
      this.startMascotCycle()
    },
    hide() {
      this.clearBubbleTimer()
      this.stopAmbient()
      this.stopWiggle()
      this.stopMascotCycle()
      this.setData({ bubble: null, panelOpen: false, dragging: false, wiggle: false, mascotPop: false })
    }
  },

  methods: {
    noop() {},

    // ===== 位置：拖拽 + 持久化 =====
    metrics() {
      const info = getWindowInfo()
      const windowWidth = info.windowWidth || 375
      const windowHeight = info.windowHeight || 667
      const safeBottom = info.safeArea ? Math.max(0, windowHeight - info.safeArea.bottom) : 0
      const px = (rpx) => rpx * windowWidth / 750
      return {
        windowWidth,
        windowHeight,
        safeBottom,
        statusBar: Number(info.statusBarHeight) || 20,
        px,
        boxW: px(130),
        boxH: px(180)
      }
    },

    defaultPosition() {
      const m = this.metrics()
      return {
        x: m.windowWidth - m.px(24) - m.boxW,
        y: m.windowHeight - m.safeBottom - m.px(170) - m.boxH
      }
    },

    clampPosition(x, y, m) {
      m = m || this.metrics()
      return {
        x: Math.max(0, Math.min(m.windowWidth - m.boxW, x)),
        y: Math.max(m.statusBar + m.px(20), Math.min(m.windowHeight - m.safeBottom - m.px(120) - m.boxH, y))
      }
    },

    applyPosition(x, y) {
      // 拖动热路径：用 transform（仅合成层，不触发 layout），并跳过未变化的 setData
      const rx = Math.round(x)
      const ry = Math.round(y)
      if (this._pos && this._pos.x === rx && this._pos.y === ry) return
      this._pos = { x: rx, y: ry }
      this.setData({ posStyle: `left:0px; top:0px; right:auto; bottom:auto; transform:translate(${rx}px, ${ry}px);` })
    },

    restorePosition() {
      try {
        const saved = wx.getStorageSync(POS_KEY)
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
          const clamped = this.clampPosition(saved.x, saved.y)
          this.applyPosition(clamped.x, clamped.y)
        }
      } catch (error) {}
    },

    persistPosition() {
      if (!this._pos) return
      try {
        wx.setStorageSync(POS_KEY, this._pos)
      } catch (error) {}
    },

    // 切换日/周/月视图时重置气泡到默认位置（清除拖拽记忆），避免拖拽后残留在日历上遮挡课程
    resetPosition() {
      try { wx.removeStorageSync(POS_KEY) } catch (error) {}
      this._pos = null
      const p = this.defaultPosition()
      this.applyPosition(p.x, p.y)
      this.setData({ panelOpen: false, dragging: false, snapping: false })
    },

    onDragStart(event) {
      const touch = event.touches[0]
      const base = this._pos || this.defaultPosition()
      // 拖动期间缓存屏幕尺寸，避免每个 touchmove 都同步调用 wx.getWindowInfo()
      this._drag = { startX: touch.clientX, startY: touch.clientY, baseX: base.x, baseY: base.y, moved: false, m: this.metrics() }
    },

    onDragMove(event) {
      if (!this._drag) return
      const touch = event.touches[0]
      const dx = touch.clientX - this._drag.startX
      const dy = touch.clientY - this._drag.startY
      // 轻触时会有少量系统抖动，阈值过低会被误判为拖动，从而吞掉点击。
      if (!this._drag.moved && Math.abs(dx) + Math.abs(dy) < 16) return
      this._drag.moved = true
      const next = this.clampPosition(this._drag.baseX + dx, this._drag.baseY + dy, this._drag.m)
      if (!this.data.dragging) this.setData({ dragging: true, snapping: false })
      this.applyPosition(next.x, next.y)
    },

    onDragEnd() {
      if (!this._drag) return
      const moved = this._drag.moved
      this._drag = null
      if (!moved) return
      // 松手后吸附到最近的左右边缘
      const m = this.metrics()
      const current = this._pos || this.defaultPosition()
      const snapX = current.x + m.boxW / 2 < m.windowWidth / 2
        ? m.px(12)
        : m.windowWidth - m.boxW - m.px(12)
      this.setData({ dragging: false, snapping: true })
      this.applyPosition(snapX, current.y)
      this.persistPosition()
      this._suppressTap = true
      // 拖动手势有时不会再派发 tap；无论是否派发，都不能影响用户下一次真正的点击。
      setTimeout(() => {
        this._suppressTap = false
        this.setData({ snapping: false })
      }, 350)
    },

    // ===== 动作设计：待机摆动 & 冒泡时跳一下 =====
    startWiggle() {
      this.stopWiggle()
      this._wiggleTimer = setInterval(() => {
        if (this.data.dragging || this.data.panelOpen) return
        this.setData({ wiggle: true })
        setTimeout(() => {
          if (this.data.wiggle) this.setData({ wiggle: false })
        }, 1300)
      }, 9000)
    },

    stopWiggle() {
      if (this._wiggleTimer) {
        clearInterval(this._wiggleTimer)
        this._wiggleTimer = null
      }
    },

    // ===== 随机换肤：打破单一形象，定时轮换一张随机小章鱼 =====
    pickRandomMascot() {
      let next = Math.floor(Math.random() * MASCOT_FRAMES.length)
      if (MASCOT_FRAMES.length > 1 && next === this._mascotIndex) {
        next = (next + 1) % MASCOT_FRAMES.length
      }
      this._mascotIndex = next
      this.setData({ mascotSrc: MASCOT_FRAMES[next], mascotSwitching: true })
      setTimeout(() => {
        if (this.data.mascotSwitching) this.setData({ mascotSwitching: false })
      }, 600)
    },

    startMascotCycle() {
      this.stopMascotCycle()
      this.pickRandomMascot()
      this._mascotTimer = setInterval(() => {
        if (this.data.dragging || this.data.panelOpen) return
        this.pickRandomMascot()
      }, MASCOT_CYCLE_INTERVAL)
    },

    stopMascotCycle() {
      if (this._mascotTimer) {
        clearInterval(this._mascotTimer)
        this._mascotTimer = null
      }
    },

    popMascot() {
      this.setData({ mascotPop: true })
      setTimeout(() => this.setData({ mascotPop: false }), 550)
    },

    // ===== 环境气泡：时不时冒一句碎嘴 =====
    startAmbient() {
      this.stopAmbient()
      const delay = AMBIENT_MIN_INTERVAL + Math.random() * (AMBIENT_MAX_INTERVAL - AMBIENT_MIN_INTERVAL)
      this._ambientTimer = setTimeout(() => this.fireAmbient(), delay)
    },

    stopAmbient() {
      if (this._ambientTimer) {
        clearTimeout(this._ambientTimer)
        this._ambientTimer = null
      }
      this.stopWiggle()
    },

    fireAmbient() {
      this._ambientTimer = null
      const now = new Date()
      const hour = now.getHours()
      const quiet = hour >= QUIET_START || hour < QUIET_END
      if (quiet || this.data.panelOpen || this.data.bubble || this._ambientCount >= AMBIENT_MAX_PER_SHOW) {
        // 条件不满足则跳过本次，继续排队下一次
        this.startAmbient()
        return
      }
      this._ambientCount += 1
      this.setData({
        bubble: {
          type: 'ambient',
          icon: '🫧',
          priority: -1,
          dedupeKey: `ambient:${Date.now()}`,
          text: ambientLine(hour, this.data.lang)
        }
      })
      this.popMascot()
      this.clearBubbleTimer()
      this._bubbleTimer = setTimeout(() => this.setData({ bubble: null }), 6000)
      this.startAmbient()
    },

    clearBubbleTimer() {
      if (this._bubbleTimer) {
        clearTimeout(this._bubbleTimer)
        this._bubbleTimer = null
      }
    },

    // 用户每次点日程页的小章鱼都立即得到一句回应；这是本地轻量话术，
    // 不增加云端模型调用和等待时间。
    showScheduleTapBubble() {
      const lines = SCHEDULE_TAP_LINES[this.data.lang === 'en' ? 'en' : 'zh']
      const text = lines[Math.floor(Math.random() * lines.length)]
      this.setData({
        bubble: {
          type: 'schedule-tap',
          icon: '🐙',
          priority: 999,
          dedupeKey: `schedule-tap:${Date.now()}`,
          text
        }
      })
      this.popMascot()
      this.clearBubbleTimer()
      this._bubbleTimer = setTimeout(() => this.setData({ bubble: null }), BUBBLE_DURATION)
    },

    async refresh(force) {
      const now = Date.now()
      if (!force && this._context && now - this._lastRefresh < REFRESH_INTERVAL) return
      this._lastRefresh = now
      try {
        const data = await loadSharedData(force)
        const session = wx.getStorageSync('xipoo_session') || {}
        this._context = {
          courses: data.courses,
          friendships: data.friendships,
          subscriptions: data.subscriptions,
          activities: data.activities,
          ads: data.ads || [],
          adBlocklist: readAdBlocklist(),
          me: data.me || null,
          page: this.data.page,
          lang: this.data.lang,
          semester: readSemester(),
          seed: String(session.userId || '')
        }
        this._sharedCourses = []
        this.rebuild()
        this.enrichClassmates()
      } catch (error) {
        // 数据加载失败时保持静默，不影响页面使用
      }
    },

    rebuild() {
      if (!this._context) return
      const daily = readAdDaily()
      const suggestions = buildSuggestions(
        Object.assign({}, this._context, { sharedCourses: this._sharedCourses }),
        new Date()
      ).filter((item) => (
        // 推广卡片：超过每日展示上限后从面板消失
        !item.isPromotion || daily.impressions < AD_DAILY_IMPRESSION_CAP
      )).map((item) => {
        if (item.isPromotion) return item // 推广文案由后台投放，不走端上润色
        // 命中 AI 文案缓存时直接展示混元生成的版本
        const aiText = companionAi.getCachedPolish(item.type, item.vars, this.data.lang)
        return aiText ? Object.assign({}, item, { text: aiText, aiEnhanced: true }) : item
      })
      this.setData({ suggestions, hasSuggestions: suggestions.length > 0 })
      this.maybeShowBubble(suggestions)
      this.maybeShowWelcome()
    },

    // 首次见面提示（仅日程页、仅一次）：让用户一眼知道小章鱼 = AI 课表入口
    maybeShowWelcome() {
      if (this.data.page !== 'schedule' || this.data.bubble) return
      const KEY = 'xipoo_companion_met'
      try {
        if (wx.getStorageSync(KEY)) return
        wx.setStorageSync(KEY, Date.now())
      } catch (error) {}
      const zh = this.data.lang !== 'en'
      const welcome = {
        type: 'welcome',
        icon: '👋',
        priority: 999,
        dedupeKey: 'welcome',
        text: zh
          ? '嗨，我是噗噗！点我可以拍照生成课表，课程提醒、找搭子都交给我～'
          : 'Hi, I\'m Pupu! Tap me to build your schedule from a photo — reminders and buddy matching included.'
      }
      this.setData({ bubble: welcome })
      this.popMascot()
      this.clearBubbleTimer()
      this._bubbleTimer = setTimeout(() => {
        this.setData({ bubble: null })
      }, BUBBLE_DURATION + 4000)
    },

    // 推广埋点 + 本地每日计数（曝光/点击/关闭）
    trackAdEvent(item, type) {
      if (!item || !item.isPromotion) return
      api.trackCompanionAd(item.adId, type, item.scene || '')
      if (type === 'impression') {
        const daily = readAdDaily()
        daily.impressions += 1
        try {
          wx.setStorageSync(AD_DAILY_KEY, daily)
        } catch (error) {}
      }
    },

    // 推广卡片点 ×：永久拉黑该卡片（用户已拍板的策略）
    closePromotion(event) {
      const item = this.data.suggestions[Number(event.currentTarget.dataset.index)]
      if (!item || !item.isPromotion) return
      const blocklist = readAdBlocklist()
      if (!blocklist.includes(item.adId)) blocklist.push(item.adId)
      try {
        wx.setStorageSync(AD_BLOCK_KEY, blocklist.slice(-100))
      } catch (error) {}
      if (this._context) this._context.adBlocklist = blocklist
      api.trackCompanionAd(item.adId, 'close', item.scene || '')
      const suggestions = this.data.suggestions.filter((entry) => entry.adId !== item.adId)
      this.setData({ suggestions, hasSuggestions: suggestions.length > 0 })
    },

    // 主动气泡：只挑最高优先级、未在冷却期、非免打扰时段的一条
    maybeShowBubble(suggestions) {
      if (this.data.panelOpen) return
      const now = new Date()
      const hour = now.getHours()
      if (hour >= QUIET_START || hour < QUIET_END) return
      const cooldowns = readCooldowns()
      const adDaily = readAdDaily()
      const candidate = (suggestions || []).find((item) => {
        if (!item.proactive) return false
        // 推广气泡：每日独立上限，且不能超出当日总展示上限
        if (item.isPromotion && (
          adDaily.bubbles >= AD_DAILY_BUBBLE_CAP || adDaily.impressions >= AD_DAILY_IMPRESSION_CAP
        )) return false
        const seenAt = cooldowns[item.dedupeKey]
        if (!seenAt) return true
        const cooldownMs = Math.max(item.cooldownHours, 1) * 3600 * 1000
        // cooldownHours 为 0 的场景：dedupeKey 本身按天/按实例变化，见过就不再弹
        if (item.cooldownHours === 0) return false
        return Date.now() - seenAt >= cooldownMs
      })
      if (!candidate) return
      // 已有气泡在展示时，只有更高优先级的建议才允许替换，避免文案闪烁
      if (this.data.bubble && candidate.priority <= this.data.bubble.priority) return
      const seen = pruneCooldowns(cooldowns, Date.now())
      seen[candidate.dedupeKey] = Date.now()
      wx.setStorageSync(COOLDOWN_KEY, seen)
      this.setData({ bubble: candidate })
      this.popMascot()
      this.clearBubbleTimer()
      this._bubbleTimer = setTimeout(() => {
        this.setData({ bubble: null })
      }, BUBBLE_DURATION)
      if (candidate.isPromotion) {
        adDaily.bubbles += 1
        try {
          wx.setStorageSync(AD_DAILY_KEY, adDaily)
        } catch (error) {}
        this.trackAdEvent(candidate, 'impression')
      } else {
        // 模板文案先展示，混元润色结果返回后再原地升级
        this.polishSuggestion(candidate)
      }
    },

    // 调混元润色一条建议；成功后同步更新气泡与面板列表（失败静默保留模板文案）
    async polishSuggestion(item) {
      const text = await companionAi.polishSuggestion({
        type: item.type,
        vars: item.vars,
        fallback: item.text,
        lang: this.data.lang
      })
      if (!text) return
      const patch = {
        suggestions: this.data.suggestions.map((entry) => (
          entry.dedupeKey === item.dedupeKey ? Object.assign({}, entry, { text, aiEnhanced: true }) : entry
        ))
      }
      if (this.data.bubble && this.data.bubble.dedupeKey === item.dedupeKey) {
        patch.bubble = Object.assign({}, this.data.bubble, { text, aiEnhanced: true })
      }
      this.setData(patch)
    },

    buildGreetingSummary() {
      const context = this._context || {}
      const now = new Date()
      const todayCourses = coursesOnDate(context.courses || [], dateKey(now), context.semester)
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const next = todayCourses.find((course) => toMinutes(course.start) > nowMinutes)
      const upcomingActivities = (context.activities || []).filter((item) => item.date && item.date >= dateKey(now))
      return {
        weekday: `周${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`,
        courseCount: todayCourses.length,
        nextCourse: next ? (next.title || next.courseCode || '') : '',
        nextTime: next ? next.start : '',
        activityCount: upcomingActivities.length,
        activity: upcomingActivities[0] ? (upcomingActivities[0].titleZh || upcomingActivities[0].title || '') : '',
        freeThisAfternoon: !todayCourses.some((course) => toMinutes(course.end) > 12 * 60)
      }
    },

    async loadGreeting() {
      const now = new Date()
      const summary = this.data.lang === 'en'
        ? Object.assign({}, this.buildGreetingSummary(), { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()] })
        : this.buildGreetingSummary()
      const text = await companionAi.dailyGreeting(dateKey(now), summary, this.data.lang)
      if (text && this.data.panelOpen) this.setData({ greeting: text })
    },

    dismissBubble() {
      this.clearBubbleTimer()
      this.setData({ bubble: null })
    },

    async openPanel() {
      this.clearBubbleTimer()
      this.setData({ bubble: null, panelOpen: true })
      // 面板展示实时建议；先等数据就绪，再润色与生成寄语，避免寄语基于空上下文被缓存
      await this.refresh()
      this.data.suggestions.slice(0, 3).forEach((item) => {
        if (!item.isPromotion && !companionAi.getCachedPolish(item.type, item.vars, this.data.lang)) {
          this.polishSuggestion(item)
        }
      })
      // 面板里可见的推广卡片记一次曝光
      this.data.suggestions.forEach((item) => {
        if (item.isPromotion) this.trackAdEvent(item, 'impression')
      })
      this.loadGreeting()
    },

    closePanel() {
      this.setData({ panelOpen: false })
    },

    // 日程页每次点击都保留完整录入菜单，已导入过课表的用户也能继续上传或查看历史。
    onMascotTap() {
      // 纯点击入口不再受旧拖拽状态影响；即使用户曾拖动过，也必须立刻有反馈。
      this._suppressTap = false
      this.setData({ mascotPop: true })
      setTimeout(() => this.setData({ mascotPop: false }), 600)
      if (this.data.page === 'schedule') {
        this.showScheduleTapBubble()
        const zh = this.data.lang !== 'en'
        wx.showActionSheet({
          itemList: zh
            ? ['📷 AI 拍照上传课表', '🎙️ 语音录入日程', '✏️ 手动添加日程', '🗂️ 查看 AI 上传/识别记录', '🔵 意见反馈']
            : ['📷 Upload schedule with AI', '🎙️ Voice input', '✏️ Add manually', '🗂️ View AI import history', '🔵 Feedback'],
          success: (res) => {
            if (res.tapIndex === 0) this.triggerEvent('aiimport')
            else if (res.tapIndex === 1) this.triggerEvent('voiceimport')
            else if (res.tapIndex === 2) this.triggerEvent('addcourse')
            else if (res.tapIndex === 3) {
              wx.navigateTo({ url: '/packages/schedule/pages/settings/settings?focus=aiImports' })
            } else if (res.tapIndex === 4) {
              this.onFeedbackTap()
            }
          }
        })
      } else {
        this.openPanel()
      }
    },

    disableCompanion() {
      const zh = this.data.lang !== 'en'
      setCompanionEnabled(false)
      this.clearBubbleTimer()
      this.setData({ visible: false, bubble: null, panelOpen: false })
      wx.showToast({
        title: zh ? '已关闭，可在 我的-噗噗助手 重新开启' : 'Off. Re-enable in Profile → Pupu assistant',
        icon: 'none'
      })
    },

    // 长按小章鱼：提供关闭入口（可在「我的-设置」里重新打开）
    onMascotLongPress() {
      if (this._suppressTap) return // 拖拽结束误触
      const zh = this.data.lang !== 'en'
      wx.showActionSheet({
        itemList: [zh ? '关闭噗噗助手' : 'Hide Pupu assistant'],
        success: (res) => {
          if (res.tapIndex === 0) this.disableCompanion()
        }
      })
    },

    onDisableTap() {
      const zh = this.data.lang !== 'en'
      wx.showModal({
        title: zh ? '关闭噗噗助手？' : 'Hide Pupu assistant?',
        content: zh ? '关闭后不再显示小章鱼和智能提醒，可随时在「我的」页面重新开启。' : 'The mascot and suggestions will be hidden. You can re-enable them anytime in Profile.',
        confirmText: zh ? '关闭' : 'Hide',
        cancelText: zh ? '取消' : 'Cancel',
        success: (res) => {
          if (res.confirm) this.disableCompanion()
        }
      })
    },

    onFeedbackTap() {
      this.closePanel()
      wx.navigateTo({ url: '/packages/account/pages/feedbackCenter/feedback' })
    },

    onAiImport() {
      this.closePanel()
      if (this.data.page === 'schedule') {
        this.triggerEvent('aiimport')
        return
      }
      const app = getApp()
      if (app.globalData) app.globalData.pendingAiImport = true
      wx.switchTab({ url: '/pages/schedule/schedule' })
    },

    onActivityFinder() {
      this.closePanel()
      // 活动页复用其现有的“查找活动方”弹窗，避免助手按钮跳到无关的日程上传。
      this.triggerEvent('activityfinder')
    },

    onSuggestionTap(event) {
      const item = this.data.suggestions[Number(event.currentTarget.dataset.index)]
      if (!item || !item.action) return
      if (item.isPromotion) this.trackAdEvent(item, 'click')
      const action = item.action
      this.closePanel()
      if (action.kind === 'ai-import') {
        this.onAiImport()
      } else if (action.kind === 'switchTab') {
        wx.switchTab({ url: action.url })
      } else {
        wx.navigateTo({ url: action.url })
      }
    },

    // 异步补全「好友同课」：只查未来 12 小时内最近的一节课，每节课 12 小时内只查一次
    async enrichClassmates() {
      const context = this._context
      if (!context || !context.courses.length || !context.friendships.length) return
      const now = new Date()
      const today = dateKey(now)
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      const target = coursesOnDate(context.courses, today, context.semester).find((course) => {
        const diff = toMinutes(course.start) - nowMinutes
        return diff > -30 && diff <= CLASSMATE_CHECK_HOURS * 60
      })
      if (!target || (!target.courseId && !target.courseCode)) return
      const checkKey = `xipoo_companion_classmate_${target.courseId || target.courseCode}_${today}`
      if (wx.getStorageSync(checkKey)) return
      wx.setStorageSync(checkKey, Date.now())
      const friends = context.friendships
        .filter((item) => item.friendShare && item.friend && item.friend.id)
        .slice(0, 3)
      if (!friends.length) return
      const results = await Promise.all(
        friends.map((item) => api.getFriendSchedule(item.friend.id).catch(() => null))
      )
      const shared = []
      results.forEach((friendCourses, index) => {
        if (!Array.isArray(friendCourses)) return
        const hit = friendCourses.find((course) => {
          // 同 courseId（同班）直接命中；courseId 不同时退化为同课程代码 + 时间重叠（Lecture/Lab 不同班也算同课）
          const sameCourse = target.courseId && course.courseId === target.courseId
          const sameCode = target.courseCode && course.courseCode === target.courseCode
          if (!sameCourse && !sameCode) return false
          return coursesOnDate([course], today, context.semester).length > 0 &&
            Math.abs(toMinutes(course.start) - toMinutes(target.start)) < 90
        })
        if (hit) {
          shared.push({
            friendId: friends[index].friend.id,
            friendName: friends[index].friend.name || '',
            course: target
          })
        }
      })
      if (shared.length) {
        this._sharedCourses = shared
        this.rebuild()
      }
    }
  }
})
