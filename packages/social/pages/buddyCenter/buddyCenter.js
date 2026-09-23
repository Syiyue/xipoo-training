const api = require('../../../../utils/api')

const SYSTEM_TAGS = [
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

const TAG_MAP = {}
SYSTEM_TAGS.forEach((t) => { TAG_MAP[t.id] = t })

function translateTags(tags, lang) {
  return (tags || []).map((id) => { const t = TAG_MAP[id]; return t ? t[lang] || t.zh : id })
}

function processPosts(posts) {
  return (posts || []).map((p) => {
    const c = p.creator
    const name = c ? (c.nickname || c.name || '') : ''
    return {
      ...p,
      _creatorName: name,
      _creatorInitial: name ? name[0] : '?',
      _hasCreatorAvatar: !!(c && c.avatar && (c.avatar.startsWith('http') || c.avatar.startsWith('cloud://') || c.avatar.startsWith('/'))),
      _memberCount: (p.memberIds || []).length
    }
  })
}

Page({
  data: {
    courses: [],
    selectedCourseId: '',
    courseIndex: 0,
    matchMode: 'campus',
    recommendations: [],
    loading: false,
    hasUnreadNotifications: false,
    lang: 'zh',
    settingsOpen: false,
    settingsTagGroups: [],
    settingsSelectedTags: [],
    settingsPersonalTags: [],
    personalTagGroups: [],
    settingsGender: 'any',
    settingsSameGrade: false,
    settingsInPool: false,
    settingsMatchMode: 'campus',
    sentInterestIds: {},
    interestSentRequestIds: {},
    mainTab: 'classmate',
    recruitFilter: 'all',
    groupPosts: [],
    myPosts: [],
    myGroupsRecruiting: [],
    myGroupsJoined: [],
    myGroupsEnded: [],
    postsLoading: false,
    postEditorOpen: false,
    guideVisible: false,
    guideSteps: [],
    testDropdown: false,
    testUsers: [
      { xipooId: 'XP1001', name: 'Sien', tags: ['tag_study_01', 'tag_sport_03', 'tag_meal_01'] },
      { xipooId: 'XP1002', name: 'Luoting', tags: ['tag_study_03', 'tag_sport_01', 'tag_ent_01'] },
      { xipooId: 'XP1003', name: 'Jingyi', tags: ['tag_study_01', 'tag_meal_03', 'tag_ent_02'] }
    ]
  },

  onLoad() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang }, () => {
      wx.setNavigationBarTitle({ title: lang === 'en' ? 'Course Match' : '课程匹配' })
    })
  },

  onShow() {
    const app = getApp()
    if (app.requireLogin && !app.requireLogin()) return
    this.loadAll()
    this._startPolling()
  },

  onHide() {
    this._stopPolling()
  },

  _startPolling() {
    this._stopPolling()
    this._pollTimer = setInterval(() => {
      api.listNotifications().then((notifications) => {
        const hasUnread = (notifications || []).some((n) => !n.read)
        if (hasUnread !== this.data.hasUnreadNotifications) {
          this.setData({ hasUnreadNotifications: hasUnread })
        }
      }).catch(() => {})
    }, 20000)
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [schedule, notifications, sent] = await Promise.all([
        api.getSchedule(),
        api.listNotifications().catch(() => []),
        api.getMatchSentInterests().catch(() => [])
      ])
      const serverSentMap = {}
      const requestMap = {}
      ;(sent || []).forEach((s) => {
        if (s.toUser) { serverSentMap[s.toUser.id] = true; requestMap[s.toUser.id] = s.id }
      })
      // 合并本地缓存，确保 mock 回退时状态不丢失
      const cache = wx.getStorageSync('course_sent_cache') || {}
      const sentMap = Object.assign({}, cache, serverSentMap)
      const mergedRequestMap = Object.assign({}, requestMap)
      Object.keys(cache).forEach(function(k) {
        if (!mergedRequestMap[k] && typeof cache[k] === 'string') mergedRequestMap[k] = cache[k]
      })
      this.setData({ sentInterestIds: sentMap, interestSentRequestIds: mergedRequestMap })
      const lang = this.data.lang
      console.log('[buddyCenter] getSchedule returned', (schedule || []).length, 'courses:', JSON.stringify((schedule || []).map(function(c) { return c.id || (c.courseCode + '_' + c.section) })))
      const courses = (schedule || []).map((c) => ({
        ...c,
        label: (c.courseCode || c.title) + ' ' + (c.section || '') + ' · ' + (lang === 'en' ? 'W' : '周') + c.weekday + ' ' + (c.start || '') + '-' + (c.end || '')
      }))
      this.setData({
        courses,
        hasUnreadNotifications: (notifications || []).some((n) => !n.read)
      })
      if (courses.length > 0 && !this.data.selectedCourseId) {
        const now = new Date()
        const nowMinutes = now.getHours() * 60 + now.getMinutes()
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const todayWeekday = now.getDay() === 0 ? 7 : now.getDay()

        let nearest = null
        for (const c of courses) {
          const cDate = c.date
          const cWeekday = Number(c.weekday)
          if (cDate === today || (cWeekday === todayWeekday && !cDate)) {
            const startMin = (parseInt(c.start.split(':')[0]) || 0) * 60 + (parseInt(c.start.split(':')[1]) || 0)
            if (startMin > nowMinutes && (!nearest || startMin < (parseInt(nearest.start.split(':')[0]) || 0) * 60 + (parseInt(nearest.start.split(':')[1]) || 0))) {
              nearest = c
            }
          }
        }
        if (nearest) {
          this.setData({ selectedCourseId: (nearest.courseCode || '') + '_' + (nearest.section || ''), courseIndex: courses.indexOf(nearest) })
        } else {
          const tomorrowWeekday = todayWeekday === 7 ? 1 : todayWeekday + 1
          let tomorrowFirst = null
          for (const c of courses) {
            const cWeekday = Number(c.weekday)
            if (cWeekday === tomorrowWeekday) {
              if (!tomorrowFirst || (c.start || '99:99') < (tomorrowFirst.start || '99:99')) {
                tomorrowFirst = c
              }
            }
          }
          if (tomorrowFirst) {
            this.setData({ selectedCourseId: (tomorrowFirst.courseCode || '') + '_' + (tomorrowFirst.section || ''), courseIndex: courses.indexOf(tomorrowFirst) })
          } else {
            this.setData({ selectedCourseId: (courses[0].courseCode || '') + '_' + (courses[0].section || ''), courseIndex: 0 })
          }
        }
      }
      // 加载当前课程缓存的入池状态 & 小组筛选
      if (this.data.selectedCourseId) {
        const cachedSettings = wx.getStorageSync('buddyCenter_settings_' + this.data.selectedCourseId) || {}
        const sameGradeGlobal2 = wx.getStorageSync('xipoo_same_grade_filter') || {}
        this.setData({
          settingsInPool: cachedSettings.inPool || false,
          settingsGender: cachedSettings.gender || 'any',
          settingsSameGrade: sameGradeGlobal2.sameGrade || cachedSettings.sameGrade || false
        })
      }
      // 清空小组帖子缓存并重载
      this.setData({ groupPosts: [], myPosts: [], myGroupsRecruiting: [], myGroupsJoined: [], myGroupsEnded: [] })
      await this.loadRecommendations()
      this.loadMyGroups()
      if (this.data.mainTab === 'group') {
        if (this.data.recruitFilter === 'mine') {
          this.loadMyPosts()
        } else {
          this.loadGroupPosts()
        }
      }
      this.tryShowGuide()
    } catch (e) {
      console.error('[courseMatch] loadAll failed', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  tryShowGuide() {
    if (wx.getStorageSync('has_seen_guide_findCourseBuddy')) return
    if (this.data.courses.length === 0) return
    const lang = this.data.lang
    this.setData({
      guideSteps: [
        { selector: '.course-bar', text: lang === 'en' ? 'Select a course first, and classmates taking the same course will be recommended' : '先选择一门课程，系统会自动推荐选了这门课的同学' },
        { selector: '.main-view-segmented', text: lang === 'en' ? 'View classmates, course groups or your own posts here' : '在这里查看同课同学、课程小组或你发布的招募帖' },
        { selector: '.mode-bar', text: lang === 'en' ? 'Switch between campus-wide or same-section classmates' : '点击可切换查看全校或同班同学' },
        { text: lang === 'en' ? "You've learned the basics of Find Classmate. Start exploring!" : '你已了解「找课友」的基本用法，开始探索吧！' }
      ],
      guideVisible: true
    })
  },

  onGuideComplete() {
    this.setData({ guideVisible: false })
  },

  onGuideExit() {
    this.setData({ guideVisible: false })
  },

  async loadRecommendations() {
    if (!this.data.selectedCourseId) return
    if (!this.data.settingsInPool) {
      this.setData({ recommendations: [] })
      return
    }
    try {
      const result = await api.getCourseRecommendations(this.data.selectedCourseId)
      const lang = this.data.lang
      const serverSent = this.data.sentInterestIds || {}
      const cache = wx.getStorageSync('course_sent_cache') || {}
      const sentMap = Object.assign({}, cache, serverSent)

      // 同年级筛选
      const sameGradeSetting = wx.getStorageSync('xipoo_same_grade_filter') || {}
      const sameGrade = sameGradeSetting.sameGrade || false
      let myGrade = ''
      if (sameGrade) {
        try {
          const me = await api.me()
          myGrade = (me.grade || me.degree || '').trim()
        } catch (e) { /* ignore */ }
      }

      const recs = (result.recommendations || []).filter(function(r) {
        if (sameGrade && myGrade) {
          const rGrade = (r.profile && r.profile.grade || '').trim()
          if (!rGrade || rGrade !== myGrade) return false
        }
        return true
      }).map(function(r) {
        var status = undefined
        if (r.isMatchedPair) {
          status = 'matched'
        } else if (sentMap[r.userId]) {
          status = 'sent'
        }
        return Object.assign({}, r, {
          status: status,
          profile: r.profile ? Object.assign({}, r.profile, { tags: translateTags(r.profile.tags, lang) }) : r.profile
        })
      })
      this.setData({ recommendations: recs })
    } catch (e) {
      const msg = (e.message || '')
      const notInPool = msg.includes('入池') || msg.includes('pool') || msg.includes('未开启')
      this.setData({ recommendations: [], settingsInPool: notInPool ? false : this.data.settingsInPool })
      if (!notInPool) {
        wx.showToast({ title: msg || (this.data.lang === 'en' ? 'Load failed' : '加载失败'), icon: 'none' })
      }
    }
  },

  onCoursePick(e) {
    const idx = Number(e.detail.value)
    const course = this.data.courses[idx]
    const courseId = course ? ((course.courseCode || '') + '_' + (course.section || '')) : ''
    this.setData({ courseIndex: idx, selectedCourseId: courseId })
    const key = 'buddyCenter_settings_' + courseId
    const cached = wx.getStorageSync(key) || {}
    const sameGradeGlobal = wx.getStorageSync('xipoo_same_grade_filter') || {}
    this.setData({
      matchMode: cached.matchMode || 'campus',
      settingsGender: cached.gender || 'any',
      settingsSameGrade: sameGradeGlobal.sameGrade || cached.sameGrade || false,
      settingsInPool: cached.inPool || false,
      settingsMatchMode: cached.matchMode || 'campus'
    })
    this.loadRecommendations()
    if (this.data.mainTab === 'group') {
      this.loadGroupPosts()
    }
  },

  openMessages() {
    wx.navigateTo({ url: '/packages/social/pages/messages/messages' })
  },

  switchMainTab(e) {
    if (this.data.guideVisible) {
      wx.setStorageSync('has_seen_guide_findCourseBuddy', true)
      this.setData({ guideVisible: false })
    }
    const tab = e.currentTarget.dataset.tab
    this.setData({ mainTab: tab })
    if (tab === 'group' && this.data.groupPosts.length === 0 && !this.data.postsLoading) {
      this.loadGroupPosts()
    }
  },

  toggleRecruitFilter(e) {
    const filter = e.currentTarget.dataset.filter
    this.setData({ recruitFilter: filter })
    if (filter === 'mine' && this.data.myPosts.length === 0 && !this.data.postsLoading) {
      this.loadMyPosts()
    }
  },

  async loadGroupPosts() {
    if (!this.data.selectedCourseId) return
    this.setData({ postsLoading: true })
    try {
      const posts = await api.listPosts('course', this.data.selectedCourseId)
      const key = 'buddyCenter_settings_' + this.data.selectedCourseId
      const cached = wx.getStorageSync(key) || {}
      const prefGender = cached.gender || 'any'
      const sameGradeGlobal = wx.getStorageSync('xipoo_same_grade_filter') || {}
      const sameGrade = sameGradeGlobal.sameGrade || cached.sameGrade || false

      let myGender = ''
      let myGrade = ''
      try {
        const me = await api.me()
        myGender = me.gender || ''
        myGrade = me.grade || me.degree || ''
      } catch (e) { /* ignore */ }

      const genderNormalize = (g) => {
        if (!g) return ''
        if (g === '男' || g === 'male') return 'male'
        if (g === '女' || g === 'female') return 'female'
        return g
      }

      const myGenderNorm = genderNormalize(myGender)

      // 加载屏蔽列表
      let blockedIds = []
      try {
        const blocked = await api.getBlockedUsers()
        blockedIds = (blocked || []).map(function(b) { return b.blockedUserId }).filter(Boolean)
      } catch (e) { /* ignore */ }

      let visible = (posts || []).filter(function(p) {
        if (p.status === 'closed') return false

        var memberIds = p.memberIds || []
        var isFull = memberIds.length >= (p.maxMembers || 99)
        if (isFull) return false

        // 过滤被屏蔽者的帖子
        if (blockedIds.indexOf(p.creatorUserId) >= 0) return false

        // 硬性限制：帖子的性别限制 vs 用户的实际性别
        var postGf = p.genderFilter || 'any'
        if (postGf !== 'any' && myGenderNorm && postGf !== myGenderNorm) return false

        return true
      })

      // 用户偏好筛选：同时过滤帖子的性别限制 & 发帖人的性别
      if (prefGender !== 'any') {
        visible = visible.filter(p => {
          const gf = p.genderFilter || 'any'
          if (gf !== 'any' && gf !== prefGender) return false
          const creatorGender = genderNormalize(p.creator && p.creator.gender)
          if (creatorGender && creatorGender !== prefGender) return false
          return true
        })
      }

      // 同年级筛选
      if (sameGrade && myGrade) {
        visible = visible.filter(p => {
          const cg = p.creator && p.creator.grade
          return cg && cg === myGrade
        })
      }

      this.setData({ groupPosts: processPosts(visible), postsLoading: false })
    } catch (e) {
      this.setData({ postsLoading: false })
      console.error('[buddyCenter] loadGroupPosts failed:', e.message || e)
      wx.showToast({ title: (e.message || '加载失败').substring(0, 20), icon: 'none' })
    }
  },

  async loadMyPosts() {
    if (!this.data.selectedCourseId) return
    this.setData({ postsLoading: true })
    try {
      const me = await api.me()
      const myId = me ? (me.xipooId || me.id || '') : ''
      const posts = await api.listPosts('course', this.data.selectedCourseId)
      // 「我的」tab 显示我创建或加入的帖子（含已满员隐藏的）
      this.setData({ myPosts: processPosts(posts).filter((p) => p.creatorUserId === myId || (p.memberIds || []).includes(myId)), postsLoading: false })
    } catch (e) {
      this.setData({ postsLoading: false })
      console.error('[buddyCenter] loadMyPosts failed:', e.message || e)
    }
  },

  async loadMyGroups() {
    try {
      const groups = await api.getMyJoinedGroups()
      console.log('[DEBUG-MYGROUPS] getMyJoinedGroups 返回:', JSON.stringify(groups))
      const processed = processPosts(groups)
      console.log('[DEBUG-MYGROUPS] processed:', processed.length, '条')
      const recruiting = processed.filter(function(g) { return g._myStatus === 'recruiting' })
      const joined = processed.filter(function(g) { return g._myStatus === 'joined' })
      const ended = processed.filter(function(g) { return g._myStatus === 'ended' })
      console.log('[DEBUG-MYGROUPS] 招募中:', recruiting.length, '已加入:', joined.length, '已结束:', ended.length)
      this.setData({
        myGroupsRecruiting: recruiting,
        myGroupsJoined: joined,
        myGroupsEnded: ended
      })
    } catch (e) {
      console.error('[DEBUG-MYGROUPS] 加载失败:', e.message || e)
      wx.showToast({ title: (e.message || '加载失败').substring(0, 20), icon: 'none' })
    }
  },

  openPostEditor() {
    this.setData({ postEditorOpen: true })
  },

  closePostEditor() {
    this.setData({ postEditorOpen: false })
  },

  onPostPublished(e) {
    this.setData({ postEditorOpen: false })
    if (this.data.recruitFilter === 'mine') {
      this.loadMyPosts()
    } else {
      this.loadGroupPosts()
    }
    this.loadMyGroups()
  },

  viewGroupPost(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/packages/social/pages/buddyPost/buddyPost?postId=' + encodeURIComponent(id) })
  },

  async deleteEndedRecord(e) {
    const id = e.currentTarget.dataset.id
    const lang = this.data.lang
    try {
      await api.archivePostRecord(id)
      wx.showToast({ title: lang === 'en' ? 'Deleted' : '已删除', icon: 'success' })
      this.loadMyGroups()
    } catch (err) {
      wx.showToast({ title: err.message || (lang === 'en' ? 'Failed' : '操作失败'), icon: 'none' })
    }
  },

  viewCreatorProfile(e) {
    const uid = e.currentTarget.dataset.userid
    if (uid) wx.navigateTo({ url: `/packages/social/pages/friendProfile/friendProfile?friendId=${uid}` })
  },

  async toggleInterest(e) {
    var userId = e.currentTarget.dataset.userid
    var rec = (this.data.recommendations || []).find(function(r) { return r.userId === userId })
    if (rec && rec.status === 'matched') return
    var sentMap = this.data.sentInterestIds
    var reqMap = this.data.interestSentRequestIds
    var STORAGE_KEY = 'course_sent_cache'
    var cached = wx.getStorageSync(STORAGE_KEY) || {}
    sentMap = Object.assign({}, cached, sentMap)
    Object.keys(cached).forEach(function(k) {
      if (!reqMap[k] && typeof cached[k] === 'string') reqMap[k] = cached[k]
    })
    if (sentMap[userId]) {
      var requestId = reqMap[userId]
      if (!requestId) {
        var rc = wx.getStorageSync(STORAGE_KEY) || {}
        requestId = rc[userId]
      }
      if (!requestId) {
        wx.showToast({ title: '无法撤回', icon: 'none' })
        return
      }
      var lang = this.data.lang
      wx.showModal({
        title: lang === 'en' ? 'Cancel interest?' : '撤回感兴趣？',
        success: async (res) => {
          if (!res.confirm) return
          try {
            var recs2 = (this.data.recommendations || []).map(function(r) {
              if (r.userId === userId) return Object.assign({}, r, { status: undefined })
              return r
            })
            var newSent2 = Object.assign({}, this.data.sentInterestIds)
            delete newSent2[userId]
            var newReq2 = Object.assign({}, this.data.interestSentRequestIds)
            delete newReq2[userId]
            var oldCache = wx.getStorageSync(STORAGE_KEY) || {}
            var cache2 = {}
            Object.keys(oldCache).forEach(function(k) {
              if (k !== userId) cache2[k] = oldCache[k]
            })
            wx.setStorageSync(STORAGE_KEY, cache2)
            this.setData({ recommendations: recs2, sentInterestIds: newSent2, interestSentRequestIds: newReq2 })
            await api.cancelMatchInterest(requestId)
            wx.showToast({ title: lang === 'en' ? 'Cancelled' : '已撤回', icon: 'success' })
            this.loadAll()
          } catch (err) {
            var msg = err.message || ''
            if (msg.includes('请求不存在') || msg.includes('只能撤回')) {
              var staleCache = wx.getStorageSync(STORAGE_KEY) || {}
              var cleanCache = {}
              Object.keys(staleCache).forEach(function(k) { if (k !== userId) cleanCache[k] = staleCache[k] })
              wx.setStorageSync(STORAGE_KEY, cleanCache)
              var rollbackSent = Object.assign({}, this.data.sentInterestIds)
              delete rollbackSent[userId]
              var rollbackReq = Object.assign({}, this.data.interestSentRequestIds)
              delete rollbackReq[userId]
              var rollbackRecs = (this.data.recommendations || []).map(function(r) {
                if (r.userId === userId) return Object.assign({}, r, { status: undefined })
                return r
              })
              this.setData({ sentInterestIds: rollbackSent, interestSentRequestIds: rollbackReq, recommendations: rollbackRecs })
              wx.showToast({ title: lang === 'en' ? 'Stale request, tap again' : '请求已失效，请重新点击', icon: 'none' })
            } else {
              this.loadAll()
              wx.showToast({ title: msg, icon: 'none' })
            }
          }
        }
      })
      return
    }
    try {
      var result = await api.sendMatchInterest(userId, 'course')
      // 持久化到本地缓存
      var cache = wx.getStorageSync(STORAGE_KEY) || {}
      cache[userId] = result.request && result.request.id ? result.request.id : true
      wx.setStorageSync(STORAGE_KEY, cache)
      // 乐观更新
      var recs = this.data.recommendations.map(function(r) {
        if (r.userId === userId) return Object.assign({}, r, { status: 'sent' })
        return r
      })
      var newSent = Object.assign({}, this.data.sentInterestIds)
      newSent[userId] = true
      var newReq = Object.assign({}, this.data.interestSentRequestIds)
      if (result.request && result.request.id) newReq[userId] = result.request.id
      this.setData({ recommendations: recs, sentInterestIds: newSent, interestSentRequestIds: newReq })
      if (result.autoMatched) {
        wx.showModal({
          title: this.data.lang === 'en' ? 'Matched!' : '匹配成功！',
          content: this.data.lang === 'en' ? 'You both expressed interest! Contact info exchanged.' : '你们双向互发了感兴趣，已自动匹配！联系方式已交换。',
          showCancel: false,
          success: () => this.loadAll()
        })
      } else {
        wx.showToast({ title: this.data.lang === 'en' ? 'Interest sent' : '已发送感兴趣', icon: 'success' })
        this.loadAll()
      }
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async acceptInterest(e) {
    try {
      await api.acceptMatchInterest(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Accepted' : '已同意', icon: 'success' })
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async ignoreInterest(e) {
    try {
      await api.ignoreMatchInterest(e.currentTarget.dataset.id)
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async cancelInterest(e) {
    try {
      await api.cancelMatchInterest(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Cancelled' : '已撤回', icon: 'success' })
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async unmatch(e) {
    const pairId = e.currentTarget.dataset.pairid
    const name = e.currentTarget.dataset.name || ''
    const lang = this.data.lang
    wx.showModal({
      title: lang === 'en' ? 'Unmatch?' : '解除匹配？',
      content: (lang === 'en' ? `Stop matching with ${name}?` : `确定与 ${name} 解除搭子关系？`),
      success: async (res) => {
        if (res.confirm) {
          await api.unmatchPair(pairId)
          wx.showToast({ title: lang === 'en' ? 'Unmatched' : '已解除', icon: 'success' })
          this.loadAll()
        }
      }
    })
  },

  async blockUser(e) {
    const userId = e.currentTarget.dataset.userid
    const name = e.currentTarget.dataset.name || ''
    const lang = this.data.lang
    wx.showModal({
      title: lang === 'en' ? 'Block?' : '拉黑？',
      content: (lang === 'en' ? `Block ${name}?` : `确定拉黑 ${name}？`),
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.blockMatchUser(userId)
          wx.showToast({ title: lang === 'en' ? 'Blocked' : '已拉黑', icon: 'success' })
          this.loadAll()
        } catch (err) {
          wx.showToast({ title: err.message || (lang === 'en' ? 'Failed' : '操作失败'), icon: 'none' })
        }
      }
    })
  },
  copyWechat(e) {
    const wechat = e.currentTarget.dataset.wechat
    if (wechat) { wx.setClipboardData({ data: wechat }); wx.showToast({ title: this.data.lang === 'en' ? 'Copied' : '已复制', icon: 'success' }) }
  },

  toggleTestDropdown() { this.setData({ testDropdown: !this.data.testDropdown }) },

  async switchToTest(e) {
    const xipooId = e.currentTarget.dataset.xipooid
    wx.showLoading({ title: '切换中...' })
    try {
      await api.switchToTestUser(xipooId)
      // 清除所有筛选缓存，避免上一用户的设置过滤掉当前用户的数据
      ;['match_sent_cache', 'course_sent_cache', 'matchmaking_recruit_settings', 'xipoo_same_grade_filter', 'buddyCenter_personal_tags', 'buddySquare_settings', 'schedule_tags'].forEach(function(k) { try { wx.removeStorageSync(k) } catch (e) {} })
      try {
        var info = wx.getStorageInfoSync()
        ;(info.keys || []).forEach(function(k) {
          if (k.indexOf('buddyCenter_settings_') === 0) { try { wx.removeStorageSync(k) } catch (e) {} }
        })
      } catch (e) {}
      this.setData({ testDropdown: false, selectedCourseId: '', courses: [], recommendations: [], groupPosts: [], myPosts: [], myGroupsRecruiting: [], myGroupsJoined: [], myGroupsEnded: [] })
      wx.hideLoading()
      wx.showToast({ title: '已切换', icon: 'success' })
      this.loadAll()
      // 如果当前在小组 Tab，需要重新加载帖子和我的小组
      if (this.data.mainTab === 'group') {
        this.loadGroupPosts()
        this.loadMyGroups()
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '切换失败', icon: 'none' })
    }
  },

  openSettings() {
    if (!this.data.selectedCourseId) {
      if (this.data.courses.length > 0) {
        const c = this.data.courses[0]
        this.setData({ selectedCourseId: (c.courseCode || '') + '_' + (c.section || ''), courseIndex: 0 })
      } else {
        wx.showToast({ title: this.data.lang === 'en' ? 'Select a course first' : '请先选择课程', icon: 'none' })
        return
      }
    }
    const courseId = this.data.selectedCourseId
    const key = 'buddyCenter_settings_' + courseId
    const cached = wx.getStorageSync(key) || {}

    const sameGradeGlobal = wx.getStorageSync('xipoo_same_grade_filter') || {}
    if (this.data.mainTab === 'classmate') {
      const personalCached = wx.getStorageSync('buddyCenter_personal_tags') || {}
      this.setData({
        settingsOpen: true,
        settingsSelectedTags: [...(cached.selectedTags || [])],
        settingsGender: cached.gender || 'any',
        settingsSameGrade: sameGradeGlobal.sameGrade || cached.sameGrade || false,
        settingsInPool: cached.inPool || false,
        settingsMatchMode: cached.matchMode || 'campus',
        settingsPersonalTags: [...(personalCached.tags || [])]
      })
      this.buildTagGroups()
      this.buildPersonalTagGroups()
    } else {
      this.setData({
        settingsOpen: true,
        settingsGender: cached.gender || 'any',
        settingsSameGrade: sameGradeGlobal.sameGrade || cached.sameGrade || false
      })
    }
  },


  closeSettings() { this.setData({ settingsOpen: false }) },
  noop() {},

  toggleSettingsTag(e) {
    const tagId = e.currentTarget.dataset.tagid
    let selected = [...this.data.settingsSelectedTags]
    const idx = selected.indexOf(tagId)
    if (idx >= 0) selected.splice(idx, 1)
    else { if (selected.length >= 10) { wx.showToast({ title: this.data.lang === 'en' ? 'Max 10' : '最多10个', icon: 'none' }); return } selected.push(tagId) }
    this.setData({ settingsSelectedTags: selected })
    this.buildTagGroups()
  },

  buildTagGroups() {
    const catOrder = ['study', 'sport', 'meal', 'lifestyle', 'entertainment']
    const catLabel = { zh: { study: '学习', sport: '运动', meal: '饮食', lifestyle: '作息', entertainment: '娱乐' }, en: { study: 'Study', sport: 'Sports', meal: 'Food', lifestyle: 'Lifestyle', entertainment: 'Entertainment' } }
    const lang = this.data.lang; const selected = this.data.settingsSelectedTags
    const groups = catOrder.map((cat) => ({ category: cat, label: catLabel[lang][cat] || cat, tags: SYSTEM_TAGS.filter((t) => t.category === cat).map((t) => ({ ...t, selected: selected.includes(t.id) })) }))
    this.setData({ settingsTagGroups: groups })
  },

  buildPersonalTagGroups() {
    const catOrder = ['study', 'sport', 'meal', 'lifestyle', 'entertainment']
    const catLabel = { zh: { study: '学习', sport: '运动', meal: '饮食', lifestyle: '作息', entertainment: '娱乐' }, en: { study: 'Study', sport: 'Sports', meal: 'Food', lifestyle: 'Lifestyle', entertainment: 'Entertainment' } }
    const lang = this.data.lang; const selected = this.data.settingsPersonalTags
    const groups = catOrder.map((cat) => ({ category: cat, label: catLabel[lang][cat] || cat, tags: SYSTEM_TAGS.filter((t) => t.category === cat).map((t) => ({ ...t, selected: selected.includes(t.id) })) }))
    this.setData({ personalTagGroups: groups })
  },

  togglePersonalTag(e) {
    const tagId = e.currentTarget.dataset.tagid
    let selected = [...this.data.settingsPersonalTags]
    const idx = selected.indexOf(tagId)
    if (idx >= 0) selected.splice(idx, 1)
    else { if (selected.length >= 10) { wx.showToast({ title: this.data.lang === 'en' ? 'Max 10' : '最多10个', icon: 'none' }); return } selected.push(tagId) }
    this.setData({ settingsPersonalTags: selected })
    this.buildPersonalTagGroups()
  },

  onSettingsGender(e) { this.setData({ settingsGender: e.currentTarget.dataset.g }) },
  onSameGrade(e) { this.setData({ settingsSameGrade: e.detail.value }) },
  onPoolToggle(e) { this.setData({ settingsInPool: e.detail.value }) },
  onMatchMode(e) { this.setData({ settingsMatchMode: e.currentTarget.dataset.mode }) },

  async saveSettings() {
    const courseId = this.data.selectedCourseId
    if (!courseId) return

    // 共享同年级筛选开关
    wx.setStorageSync('xipoo_same_grade_filter', { sameGrade: this.data.settingsSameGrade })

    if (this.data.mainTab === 'classmate') {
      // 同课同学：保存完整设置
      const cached = {
        selectedTags: this.data.settingsSelectedTags,
        gender: this.data.settingsGender,
        sameGrade: this.data.settingsSameGrade,
        inPool: this.data.settingsInPool,
        matchMode: this.data.settingsMatchMode
      }
      const key = 'buddyCenter_settings_' + courseId
      wx.setStorageSync(key, cached)
      wx.setStorageSync('buddyCenter_personal_tags', { tags: this.data.settingsPersonalTags })
      api.updateMatchSelectedTags(this.data.settingsPersonalTags).catch(() => {})
      let saveOk = true
      try {
        await api.setCoursePool(courseId, {
          enabled: this.data.settingsInPool,
          genderFilter: this.data.settingsGender,
          selectedTags: this.data.settingsSelectedTags,
          matchMode: this.data.settingsMatchMode,
          sameGrade: this.data.settingsSameGrade
        })
      } catch (e) {
        saveOk = false
        wx.showToast({ title: e.message || (this.data.lang === 'en' ? 'Save failed' : '保存失败'), icon: 'none' })
      }
      if (!saveOk) return
      wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
      this.setData({ matchMode: this.data.settingsMatchMode, settingsOpen: false })
      this.loadRecommendations()
    } else {
      // 课程小组：仅保存性别 + 同年级（合并已有设置）
      const key = 'buddyCenter_settings_' + courseId
      const existing = wx.getStorageSync(key) || {}
      wx.setStorageSync(key, Object.assign({}, existing, {
        gender: this.data.settingsGender,
        sameGrade: this.data.settingsSameGrade
      }))
      this.setData({ settingsOpen: false })
      this.loadGroupPosts()
    }

  }
})
