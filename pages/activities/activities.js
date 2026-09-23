const api = require('../../utils/api')
const { resolveCloudImages } = require('../../utils/cloudImage')
const { getWindowInfo } = require('../../utils/device')
const { withActivityStatus } = require('../../utils/activityStatus')
const { isJumpActivity, isNativeReservation, buildJumpTarget } = require('../../utils/activityJump')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
// 活动列表分页大小：首页快速渲染后后台自动补齐剩余页，保证月历/单日等视图数据完整
const ACTIVITY_PAGE_SIZE = 20
const CATEGORY_OPTIONS = {
  zh: [
    { key: 'all', label: '全部' },
    { key: 'college', label: '学院' },
    { key: 'club', label: '社团' },
    { key: 'merchant', label: '商家' },
    { key: 'other', label: '其他' }
  ],
  en: [
    { key: 'all', label: 'All' },
    { key: 'college', label: 'College' },
    { key: 'club', label: 'Club' },
    { key: 'merchant', label: 'Merchant' },
    { key: 'other', label: 'Other' }
  ]
}
/*
const DISCOVERY_TAGS = {
  zh: [
    { key: 'all', label: 'TC' },
    { key: 'sip', label: 'SIP' },
    { key: 'college', label: '学院' },
    { key: 'immersion', label: '沉浸空间' }
  ],
  en: [
    { key: 'all', label: 'TC' },
    { key: 'sip', label: 'SIP' },
    { key: 'college', label: 'College' },
    { key: 'immersion', label: 'Immersion' }
  ]
}
*/


/*
const DISCOVERY_TAGS = {
  zh: [
    { key: 'all', label: '全部' },
    { key: 'sip', label: 'SIP' },
    { key: 'tc', label: 'TC' },
    { key: 'college', label: '学院' },
    { key: 'immersion', label: '沉浸空间' }
  ],
  en: [
    { key: 'all', label: 'All' },
    { key: 'sip', label: 'SIP' },
    { key: 'tc', label: 'TC' },
    { key: 'college', label: 'College' },
    { key: 'immersion', label: 'Immersion' }
  ]
}

*/

const DISCOVERY_TAGS = {
  zh: [
    { key: 'all', label: 'TC' },
    { key: 'sip', label: 'SIP' },
    { key: 'college', label: '学院' },
    { key: 'immersion', label: '沉浸空间' }
  ],
  en: [
    { key: 'all', label: 'TC' },
    { key: 'sip', label: 'SIP' },
    { key: 'college', label: 'College' },
    { key: 'immersion', label: 'Immersion' }
  ]
}


function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function todayParts() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
}

function formatDateLabel(dateStr, lang) {
  if (!dateStr) return ''
  const parts = dateStr.split('-').map(Number)
  if (parts.length < 3) return dateStr
  const [, month, day] = parts
  return lang === 'en' ? `${month}/${day}` : `${month}月${day}日`
}

const PAGE_COPY = {
  zh: {
    activities: '活动', subtitle: '广场发现活动，个人视图管理日程。', sources: '活动方',
    calendar: '个人活动视图', discover: '活动广场', list: '列表', day: '单日', twoDay: '双日', month: '月',
    noEvents: '暂无活动', addSchedule: '添加日程', noSchedule: '暂无日程',
    noOrganizers: '暂无活动方或活动', adjustFilters: '可调整关键词或标签筛选。',
    createPrompt: '去创建日程吧', createSchedule: '新建日程', selectActivities: '查找活动方',
    flash: '热门活动', swipeHint: '左右滑动查看', recommended: '推荐活动', activitiesUnit: '个活动',
    allDay: '全天', selectActivitiesTitle: '选择活动方', done: '完成', searchOrganizers: '搜索活动方',
    organizers: '活动方订阅', organizersHint: '订阅后，该活动方发布的内容才会进入活动中心。',
    calendarSources: '筛选活动方', allSources: '全部活动方', selectedSources: '已选择', sourcePickerHint: '选择后，月历仅显示所选活动方的活动。',
    showing: '显示中', show: '显示', selectedDateActivities: '当天活动',
    tabSubscribed: '已订阅', tabAll: '全部活动方', subscribe: '订阅', unsubscribe: '取消订阅',
    hide: '隐藏', calendarPickerHint: '如需订阅新活动方，请前往【发现】页面查找',
    loadingMore: '正在加载更多活动…', viewDetail: '查看详情',
    featuredOrganizers: '优秀活动方', more: '更多', findOrganizersSub: '订阅学院与社团，新活动不错过', hotBadge: '🔥 热门'
  },
  en: {
    activities: 'Activities', subtitle: 'Discover activities in the Square, manage yours in My view.', sources: 'Organizers',
    calendar: 'My Activities', discover: 'Activity Square', list: 'List', day: 'Day', twoDay: '2-Day', month: 'Month',
    noEvents: 'No events', addSchedule: 'Add schedule', noSchedule: 'No schedule',
    noOrganizers: 'No organizers or activities', adjustFilters: 'Try another keyword or tag.',
    createPrompt: 'Create a schedule for this day.', createSchedule: 'New schedule', selectActivities: 'Find organizers',
    flash: 'Featured activities', swipeHint: 'Swipe to browse', recommended: 'Recommended activities', activitiesUnit: 'activities',
    allDay: 'All day', selectActivitiesTitle: 'Choose organizers', done: 'Done', searchOrganizers: 'Search organizers',
    organizers: 'Organizer subscriptions', organizersHint: 'Only subscribed organizers appear in your activity center.',
    calendarSources: 'Filter organizers', allSources: 'All organizers', selectedSources: 'Selected', sourcePickerHint: 'The calendar only shows activities from selected organizers.',
    showing: 'Showing', show: 'Show', selectedDateActivities: 'Activities for this day',
    tabSubscribed: 'Subscribed', tabAll: 'All organizers', subscribe: 'Subscribe', unsubscribe: 'Unsubscribe',
    hide: 'Hide', calendarPickerHint: 'To subscribe to new organizers, go to the Discover tab.',
    loadingMore: 'Loading more activities…', viewDetail: 'View details',
    featuredOrganizers: 'Featured organizers', more: 'More', findOrganizersSub: 'Follow organizers and never miss an event', hotBadge: '🔥 HOT'
  }
}

function formatMonthTitle(year, month, lang) {
  return lang === 'en' ? `${month + 1}/${year}` : `${year}年${month + 1}月`
}

// 热门轮播上限（与云函数 activity 的 HOT_FLASH_LIMIT 保持一致）
const HOT_FLASH_LIMIT = 5

// 马卡龙配色圆点
const DOT_COLORS = [
  '#5EB5F7', '#F7A76C', '#5EC78A', '#F76C6C', '#A78BFA',
  '#F7D15E', '#6CD9C8', '#F78BC1', '#8BC4F7', '#C5F76C'
]

// 星期缩写
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_LABEL_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function decoratePublisher(item, selectedKeys, lang) {
  const isEn = lang === 'en'
  return Object.assign({}, item, {
    selected: selectedKeys.includes(item.key),
    displayName: isEn ? (item.name || item.nameZh || '') : (item.nameZh || item.name || ''),
    description: isEn ? (item.description || item.descriptionZh || '') : (item.descriptionZh || item.description || ''),
    initial: (item.nameZh || item.name || '活').slice(0, 1),
    discoveryTags: item.discoveryTags || []
  })
}

// 校区只允许有一个归属。campus 是新数据的权威字段；旧数据缺失时再从标签推导。
function getPublisherCampus(publisher) {
  if (publisher && (publisher.campus === 'tc' || publisher.campus === 'sip')) {
    return publisher.campus
  }
  const tags = (publisher && publisher.discoveryTags) || []
  return tags.includes('sip') ? 'sip' : 'tc'
}

function matchDiscoveryTag(publisher, tagKey) {
  if (tagKey === 'all') return true
  const tags = publisher.discoveryTags || []
  // TC / SIP 是互斥的校区筛选，不能与 discoveryTags 混用，否则旧数据会同时出现在两个校区。
  if (tagKey === 'tc' || tagKey === 'sip') return getPublisherCampus(publisher) === tagKey
  return tags.includes(tagKey)
}

// 列表页不需要 comments 等大字段，剥离后再进 data，控制 setData 序列化体积
function slimActivity(item) {
  if (!item) return item
  const slim = Object.assign({}, item)
  delete slim.comments
  return slim
}

function decorateActivity(item, publishers, lang) {
  const publisher = publishers.find((entry) => entry.key === item.publisherKey) || {}
  const isEn = lang === 'en'
  const typeText = `${item.typeZh || ''} ${item.typeEn || ''} ${item.hostZh || ''} ${item.hostEn || ''} ${publisher.nameZh || ''} ${publisher.name || ''} ${(item.tagsZh || []).join(' ')}`
  let category = 'other'
  if (/学院|College|School/i.test(typeText)) category = 'college'
  else if (/社团|club|Club|学生会|协会/i.test(typeText)) category = 'club'
  else if (/商家|市集|market|merchant|企业|career|Career/i.test(typeText)) category = 'merchant'
  // 状态标签统一规范（模块 5）：报名中/已满员/即将开始/已结束
  const withStatus = withActivityStatus(item, lang)
  return Object.assign({}, item, {
    statusKey: withStatus.statusKey,
    statusText: withStatus.statusText,
    displayTitle: isEn ? (item.titleEn || item.title || item.titleZh || '') : (item.titleZh || item.title || item.titleEn || ''),
    displayType: isEn ? (item.typeEn || item.type || item.typeZh || '') : (item.typeZh || item.type || item.typeEn || ''),
    displayDesc: isEn ? (item.descEn || item.desc || item.descZh || '') : (item.descZh || item.desc || item.descEn || ''),
    displayPlace: isEn ? (item.placeEn || item.place || item.placeZh || '') : (item.placeZh || item.place || item.placeEn || ''),
    displayHost: isEn ? (item.hostEn || item.host || item.hostZh || '') : (item.hostZh || item.host || item.hostEn || ''),
    displayTags: isEn ? (item.tagsEn || item.tags || item.tagsZh || []) : (item.tagsZh || item.tags || item.tagsEn || []),
    publisherName: isEn ? (publisher.name || publisher.nameZh || item.publisherKey) : (publisher.nameZh || publisher.name || item.publisherKey),
    publisherInitial: (isEn ? (publisher.name || publisher.nameZh || 'A') : (publisher.nameZh || publisher.name || '活')).slice(0, 1),
    publisherAccent: publisher.accent || '#65e882',
    category,
    categoryLabel: (CATEGORY_OPTIONS[lang] || CATEGORY_OPTIONS.zh).find((entry) => entry.key === category).label,
    registeredText: item.registered
      ? (isEn ? 'Registered' : '已报名')
      : (isEn ? 'Register' : '报名'),
    scheduleText: item.scheduled
      ? (isEn ? 'Added to schedule' : '已加入活动表')
      : (isEn ? 'Add to schedule' : '加入活动表'),
    timeLabel: item.start && item.end ? `${item.start}-${item.end}` : (isEn ? 'All day' : '全天'),
    displayTime: [
      item.date,
      item.start && item.end ? `${item.start}-${item.end}` : (item.start || '')
    ].filter(Boolean).join(' ')
  })
}

function buildCalendar(year, month, activities, selectedDate) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const previousDays = new Date(year, month, 0).getDate()
  const cells = []
  for (let index = 0; index < 42; index += 1) {
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
      day = previousDays + offset
      currentMonth = false
    } else if (offset > days) {
      cellMonth += 1
      if (cellMonth > 11) {
        cellMonth = 0
        cellYear += 1
      }
      day = offset - days
      currentMonth = false
    }
    const date = dateKey(cellYear, cellMonth, day)
    const dayActivities = activities.filter((item) => item.date === date)
    cells.push({
      date,
      day,
      currentMonth,
      selected: date === selectedDate,
      activityCount: dayActivities.length,
      dots: dayActivities.slice(0, 3).map((item) => ({
        id: item.id,
        color: '#279b59'
      }))
    })
  }
  return cells
}

const initialToday = todayParts()
const initialSelectedDate = dateKey(initialToday.year, initialToday.month, initialToday.day)

Page({
  data: {
    bannerVisible: false,
    bannerRequest: {},
    isGuest: false,
    viewMode: 'discovery',
    searchKeyword: '',
    activeCategory: 'all',
    activeDiscoveryTag: 'all',
    categoryOptions: CATEGORY_OPTIONS.zh,
    discoveryTags: DISCOVERY_TAGS.zh,
    activities: [],
    visibleActivities: [],
    leftActivities: [],
    rightActivities: [],
    visiblePublishers: [],
    subscriptions: [],
    subscribedSources: [],
    selectedPublisherKeys: [],
    calendarPublisherKey: 'all',
    subscriptionLoadingKey: '',
    discoveryPickerOpen: false,
    pickerSource: 'calendar',
    pickerTab: 'subscribed',
    flashIndex: 0,
    flashActivities: [],
    feedCount: 0,
    sourceFilterCollapsed: false,
    calendarYear: initialToday.year,
    calendarMonth: initialToday.month,
    calendarTitle: `${initialToday.year}年${initialToday.month + 1}月`,
    calendarCells: [],
    weekdays: WEEKDAYS,
    selectedDate: initialSelectedDate,
    selectedDateLabel: formatDateLabel(initialSelectedDate, 'zh'),
    copy: PAGE_COPY.zh,
    selectedDayActivities: [],
    actionLoadingId: '',
    // 发现页：优秀活动方横滑卡片 + 查找入口横幅头像串
    featuredPublishers: [],
    heroPublishers: [],
    lang: 'zh',
    loading: false,
    loadingMore: false,
    hasMore: false,
    // 视图切换
    viewDropdownOpen: false,
    viewType: 'month',
    viewTypeLabel: '月',
    viewOptions: [
      { key: 'list', label: '列表', icon: '☰' },
      { key: 'single', label: '单日', icon: '☀' },
      { key: 'double', label: '双日', icon: '◫' },
      { key: 'month', label: '月', icon: '☷' }
    ],
    weekStrip: [],
    monthGroups: [],
    // 单日视图
    singleDaySlots: [],
    singleDayWeekday: '',
    // 双日视图
    doubleDaySlots: [],
    doubleDayLabel1: '',
    doubleDayLabel2: '',
    // 月视图
    monthCells: [],
    selectedDateActivities: [],
    sourceSelectionText: PAGE_COPY.zh.allSources,
    // 单/双日交互态
    singleActiveHour: -1,
    doubleActiveCol: -1,
    doubleActiveHour: -1,
    // 月份选择器
    monthPickerOpen: false,
    pickerValue: [0, 0],
    pickerYears: [],
    pickerMonths: [],
    _pickerYear: 0,
    _pickerMonth: 0,
    // 单日日期选择器
    singleDayTitle: '',
    dayPickerOpen: false,
    dayPickerValue: [0, 0],
    dayPickerMonths: [],
    dayPickerDays: [],
    _dpMonth: 0,
    _dpDay: 0,
    statusBarHeight: 20,
    // 新手引导
    introGuideVisible: false,
    introSteps: []
  },

  onLoad() {
    const windowInfo = getWindowInfo()
    this.setData({ statusBarHeight: Number(windowInfo.statusBarHeight) || 20 })
  },

  onShow() {
    const app = getApp()
    const isGuest = app.isLoggedIn ? !app.isLoggedIn() : false
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const langChanged = this._lastLang !== lang
    this._lastLang = lang
    const copy = PAGE_COPY[lang] || PAGE_COPY.zh
    // 保留用户当前视图状态，不再每次切 tab 强制回退日历/月视图（避免视图树重建卡顿）
    const currentView = this.data.viewType || 'month'
    const patch = {
      lang,
      isGuest,
      selectedDateLabel: formatDateLabel(this.data.selectedDate, lang),
      calendarTitle: formatMonthTitle(this.data.calendarYear, this.data.calendarMonth, lang),
      viewTypeLabel: [
        { key: 'list', label: copy.list },
        { key: 'single', label: copy.day },
        { key: 'double', label: copy.twoDay },
        { key: 'month', label: copy.month }
      ].find((item) => item.key === currentView).label
    }
    // 语言未变时跳过静态文案/选项的大对象 setData，减少切 tab 时的序列化与 diff 开销
    if (langChanged) {
      Object.assign(patch, {
        copy,
        categoryOptions: CATEGORY_OPTIONS[lang] || CATEGORY_OPTIONS.zh,
        discoveryTags: DISCOVERY_TAGS[lang] || DISCOVERY_TAGS.zh,
        viewOptions: [
          { key: 'list', label: copy.list, icon: '☰' },
          { key: 'single', label: copy.day, icon: '☀' },
          { key: 'double', label: copy.twoDay, icon: '◫' },
          { key: 'month', label: copy.month, icon: '☷' }
        ]
      })
    }
    this.setData(patch, () => {
      wx.setNavigationBarTitle({ title: copy.activities })
      if (this._lastPageLoadAt && Date.now() - this._lastPageLoadAt < 30000) {
        // 30 秒内避免重复请求；超过后静默拉取第一页，保证新发布活动及时出现。
        if (langChanged) this.refreshVisible()
        // 缓存新鲜期内仍刷新活动方订阅列表，保证后台改动及时可见
        // 延迟到 tab 切换动画结束后再发起，避免云函数往返 + setData 卡在切换瞬间
        setTimeout(() => this.refreshSubscriptions(), 400)
        return
      }
      // 延迟到 tab 切换动画结束后再加载，避免切 tab 瞬间卡顿
      setTimeout(() => this.loadPageData(), 200)
    })
    // 新手引导检查
    setTimeout(() => this.checkIntroGuide(), 800)
  },

  async loadPageData(isRefresh = false) {
    if (this.data.loading && !isRefresh) return
    // 已有内容时不闪 loading 态，后台静默刷新，避免视觉跳动
    if (!this.data.activities.length) this.setData({ loading: true })

    try {
      const app = getApp()
      const prefetchedActivities = app && app._activitiesPrefetch
      if (app) app._activitiesPrefetch = null
      const activityRequest = prefetchedActivities
        ? prefetchedActivities.then((result) => result || api.getActivities({ page: 1, pageSize: ACTIVITY_PAGE_SIZE }))
        : api.getActivities({ page: 1, pageSize: ACTIVITY_PAGE_SIZE })
      const [activityResult, subscriptions, curatedResult] = await Promise.all([
        activityRequest,
        api.getActivitySubscriptions(),
        api.getCuratedActivities()
      ])
      // 云函数失败时 api 层回退 mock 数据并打 __cloudFailed 标记，
      // 这类结果不能覆盖已有的真实数据，否则云端抖动会导致界面内容跳变
      if ((activityResult && activityResult.__cloudFailed) || (subscriptions && subscriptions.__cloudFailed)) {
        this.setData({ loading: false })
        wx.showToast({
          title: this.data.lang === 'en' ? 'Cloud unavailable, local data kept' : '云服务暂不可用，已保留现有数据',
          icon: 'none'
        })
        return
      }
      // 兼容分页数据结构：新版返回 { list, pagination }，旧版直接返回数组
      const activities = Array.isArray(activityResult) ? activityResult : (activityResult && activityResult.list ? activityResult.list : [])
      const pagination = activityResult && activityResult.pagination ? activityResult.pagination : null
      this._activityPage = 1
      // 活动方 Logo 可能是 cloud:// fileID，需换临时 URL 才能展示
      const subscriptionsWithLogo = await resolveCloudImages(subscriptions, 'logoUrl')
      this._rawSubscriptions = subscriptionsWithLogo
      // 封面是 cloud:// 文件 ID 时需先换取临时 URL，否则渲染层会按相对路径加载而失败
      // 批量一次换取 + 模块级缓存，避免逐条 N 次网络往返
      const resolvedActivities = await resolveCloudImages(activities, 'coverUrl')
      // 运营位（热门/推荐）独立装饰，供 refreshVisible 使用；不受订阅与分页限制
      const decorateCurated = async (list) => {
        const resolved = await resolveCloudImages(Array.isArray(list) ? list : [], 'coverUrl')
        return resolved.map((item) => decorateActivity(slimActivity(item), subscriptions, this.data.lang))
      }
      this._curatedHot = await decorateCurated(curatedResult && curatedResult.hot)
      this._curatedRecommended = await decorateCurated(curatedResult && curatedResult.recommended)
      const subscribedSources = subscriptionsWithLogo.filter((item) => item.subscribed)
      const availableKeys = subscribedSources.map((item) => item.key)
      const keptKeys = this.data.selectedPublisherKeys.filter((key) => availableKeys.includes(key))
      const selectedPublisherKeys = keptKeys.length ? keptKeys : availableKeys
      const decorated = resolvedActivities.map((item, index) => Object.assign(
        decorateActivity(slimActivity(item), subscriptions, this.data.lang),
        { dotColor: DOT_COLORS[index % DOT_COLORS.length] }
      ))

      // 合并本地存储的日程
      const localSchedules = wx.getStorageSync('local_schedules') || []
      const localDecorated = localSchedules.map((item, idx) => ({
        id: item.id,
        title: item.title,
        titleZh: item.title,
        titleEn: item.title,
        displayTitle: item.title,
        date: item.date,
        start: item.startTime,
        end: item.endTime,
        placeZh: item.location || '',
        placeEn: item.location || '',
        displayPlace: item.location || '',
        descZh: item.description || '',
        descEn: item.description || '',
        displayDesc: item.description || '',
        publisherKey: 'local',
        publisherName: '本地日程',
        publisherInitial: '本',
        publisherAccent: '#35c76f',
        displayTags: [],
        registered: false,
        registeredText: '',
        dotColor: DOT_COLORS[idx % DOT_COLORS.length],
        timeLabel: item.allDay ? this.data.copy.allDay : `${item.startTime}-${item.endTime}`,
        displayTime: item.allDay ? `${item.date} ${this.data.copy.allDay}` : `${item.date} ${item.startTime}-${item.endTime}`,
        isLocal: true
      }))

      this.setData({
        activities: [...decorated, ...localDecorated],
        subscriptions: subscriptionsWithLogo.map((item) => decoratePublisher(item, selectedPublisherKeys, this.data.lang)),
        subscribedSources: subscribedSources.map((item) => decoratePublisher(item, selectedPublisherKeys, this.data.lang)),
        selectedPublisherKeys,
        hasMore: pagination ? pagination.hasMore : false,
        loading: false
      })
      this.refreshVisible()
      this._lastPageLoadAt = Date.now()
      // 首页渲染完成后后台自动补齐后续分页，保证月历等聚合视图拿到完整数据
      // 补齐过程静默进行（不逐页 refreshVisible），全部到齐后统一刷一次，避免连发大 setData 卡顿
      if (pagination && pagination.hasMore) this.loadMore(true)
    } catch (error) {
      this.setData({ loading: false })
      // 离线兜底：仅加载本地日程
      const localSchedules = wx.getStorageSync('local_schedules') || []
      const localDecorated = localSchedules.map((item, idx) => ({
        id: item.id,
        title: item.title,
        titleZh: item.title,
        titleEn: item.title,
        displayTitle: item.title,
        date: item.date,
        start: item.startTime,
        end: item.endTime,
        placeZh: item.location || '',
        placeEn: item.location || '',
        displayPlace: item.location || '',
        descZh: item.description || '',
        descEn: item.description || '',
        displayDesc: item.description || '',
        publisherKey: 'local',
        publisherName: '本地日程',
        publisherInitial: '本',
        publisherAccent: '#35c76f',
        displayTags: [],
        registered: false,
        registeredText: '',
        dotColor: DOT_COLORS[0],
        timeLabel: item.allDay ? this.data.copy.allDay : `${item.startTime}-${item.endTime}`,
        displayTime: item.allDay ? `${item.date} ${this.data.copy.allDay}` : `${item.date} ${item.startTime}-${item.endTime}`,
        isLocal: true
      }))
      this.setData({ activities: localDecorated })
      this.refreshVisible()
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load activities' : '活动加载失败'),
        icon: 'none'
      })
    }
  },

  // 加载下一页活动：onReachBottom 触发，首页加载后也会自动链式补齐
  // silent=true 表示后台补齐页：不逐页 refreshVisible，链尾统一刷新一次
  async loadMore(silent = false) {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    try {
      const nextPage = (this._activityPage || 1) + 1
      const activityResult = await api.getActivities({ page: nextPage, pageSize: ACTIVITY_PAGE_SIZE })
      const list = Array.isArray(activityResult) ? activityResult : (activityResult && activityResult.list ? activityResult.list : [])
      const pagination = activityResult && activityResult.pagination ? activityResult.pagination : null
      const resolved = await resolveCloudImages(list, 'coverUrl')
      const subscriptions = this._rawSubscriptions || []
      const existingIds = new Set(this.data.activities.map((item) => item.id))
      const decorated = resolved
        .filter((item) => !existingIds.has(item.id))
        .map((item, index) => Object.assign(
          decorateActivity(slimActivity(item), subscriptions, this.data.lang),
          { dotColor: DOT_COLORS[(this.data.activities.length + index) % DOT_COLORS.length] }
        ))
      // 本地日程始终排在云端活动之后
      const localItems = this.data.activities.filter((item) => item.isLocal)
      const cloudItems = this.data.activities.filter((item) => !item.isLocal)
      this._activityPage = nextPage
      this.setData({
        activities: [...cloudItems, ...decorated, ...localItems],
        hasMore: pagination ? pagination.hasMore : false,
        loadingMore: false
      })
      if (pagination && pagination.hasMore) {
        // 还有后续页则继续后台补齐（保持静默，仅链尾刷新一次）
        await this.loadMore(silent)
        return
      }
      this.refreshVisible()
    } catch (error) {
      this.setData({ loadingMore: false })
      if (!silent) {
        wx.showToast({
          title: (error && error.message) || (this.data.lang === 'en' ? 'Failed to load more' : '加载下一页失败，请上拉重试'),
          icon: 'none'
        })
      }
    }
  },

  onReachBottom() {
    this.loadMore()
  },

  // 静默刷新活动方订阅列表：后台（管理端）修改活动方后，无需等待全量缓存过期即可看到最新数据
  async refreshSubscriptions() {
    try {
      const subscriptions = await api.getActivitySubscriptions()
      // 云端失败时 api 层回退 mock 并打 __cloudFailed 标记，不能用其覆盖现有真实数据
      if (!Array.isArray(subscriptions) || subscriptions.__cloudFailed) return
      // 同步刷新运营位（热门/推荐），后台改动即时可见
      const curatedResult = await api.getCuratedActivities()
      if (curatedResult && !curatedResult.__cloudFailed) {
        const decorateCurated = async (list) => {
          const resolved = await resolveCloudImages(Array.isArray(list) ? list : [], 'coverUrl')
          return resolved.map((item) => decorateActivity(slimActivity(item), subscriptions, this.data.lang))
        }
        this._curatedHot = await decorateCurated(curatedResult.hot)
        this._curatedRecommended = await decorateCurated(curatedResult.recommended)
      }
      // 活动方 Logo 可能是 cloud:// fileID，需换临时 URL 才能展示
      const subscriptionsWithLogo = await resolveCloudImages(subscriptions, 'logoUrl')
      this._rawSubscriptions = subscriptionsWithLogo
      const subscribedSources = subscriptionsWithLogo.filter((item) => item.subscribed)
      const availableKeys = subscribedSources.map((item) => item.key)
      const keptKeys = this.data.selectedPublisherKeys.filter((key) => availableKeys.includes(key))
      const selectedPublisherKeys = keptKeys.length ? keptKeys : availableKeys
      this.setData({
        subscriptions: subscriptionsWithLogo.map((item) => decoratePublisher(item, selectedPublisherKeys, this.data.lang)),
        subscribedSources: subscribedSources.map((item) => decoratePublisher(item, selectedPublisherKeys, this.data.lang)),
        selectedPublisherKeys
      })
      this.refreshVisible()
    } catch (error) {
      // 静默失败，保留现有数据
    }
  },

  refreshVisible() {
    const keyword = this.data.searchKeyword.trim().toLowerCase()
    const isDiscovery = this.data.viewMode === 'discovery'
    const publisherMap = {}
    this.data.subscriptions.forEach((entry) => {
      publisherMap[entry.key] = entry
    })

    let visibleActivities = this.data.activities.filter((item) => {
      // 本地日程直接放行
      if (item.isLocal || item.publisherKey === 'local') return true
      // 发现页：不按订阅过滤，只按校区/兴趣标签过滤，新用户无订阅也能看到活动
      if (isDiscovery) {
        const publisher = publisherMap[item.publisherKey] || {}
        const matchTag = matchDiscoveryTag(publisher, this.data.activeDiscoveryTag)
        if (!matchTag) return false
        return true
      }
      // 日历视图：仅显示已订阅活动方的活动
      const matchPublisher = this.data.selectedPublisherKeys.includes(item.publisherKey)
      if (!matchPublisher) return false
      return true
    })

    const visiblePublishers = this.data.subscriptions.filter((item) => {
      const matchTag = matchDiscoveryTag(item, this.data.activeDiscoveryTag)
      const searchText = [item.displayName, item.description].join(' ').toLowerCase()
      const matchSearch = !keyword || searchText.includes(keyword)
      return matchTag && matchSearch
    })

    const leftActivities = []
    const rightActivities = []
    // 运营位独立拉取（不受订阅与分页限制），仍跟随发现页标签与搜索；
    // 后台未配置时回退为全部可见活动，避免页面空白
    const curatedHot = this._curatedHot || []
    const curatedRec = this._curatedRecommended || []
    // 热门轮播上限 HOT_FLASH_LIMIT 个，超出部分按日期倒序截断
    const matchCurated = (item) => {
      if (item.isLocal) return false
      if (isDiscovery) {
        const publisher = publisherMap[item.publisherKey] || {}
        if (!matchDiscoveryTag(publisher, this.data.activeDiscoveryTag)) return false
      }
      if (keyword) {
        const text = [item.displayTitle, item.publisherName, item.displayPlace].join(' ').toLowerCase()
        if (!text.includes(keyword)) return false
      }
      return true
    }
    const flashActivities = curatedHot.length
      ? curatedHot.filter(matchCurated).slice(0, HOT_FLASH_LIMIT)
      : visibleActivities
    const flashIndex = flashActivities.length
      ? Math.min(this.data.flashIndex, flashActivities.length - 1)
      : 0
    const feedActivities = curatedRec.length
      ? curatedRec.filter(matchCurated)
      : visibleActivities
    feedActivities.forEach((item, index) => {
      if (index % 2) rightActivities.push(item)
      else leftActivities.push(item)
    })

    // 按需构建当前视图数据，避免一次性计算所有视图
    const viewType = this.data.viewType
    const weekStrip = (viewType === 'list') ? this.buildWeekStrip() : []
    const monthGroups = (viewType === 'list') ? this.buildMonthGroups(visibleActivities) : []
    const singleDaySlots = (viewType === 'single') ? this.buildSingleDaySlots(visibleActivities) : []
    const doubleDaySlots = (viewType === 'double') ? this.buildDoubleDaySlots(visibleActivities) : []
    const monthCells = (viewType === 'month') ? this.buildMonthCells(visibleActivities) : []
    const selectedDateActivities = visibleActivities
      .filter((item) => item.date === this.data.selectedDate)
      .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
    const selectedSources = this.data.subscriptions.filter((item) => this.data.selectedPublisherKeys.includes(item.key))
    let sourceSelectionText = this.data.copy.allSources
    if (selectedSources.length === 1) sourceSelectionText = selectedSources[0].displayName
    else if (selectedSources.length && selectedSources.length < this.data.subscriptions.length) {
      sourceSelectionText = `${this.data.copy.selectedSources} ${selectedSources.length}`
    }
    const todayDate = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
    const selectedDayIdx = WEEKDAYS.indexOf(WEEKDAY_SHORT[new Date(this.data.selectedDate).getDay()])

    // 发布方装饰结果仅在 语言/选中源/订阅数据 变化时重建，保持数组引用稳定，
    // 避免每次刷新都生成新对象触发订阅列表整体重渲染
    const decorated = this.getDecoratedPublishers()

    // 优秀活动方：沿用现有排序（置顶 → 排序权重），后台改动即时生效；头像串取前 4
    const featuredPublishers = decorated.subscriptions.slice(0, 6)
    const heroPublishers = decorated.subscriptions.slice(0, 4)

    this.setData({
      visibleActivities,
      flashActivities,
      flashIndex,
      feedCount: feedActivities.length,
      leftActivities,
      rightActivities,
      visiblePublishers,
      featuredPublishers,
      heroPublishers,
      weekStrip,
      monthGroups,
      singleDaySlots,
      singleDayWeekday: (this.data.lang === 'en' ? WEEKDAY_LABEL_EN : WEEKDAY_LABEL)[new Date(this.data.selectedDate).getDay()],
      doubleDaySlots,
      doubleDayLabel1: this.getDoubleDayLabel(0),
      doubleDayLabel2: this.getDoubleDayLabel(1),
      monthCells,
      selectedDateActivities,
      sourceSelectionText,
      selectedDateLabel: formatDateLabel(this.data.selectedDate, this.data.lang),
      singleDayTitle: `${new Date(this.data.selectedDate).getMonth() + 1}月${new Date(this.data.selectedDate).getDate()}日`,
      subscriptions: decorated.subscriptions,
      subscribedSources: decorated.subscribedSources
    })
  },

  getDecoratedPublishers() {
    const cache = this._decoratedPublishersCache
    // 注意 refreshVisible 会把装饰结果写回 data.subscriptions，
    // 因此命中条件需同时接受装饰前的引用与写回后的引用
    if (
      cache &&
      cache.lang === this.data.lang &&
      cache.keys === this.data.selectedPublisherKeys &&
      (cache.subscriptions === this.data.subscriptions || cache.result.subscriptions === this.data.subscriptions) &&
      (cache.subscribedSources === this.data.subscribedSources || cache.result.subscribedSources === this.data.subscribedSources)
    ) {
      return cache.result
    }
    const result = {
      subscriptions: this.data.subscriptions.map((item) => decoratePublisher(item, this.data.selectedPublisherKeys, this.data.lang)),
      subscribedSources: this.data.subscribedSources.map((item) => decoratePublisher(item, this.data.selectedPublisherKeys, this.data.lang))
    }
    this._decoratedPublishersCache = {
      lang: this.data.lang,
      keys: this.data.selectedPublisherKeys,
      subscriptions: this.data.subscriptions,
      subscribedSources: this.data.subscribedSources,
      result
    }
    return result
  },

  switchView(event) {
    const viewMode = event.currentTarget.dataset.view
    const now = new Date()
    this.setData({
      viewMode,
      searchKeyword: '',
      activeCategory: 'all',
      activeDiscoveryTag: 'all',
      calendarYear: now.getFullYear(),
      calendarMonth: now.getMonth(),
      calendarTitle: formatMonthTitle(now.getFullYear(), now.getMonth(), this.data.lang)
    }, () => this.refreshVisible())
  },

  onSearchInput(event) {
    this.setData({ searchKeyword: event.detail.value })
    this.refreshVisible()
  },

  selectCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category }, () => this.refreshVisible())
  },

  selectDiscoveryTag(event) {
    this.setData({ activeDiscoveryTag: event.currentTarget.dataset.tag })
    this.refreshVisible()
  },

  selectCalendarPublisher(event) {
    this.setData({ calendarPublisherKey: event.currentTarget.dataset.key })
    this.refreshVisible()
  },

  // 打开活动方弹窗：source=calendar 只做日历显隐筛选；source=discover 做浏览/搜索/订阅
  openDiscoveryPicker(event) {
    const source = event && event.currentTarget && event.currentTarget.dataset.source === 'discover' ? 'discover' : 'calendar'
    this.refreshSubscriptions() // 打开弹窗时静默拉取最新活动方，后台改动即时可见
    this.setData({
      discoveryPickerOpen: true,
      pickerSource: source,
      pickerTab: source === 'discover' ? 'all' : 'subscribed',
      activeDiscoveryTag: 'all',
      searchKeyword: ''
    })
    this.refreshVisible()
  },

  // 弹窗内切换「已订阅 / 全部活动方」标签，仅 discover 来源可切
  switchPickerTab(event) {
    if (this.data.pickerSource !== 'discover') return
    const tab = event.currentTarget.dataset.tab === 'all' ? 'all' : 'subscribed'
    if (tab === this.data.pickerTab) return
    this.setData({
      pickerTab: tab,
      activeDiscoveryTag: 'all',
      searchKeyword: ''
    })
    this.refreshVisible()
  },

  closeDiscoveryPicker() {
    this.setData({ discoveryPickerOpen: false, pickerTab: 'subscribed' })
  },

  onFlashSwiperChange(e) {
    const flashIndex = Number(e.detail.current) || 0
    if (flashIndex !== this.data.flashIndex) {
      this.setData({ flashIndex })
    }
  },

  async toggleSubscription(event) {
    if (!getApp().requireLogin()) return // 订阅需登录
    const key = event.currentTarget.dataset.key
    if (!key) return
    this.setData({ subscriptionLoadingKey: key })
    try {
      await api.toggleActivitySubscription(key)
      await this.loadPageData()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to update subscription' : '订阅更新失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ subscriptionLoadingKey: '' })
    }
  },

  togglePublisherVisibility(event) {
    const key = event.currentTarget.dataset.key
    const selectedPublisherKeys = this.data.selectedPublisherKeys.slice()
    const index = selectedPublisherKeys.indexOf(key)
    if (index >= 0) selectedPublisherKeys.splice(index, 1)
    else selectedPublisherKeys.push(key)
    this.setData({ selectedPublisherKeys })
    this.refreshVisible()
  },

  toggleSourceFilter() {
    this.setData({ sourceFilterCollapsed: !this.data.sourceFilterCollapsed })
  },

  changeMonth(event) {
    let year = this.data.calendarYear
    let month = this.data.calendarMonth + Number(event.currentTarget.dataset.offset)
    if (month < 0) {
      month = 11
      year -= 1
    } else if (month > 11) {
      month = 0
      year += 1
    }
    const selectedDate = dateKey(year, month, 1)
    this.setData({
      calendarYear: year,
      calendarMonth: month,
      calendarTitle: formatMonthTitle(year, month, this.data.lang),
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang)
    })
    this.refreshVisible()
  },

  // ========== 月历滑动翻页 ==========
  // 左右滑动切换上/下月；横向位移需明显大于纵向，避免与页面上下滚动冲突
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
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    // 左滑下一月，右滑上一月
    this.changeMonth({ currentTarget: { dataset: { offset: dx < 0 ? 1 : -1 } } })
  },

  // ========== 月份选择器（月视图用）==========
  openMonthPicker() {
    const year = this.data.calendarYear
    const month = this.data.calendarMonth

    const currentYear = new Date().getFullYear()
    const years = []
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
      years.push(y)
    }
    const yearIdx = years.indexOf(year)

    const months = []
    for (let m = 1; m <= 12; m++) {
      months.push(m)
    }

    this._pickerYear = year
    this._pickerMonth = month

    this.setData({
      monthPickerOpen: true,
      pickerValue: [yearIdx, month],
      pickerYears: years,
      pickerMonths: months
    })
  },

  closeMonthPicker() {
    this.setData({ monthPickerOpen: false })
  },

  onPickerChange(e) {
    const val = e.detail.value
    this._pickerYear = this.data.pickerYears[val[0]]
    this._pickerMonth = val[1]
    this.setData({ pickerValue: [val[0], val[1]] })
  },

  confirmMonthPicker() {
    const year = this._pickerYear
    const month = this._pickerMonth
    const selectedDate = dateKey(year, month, 1)
    this.setData({
      monthPickerOpen: false,
      calendarYear: year,
      calendarMonth: month,
      calendarTitle: formatMonthTitle(year, month, this.data.lang),
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang)
    })
    this.refreshVisible()
  },

  // ========== 日期选择器（单日视图用）==========
  openDayPicker() {
    const parts = this.data.selectedDate.split('-').map(Number)
    const month = parts[1] - 1
    const day = parts[2]

    const months = []
    for (let m = 1; m <= 12; m++) {
      months.push(m)
    }

    const year = parts[0]
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days = []
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d)
    }
    const dayIdx = Math.min(day - 1, days.length - 1)

    this._dpMonth = month
    this._dpDay = day

    this.setData({
      dayPickerOpen: true,
      dayPickerValue: [month, Math.max(0, dayIdx)],
      dayPickerMonths: months,
      dayPickerDays: days
    })
  },

  closeDayPicker() {
    this.setData({ dayPickerOpen: false })
  },

  onDayPickerChange(e) {
    const val = e.detail.value
    const month = val[0]
    const year = this.data.calendarYear
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days = []
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d)
    }
    const dayIdx = Math.min(val[1], days.length - 1)
    this._dpMonth = month
    this._dpDay = days[dayIdx]
    this.setData({
      dayPickerValue: [val[0], dayIdx],
      dayPickerDays: days
    })
  },

  confirmDayPicker() {
    const year = this.data.calendarYear
    const month = this._dpMonth
    const day = this._dpDay
    const selectedDate = dateKey(year, month, day)
    this.setData({
      dayPickerOpen: false,
      calendarMonth: month,
      singleDayTitle: `${month + 1}月${day}日`,
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang)
    })
    this.refreshVisible()
  },

  // ========== 单日视图左右箭头切换 ==========
  shiftSingleDay(e) {
    const offset = parseInt(e.currentTarget.dataset.offset)
    const d = new Date(this.data.selectedDate)
    d.setDate(d.getDate() + offset)
    const selectedDate = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    this.setData({
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang),
      singleDayTitle: `${d.getMonth() + 1}月${d.getDate()}日`
    })
    this.refreshVisible()
  },

  selectDate(event) {
    const selectedDate = event.currentTarget.dataset.date
    this.setData({
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang)
    })
    this.refreshVisible()
  },

  // ========== 左右滑动切换日期 ==========
  onSwipeStart(e) {
    this._swipeX = e.touches[0].pageX
  },

  onSwipeEnd(e) {
    // 节流：300ms 内不重复处理滑动
    const now = Date.now()
    if (this._lastSwipeAt && now - this._lastSwipeAt < 300) return
    this._lastSwipeAt = now

    if (!this._swipeX) return
    const dx = e.changedTouches[0].pageX - this._swipeX
    if (Math.abs(dx) < 60) return // 滑动距离不足
    const current = new Date(this.data.selectedDate)
    if (dx > 0) {
      current.setDate(current.getDate() - 1) // 右滑 → 前一天
    } else {
      current.setDate(current.getDate() + 1) // 左滑 → 后一天
    }
    const selectedDate = dateKey(current.getFullYear(), current.getMonth(), current.getDate())
    this.setData({
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang),
      calendarYear: current.getFullYear(),
      calendarMonth: current.getMonth(),
      calendarTitle: formatMonthTitle(current.getFullYear(), current.getMonth(), this.data.lang)
    })
    this.refreshVisible()
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id
    const target = (this.data.activities || []).find((item) => item.id === id)
    if (target && !target.isLocal) {
      // 自研预约（模块 3）：优先进站内预约页；点击同样上报
      if (isNativeReservation(target)) {
        api.trackActivityClick(id, target.jumpType)
        wx.navigateTo({ url: `/packages/activity/pages/reservation/reservation?activityId=${encodeURIComponent(id)}` })
        return
      }
      // 第三方跳转活动（模块 2）：先上报点击，完成后全屏跳转目标小程序
      if (isJumpActivity(target)) {
        this.openJumpActivity(target)
        return
      }
      // 详情类点击同样计数
      api.trackActivityClick(id, target.jumpType || '')
    }
    wx.navigateTo({ url: `/packages/activity/pages/activityDetail/activityDetail?id=${id}` })
  },

  // 第三方小程序跳转：点击上报完成后全屏跳转（上报失败也照跳，埋点不阻塞主流程）
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

  // π空间专属入口（模块 4）
  openPaiSpace() {
    wx.navigateTo({ url: '/packages/activity/pages/paiSpace/paiSpace' })
  },

  openPublisher(event) {
    const key = event.currentTarget.dataset.key
    if (!key || key === 'local') return
    if (key === 'pai_space') {
      this.setData({ discoveryPickerOpen: false }, () => this.openPaiSpace())
      return
    }
    this.setData({ discoveryPickerOpen: false }, () => {
      wx.navigateTo({
        url: `/packages/activity/pages/activityPublisher/activityPublisher?key=${encodeURIComponent(key)}`,
        fail: () => wx.showToast({ title: this.data.lang === 'en' ? 'Unable to open organizer' : '活动方门面打开失败', icon: 'none' })
      })
    })
  },

  noop() {},

  // 游客点击"去登录"
  onGuestLogin() {
    getApp().requireLogin()
  },

  // ========== 新日历视图方法 ==========

  buildWeekStrip() {
    const now = new Date()
    const [year, month, day] = this.data.selectedDate.split('-').map(Number)
    const selectedDay = new Date(year, month - 1, day)
    const startOfWeek = new Date(selectedDay)
    startOfWeek.setDate(selectedDay.getDate() - selectedDay.getDay())
    const isEn = this.data.lang === 'en'
    const weekdays = isEn ? WEEKDAY_LABEL_EN : WEEKDAY_LABEL
    const strip = []
    const selectedDate = this.data.selectedDate
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek)
      d.setDate(startOfWeek.getDate() + i)
      const dateStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
      const isToday = dateStr === dateKey(now.getFullYear(), now.getMonth(), now.getDate())
      strip.push({
        date: dateStr,
        day: d.getDate(),
        weekdayLabel: weekdays[i],
        isToday,
        selected: dateStr === selectedDate,
        hasDot: false
      })
    }
    const activityDates = new Set(this.data.activities.map((a) => a.date))
    strip.forEach((item) => {
      if (activityDates.has(item.date)) item.hasDot = true
    })
    return strip
  },

  buildMonthGroups(activities) {
    if (!activities.length) return []
    const isEn = this.data.lang === 'en'
    const weekdays = isEn ? WEEKDAY_SHORT_EN : WEEKDAY_SHORT
    const monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

    const dayMap = {}
    activities.forEach((item) => {
      if (!dayMap[item.date]) dayMap[item.date] = []
      dayMap[item.date].push(item)
    })

    const dates = []
    const now = new Date()
    for (let i = 0; i < 180; i++) {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      dates.push(dateKey(d.getFullYear(), d.getMonth(), d.getDate()))
    }

    const monthMap = {}
    dates.forEach((dateStr) => {
      const parts = dateStr.split('-').map(Number)
      const year = parts[0]
      const month = parts[1] - 1
      const dayNum = parts[2]
      const monthKey = `${year}-${pad(month + 1)}`
      const d = new Date(year, month, dayNum)
      const weekday = d.getDay()

      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          monthKey,
          monthLabel: isEn
            ? `${monthsEn[month]} ${year}`
            : `${year}年${month + 1}月`,
          days: []
        }
      }

      const events = (dayMap[dateStr] || []).map((evt, idx) => ({
        ...evt,
        timeLabel: evt.start && evt.end
          ? `${evt.start}-${evt.end}`
          : this.data.copy.allDay,
        dotColor: DOT_COLORS[idx % DOT_COLORS.length]
      }))

      monthMap[monthKey].days.push({
        date: dateStr,
        dayNum,
        weekdayShort: weekdays[weekday],
        events
      })
    })

    return Object.values(monthMap)
  },

  toggleViewDropdown() {
    this.setData({ viewDropdownOpen: !this.data.viewDropdownOpen })
  },

  closeViewDropdown() {
    this.setData({ viewDropdownOpen: false })
  },

  selectViewOption(event) {
    const key = event.currentTarget.dataset.key
    const option = this.data.viewOptions.find((o) => o.key === key)
    this.setData({
      viewType: key,
      viewTypeLabel: option ? option.label : this.data.viewTypeLabel,
      viewDropdownOpen: false
    })
    this.refreshVisible()
  },

  selectStripDate(event) {
    const selectedDate = event.currentTarget.dataset.date
    const [year, month] = selectedDate.split('-').map(Number)
    this.setData({
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang),
      calendarYear: year,
      calendarMonth: month - 1,
      calendarTitle: formatMonthTitle(year, month - 1, this.data.lang)
    })
    this.refreshVisible()
  },

  // ========== 单日视图：24h时间轴 ==========
  buildSingleDaySlots(activities) {
    const selectedDate = this.data.selectedDate
    const dayActs = activities.filter((a) => a.date === selectedDate)
    const slots = []
    for (let h = 0; h < 24; h++) {
      const hourLabel = `${String(h).padStart(2, '0')}:00`
      const event = dayActs.find((a) => {
        if (!a.start) return false
        const startH = parseInt(a.start.split(':')[0])
        return startH === h
      })
      const evtData = event ? {
        ...event,
        timeLabel: event.start && event.end ? `${event.start}-${event.end}` : this.data.copy.allDay,
        dotColor: event.dotColor || DOT_COLORS[0]
      } : null
      slots.push({ hour: h, hourLabel, hasEvent: !!evtData, event: evtData })
    }
    return slots
  },

  // ========== 双日视图：双栏时间轴 ==========
  getDoubleDayLabel(offset) {
    const d = new Date(this.data.selectedDate)
    d.setDate(d.getDate() + offset)
    const dateStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    const isEn = this.data.lang === 'en'
    const parts = dateStr.split('-').map(Number)
    const wd = isEn ? WEEKDAY_SHORT_EN[d.getDay()] : WEEKDAY_SHORT[d.getDay()]
    return isEn ? `${parts[1]}/${parts[2]} ${wd}` : `${parts[1]}月${parts[2]}日 ${wd}`
  },

  buildDoubleDaySlots(activities) {
    const baseDate = new Date(this.data.selectedDate)
    const slots = []
    for (let h = 0; h < 24; h++) {
      const hourLabel = `${String(h).padStart(2, '0')}:00`
      const d1 = dateKey(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())
      const d2 = new Date(baseDate)
      d2.setDate(d2.getDate() + 1)
      const d2Key = dateKey(d2.getFullYear(), d2.getMonth(), d2.getDate())

      const findEvt = (dateStr) => {
        const evt = activities.find((a) => {
          if (a.date !== dateStr || !a.start) return false
          return parseInt(a.start.split(':')[0]) === h
        })
        return evt ? {
          ...evt,
          timeLabel: evt.start && evt.end ? `${evt.start}-${evt.end}` : this.data.copy.allDay,
          dotColor: evt.dotColor || DOT_COLORS[0]
        } : null
      }

      slots.push({
        hour: h,
        hourLabel,
        day1: { hasEvent: false, event: findEvt(d1) },
        day2: { hasEvent: false, event: findEvt(d2Key) }
      })
      if (slots[slots.length - 1].day1.event) slots[slots.length - 1].day1.hasEvent = true
      if (slots[slots.length - 1].day2.event) slots[slots.length - 1].day2.hasEvent = true
    }
    return slots
  },

  // ========== 月视图：7列网格 ==========
  buildMonthCells(activities) {
    const year = this.data.calendarYear
    const month = this.data.calendarMonth
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevDays = new Date(year, month, 0).getDate()
    const now = new Date()
    const todayStr = dateKey(now.getFullYear(), now.getMonth(), now.getDate())

    const cells = []
    for (let i = 0; i < 42; i++) {
      const offset = i - firstDay + 1
      let cellYear = year, cellMonth = month, day = offset, currentMonth = true
      if (offset <= 0) {
        cellMonth--; if (cellMonth < 0) { cellMonth = 11; cellYear-- }
        day = prevDays + offset; currentMonth = false
      } else if (offset > daysInMonth) {
        cellMonth++; if (cellMonth > 11) { cellMonth = 0; cellYear++ }
        day = offset - daysInMonth; currentMonth = false
      }
      const dateStr = dateKey(cellYear, cellMonth, day)
      const dayActs = activities.filter((a) => a.date === dateStr)
      cells.push({
        date: dateStr,
        day,
        currentMonth,
        isToday: dateStr === todayStr,
        selected: dateStr === this.data.selectedDate,
        events: dayActs.slice(0, 3).map((a, idx) => ({
          id: a.id,
          color: a.dotColor || DOT_COLORS[idx % DOT_COLORS.length]
        }))
      })
    }
    return cells
  },

  // ========== 月视图交互 ==========
  tapMonthCell(event) {
    const dateStr = event.currentTarget.dataset.date
    const parts = dateStr.split('-').map(Number)
    this.setData({
      selectedDate: dateStr,
      selectedDateLabel: formatDateLabel(dateStr, this.data.lang),
      calendarYear: parts[0],
      calendarMonth: parts[1] - 1,
      calendarTitle: formatMonthTitle(parts[0], parts[1] - 1, this.data.lang)
    }, () => this.refreshVisible())
  },

  // ========== 单日视图交互 ==========
  onTimelineTouchStart(event) {
    const touch = event.touches && event.touches[0]
    if (!touch) return
    this.timelineTouchStart = { x: touch.clientX, y: touch.clientY }
  },

  shiftTimelineDate(event, offset) {
    const touch = event.changedTouches && event.changedTouches[0]
    const start = this.timelineTouchStart
    this.timelineTouchStart = null
    if (!touch || !start) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY)) return

    const [year, month, day] = this.data.selectedDate.split('-').map(Number)
    const target = new Date(year, month - 1, day)
    target.setDate(target.getDate() + (deltaX < 0 ? offset : -offset))
    const selectedDate = dateKey(target.getFullYear(), target.getMonth(), target.getDate())
    this.setData({
      selectedDate,
      selectedDateLabel: formatDateLabel(selectedDate, this.data.lang),
      calendarYear: target.getFullYear(),
      calendarMonth: target.getMonth(),
      calendarTitle: formatMonthTitle(target.getFullYear(), target.getMonth(), this.data.lang),
      singleActiveHour: -1,
      doubleActiveHour: -1,
      doubleActiveCol: -1
    }, () => this.refreshVisible())
  },

  onSingleDaySwipe(event) {
    this.shiftTimelineDate(event, 1)
  },

  onDoubleDaySwipe(event) {
    this.shiftTimelineDate(event, 2)
  },

  tapSingleDaySlot(event) {
    if (event.currentTarget.dataset.hasevent === 'true' || event.currentTarget.dataset.hasevent === true) return
    const hour = parseInt(event.currentTarget.dataset.hour)
    // 切换激活态
    const prevActive = this.data.singleActiveHour
    const newActive = prevActive === hour ? -1 : hour
    const slots = this.data.singleDaySlots.map((s, i) => {
      return { ...s, active: i === hour && s.hour !== prevActive }
    })
    this.setData({
      singleActiveHour: newActive,
      singleDaySlots: slots
    })
  },

  goAddFromSingleSlot(event) {
    if (!getApp().requireLogin()) return
    const hour = parseInt(event.currentTarget.dataset.hour)
    const dateStr = this.data.selectedDate
    const parts = dateStr.split('-').map(Number)
    const endHour = hour + 1
    const params = `year=${parts[0]}&month=${parts[1]}&day=${parts[2]}&startHour=${hour}&endHour=${endHour}`
    wx.navigateTo({ url: `/packages/schedule/pages/addSchedule/addSchedule?${params}` })
  },

  // ========== 双日视图交互 ==========
  tapDoubleDaySlot(event) {
    if (event.currentTarget.dataset.hasevent === 'true' || event.currentTarget.dataset.hasevent === true) return
    const hour = parseInt(event.currentTarget.dataset.hour)
    const col = parseInt(event.currentTarget.dataset.col)
    const prevActiveH = this.data.doubleActiveHour
    const prevActiveC = this.data.doubleActiveCol
    const isSame = prevActiveH === hour && prevActiveC === col
    const newActiveH = isSame ? -1 : hour
    const newActiveC = isSame ? -1 : col
    const slots = this.data.doubleDaySlots.map((s, i) => {
      return {
        ...s,
        day1: { ...s.day1, active: i === hour && col === 0 && !isSame },
        day2: { ...s.day2, active: i === hour && col === 1 && !isSame }
      }
    })
    this.setData({
      doubleActiveHour: newActiveH,
      doubleActiveCol: newActiveC,
      doubleDaySlots: slots
    })
  },

  goAddFromDoubleSlot(event) {
    if (!getApp().requireLogin()) return
    const hour = parseInt(event.currentTarget.dataset.hour)
    const col = parseInt(event.currentTarget.dataset.col)
    // 计算对应列的日期
    const baseDate = new Date(this.data.selectedDate)
    const targetDate = new Date(baseDate)
    targetDate.setDate(baseDate.getDate() + col)
    const dateStr = dateKey(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
    const parts = dateStr.split('-').map(Number)
    const endHour = hour + 1
    const params = `year=${parts[0]}&month=${parts[1]}&day=${parts[2]}&startHour=${hour}&endHour=${endHour}`
    wx.navigateTo({ url: `/packages/schedule/pages/addSchedule/addSchedule?${params}` })
  },

  // ========== 列表视图交互 ==========
  goAddFromListDay(event) {
    if (!getApp().requireLogin()) return
    const dateStr = event.currentTarget.dataset.date
    const parts = dateStr.split('-').map(Number)
    const params = `year=${parts[0]}&month=${parts[1]}&day=${parts[2]}&allDay=1`
    wx.navigateTo({ url: `/packages/schedule/pages/addSchedule/addSchedule?${params}` })
  },

  async toggleLike(event) {
    const id = event.currentTarget.dataset.id
    await this.runAction(id, () => api.toggleActivity(id, 'liked'))
  },

  async toggleRegistration(event) {
    const id = event.currentTarget.dataset.id
    const activity = this.data.activities.find((item) => item.id === id)
    await this.runAction(id, () => activity.registered ? api.cancelActivityRegistration(id) : api.registerActivity(id))
  },

  async addToSchedule(event) {
    const id = event.currentTarget.dataset.id
    const activity = this.data.activities.find((item) => item.id === id)
    if (activity && activity.scheduled) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Already in schedule' : '已在活动表中',
        icon: 'none'
      })
      return
    }
    await this.runAction(
      id,
      () => api.addActivityToSchedule(id),
      this.data.lang === 'en' ? 'Added to schedule' : '已加入活动表'
    )
  },

  async runAction(id, action, successText = '') {
    if (!getApp().requireLogin()) return // 报名/喜欢/加入日程等操作需登录
    if (this.data.actionLoadingId) return
    this.setData({ actionLoadingId: id })
    try {
      await action()
      await this.loadPageData()
      if (successText) wx.showToast({ title: successText, icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ actionLoadingId: '' })
    }
  },

  /* ===== 新手引导 ===== */
  buildIntroSteps(lang) {
    const isEn = lang === 'en'
    return [
      { selector: '.view-switch', text: isEn ? 'Calendar / Discover modes' : '日历/发现模式切换' },
      { selector: '.flash-swiper', fallbackSelector: '.disco-hero-btn', text: isEn ? 'Swipe to browse activities' : '滑动浏览热门活动' },
      { selector: '.calendar-day-panel', text: isEn ? 'Tap a date to see that day\'s activities' : '点击日期查看当天活动' }
    ]
  },
  onIntroStepEnter(e) {
    const { index } = e.detail
    // 保存进入引导前的 viewMode，引导结束后恢复
    if (this._introOriginalViewMode === undefined) {
      this._introOriginalViewMode = this.data.viewMode
    }
    if (index === 1 && this.data.viewMode !== 'discovery') {
      this.setData({ viewMode: 'discovery' })
    } else if (index !== 1 && this.data.viewMode === 'discovery') {
      this.setData({ viewMode: 'calendar' })
    }
  },
  checkIntroGuide() {
    if (this.data.isGuest) return
    if (wx.getStorageSync('introGuideFinished') || wx.getStorageSync('introGuideActivitiesDone')) return
    if (this.data.introGuideVisible) return
    this.setData({ introGuideVisible: true, introSteps: this.buildIntroSteps(this.data.lang) })
  },
  onIntroComplete() {
    this._restoreIntroViewMode()
    this.setData({ introGuideVisible: false, introSteps: [] })
  },
  onIntroExit() {
    this._restoreIntroViewMode()
    this.setData({ introGuideVisible: false, introSteps: [] })
  },
  _restoreIntroViewMode() {
    if (this._introOriginalViewMode !== undefined) {
      this.setData({ viewMode: this._introOriginalViewMode })
      this._introOriginalViewMode = undefined
    }
  },
  onIntroGotoProfile() { this._restoreIntroViewMode(); this.setData({ introGuideVisible: false, introSteps: [] }) },

  onShareAppMessage() {
    return {
      title: this.data.lang === 'en'
        ? 'Discover exciting campus events on Xipoo!'
        : '来 Xipoo 活动广场，发现校园精彩活动！',
      path: '/pages/activities/activities',
      imageUrl: '/images/share/invite-cover.jpg'
    }
  }
})
