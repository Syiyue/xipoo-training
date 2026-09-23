const api = require('../../../../utils/api')

const TAG_MAP = {
  'tag_study_01': { zh: '图书馆卷王', en: 'Library King' },
  'tag_study_02': { zh: '晨读党', en: 'Morning Reader' },
  'tag_study_03': { zh: 'DDL战神', en: 'DDL Warrior' },
  'tag_study_04': { zh: '笔记共享', en: 'Note Sharing' },
  'tag_study_05': { zh: '期末抱佛脚', en: 'Last-Minute Crammer' },
  'tag_sport_01': { zh: '健身撸铁', en: 'Gym Rat' },
  'tag_sport_02': { zh: '跑步', en: 'Runner' },
  'tag_sport_03': { zh: '羽毛球', en: 'Badminton' },
  'tag_sport_04': { zh: '游泳', en: 'Swimmer' },
  'tag_sport_05': { zh: '篮球', en: 'Basketball' },
  'tag_sport_06': { zh: '足球', en: 'Football' },
  'tag_meal_01': { zh: '食堂干饭人', en: 'Canteen Foodie' },
  'tag_meal_02': { zh: '外卖拼单', en: 'Takeout Grouper' },
  'tag_meal_03': { zh: '奶茶搭子', en: 'Milk Tea Buddy' },
  'tag_meal_04': { zh: '轻食主义', en: 'Light Eater' },
  'tag_meal_05': { zh: '探店打卡', en: 'Food Explorer' },
  'tag_life_01': { zh: '早睡早起', en: 'Early Bird' },
  'tag_life_02': { zh: '夜猫子', en: 'Night Owl' },
  'tag_life_03': { zh: '午休必睡', en: 'No Nap No Life' },
  'tag_ent_01': { zh: '游戏开黑', en: 'Game Squad' },
  'tag_ent_02': { zh: '电影搭子', en: 'Movie Buddy' },
  'tag_ent_03': { zh: '逛展', en: 'Exhibition Goer' },
  'tag_ent_04': { zh: 'K歌', en: 'Karaoke' },
  'tag_ent_05': { zh: '桌游', en: 'Board Games' }
}

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

function translateTags(tags, lang) {
  return (tags || []).map((id) => {
    const t = TAG_MAP[id]
    return t ? t[lang] || t.zh : id
  })
}

function processPosts(posts) {
  return (posts || []).map((p) => {
    const c = p.creator
    const name = c ? (c.nickname || c.name || '') : ''
    return {
      ...p,
      _creatorName: name,
      _creatorInitial: name ? name[0] : '?',
      _hasCreatorAvatar: !!(c && c.avatar),
      _memberCount: (p.memberIds || []).length
    }
  })
}

const BUDDY_TYPES = ['study', 'meal', 'sport', 'selfstudy', 'entertainment']
const BUDDY_LABELS = {
  zh: { study: '学习搭子', meal: '饭搭子', sport: '运动搭子', selfstudy: '自习搭子', entertainment: '娱乐搭子' },
  en: { study: 'Study', meal: 'Meal', sport: 'Sport', selfstudy: 'Self-Study', entertainment: 'Entertain' }
}

Page({
  data: {
    mainTab: 'recommend',
    recruitFilter: 'all',
    buddyType: 'study',
    buddyTypes: BUDDY_TYPES,
    buddyLabels: BUDDY_LABELS.zh,
    recommendations: [],
    pool: null,
    loading: false,
    lang: 'zh',
    hasUnreadNotifications: false,
    posts: [],
    myPosts: [],
    joinedPosts: [],
    postsLoading: false,
    myGroupsRecruiting: [],
    myGroupsJoined: [],
    myGroupsEnded: [],
    postEditorOpen: false,
    guideVisible: false,
    guideSteps: [],
    testDropdown: false,
    testUsers: [
      { xipooId: 'XP1001', name: 'Sien', tags: ['tag_study_01', 'tag_sport_03', 'tag_meal_01'] },
      { xipooId: 'XP1002', name: 'Luoting', tags: ['tag_study_03', 'tag_sport_01', 'tag_ent_01'] },
      { xipooId: 'XP1003', name: 'Jingyi', tags: ['tag_study_01', 'tag_meal_03', 'tag_ent_02'] }
    ],
    settingsOpen: false,
    settingsTagGroups: [],
    settingsSelectedTags: [],
    settingsPersonalTags: [],
    personalTagGroups: [],
    settingsGender: 'any',
    settingsInPool: false,
    settingsSameGrade: false,
    sentInterestIds: {},
    interestSentRequestIds: {}
  },

  onLoad(query) {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    if (query && query.type && BUDDY_TYPES.includes(query.type)) {
      this.setData({ buddyType: query.type })
    }
    this.setData({ lang, buddyLabels: BUDDY_LABELS[lang] || BUDDY_LABELS.zh }, () => {
      wx.setNavigationBarTitle({ title: lang === 'en' ? 'Find Buddy' : '找搭子' })
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
    this._recommendationRequestId = (this._recommendationRequestId || 0) + 1
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

  loadAll() {
    // onShow、保存设置和多个交互都会触发刷新；同一时刻只保留一个请求链。
    if (this._loadAllPromise) return this._loadAllPromise
    this._loadAllPromise = this._doLoadAll().finally(() => {
      this._loadAllPromise = null
    })
    return this._loadAllPromise
  },

  async _doLoadAll() {
    this.setData({ loading: true })
    try {
      const [pool, notifications, sent] = await Promise.all([
        api.getMatchPool(),
        api.listNotifications().catch(() => []),
        api.getMatchSentInterests().catch(() => [])
      ])
      const cachedPool = wx.getStorageSync('match_pool_cache') || null
      // 云端临时不可用时，保留最近一次确认过的入池状态，避免空 mock 覆盖“已开启”。
      const resolvedPool = pool && pool.__cloudFailed && cachedPool ? cachedPool : pool
      if (pool && !pool.__cloudFailed) wx.setStorageSync('match_pool_cache', pool)
      const serverSentMap = {}
      const requestMap = {}
      ;(sent || []).forEach((s) => {
        if (s.toUser) { serverSentMap[s.toUser.id] = true; requestMap[s.toUser.id] = s.id }
      })
      // 合并本地缓存，确保 mock 回退时状态不丢失
      const cache = wx.getStorageSync('match_sent_cache') || {}
      const sentMap = Object.assign({}, cache, serverSentMap)
      // 合并缓存的 requestId 到 requestMap（server 优先）
      const mergedRequestMap = Object.assign({}, requestMap)
      Object.keys(cache).forEach(function(k) {
        if (!mergedRequestMap[k] && typeof cache[k] === 'string') mergedRequestMap[k] = cache[k]
      })
      this.setData({
        pool: resolvedPool,
        hasUnreadNotifications: (notifications || []).some((n) => !n.read),
        sentInterestIds: sentMap,
        interestSentRequestIds: mergedRequestMap
      })
      await this.loadRecommendations()
      if (this.data.mainTab === 'recruit') await this.loadPosts()
      this.tryShowGuide()
    } catch (e) {
      console.error('[matchmaking] loadAll failed', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  tryShowGuide() {
    if (wx.getStorageSync('has_seen_guide_findBuddy')) return
    const lang = this.data.lang
    this.setData({
      guideSteps: [
        { selector: '.main-view-segmented', text: lang === 'en' ? 'Switch between "Recommend" and "Recruit" here' : '在这里切换「推荐人选」和「招募帖子」' },
        { selector: '.type-scroll', text: lang === 'en' ? 'Pick a buddy type first, and the system will recommend matches for you' : '先选择你感兴趣的搭子类型，系统会为你推荐匹配的人' },
        { selector: '.card-list .card:first-child', fallbackSelector: '.empty', text: lang === 'en' ? 'Found someone interesting? Tap "Interested" to send a request' : '看到感兴趣的人，点击「感兴趣」发起请求，对方接受后即可聊天' },
        { text: lang === 'en' ? "You've learned the basics of Find Buddy. Start exploring!" : '你已了解「找搭子」的基本用法，开始探索吧！' }
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
    const bt = this.data.buddyType
    const requestId = (this._recommendationRequestId || 0) + 1
    this._recommendationRequestId = requestId
    try {
      // 帖子与推荐彼此独立，并发请求可缩短首次进入找搭子的等待。
      const [allGeneralPosts, result] = await Promise.all([
        api.listPosts('general', '').catch(() => []),
        api.getMatchRecommendations(bt)
      ])
      if (requestId !== this._recommendationRequestId) return
      const hasPostUserIds = new Set((allGeneralPosts || []).map(p => p.creatorUserId).filter(Boolean))
      console.log('[center loadRecs] raw result recs:', (result.recommendations || []).length, 'sentList:', (result.sentList || []).length)
      const lang = this.data.lang
      const serverSent = this.data.sentInterestIds || {}
      const cache = wx.getStorageSync('match_sent_cache') || {}
      const sentMap = Object.assign({}, cache, serverSent)

      // 同年级筛选
      const sameGradeSetting = wx.getStorageSync('xipoo_same_grade_filter') || {}
      const sameGrade = sameGradeSetting.sameGrade || false
      let myGrade = ''
      if (sameGrade) {
        try {
          const me = await api.me()
          myGrade = (me.grade || me.degree || '').trim()
          console.log('[center loadRecs] sameGrade=true, myGrade:', JSON.stringify(myGrade), 'me.grade:', me.grade, 'me.degree:', me.degree)
        } catch (e) { console.log('[center loadRecs] api.me() failed:', e.message); /* ignore */ }
      }
      console.log('[center loadRecs] sameGrade:', sameGrade, 'myGrade:', JSON.stringify(myGrade))

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
          hasPost: hasPostUserIds.has(r.userId),
          profile: r.profile ? Object.assign({}, r.profile, { tags: translateTags(r.profile.tags, lang) }) : r.profile
        })
      })
      // 把已发送兴趣的用户也加进来（排在末尾），前端通过 status 字段显示"已申请"
      const sent = (result.sentList || []).filter(function(r) {
        if (sameGrade && myGrade) {
          const rGrade = (r.profile && r.profile.grade || '').trim()
          if (!rGrade || rGrade !== myGrade) return false
        }
        return true
      }).map(function(r) {
        return Object.assign({}, r, {
          score: 0,
          hasPost: hasPostUserIds.has(r.userId),
          profile: r.profile ? Object.assign({}, r.profile, { tags: translateTags(r.profile.tags, lang) }) : r.profile
        })
      })
      console.log('[center loadRecs] after filter recs:', recs.length, 'sent:', sent.length)
      if (requestId === this._recommendationRequestId) this.setData({ recommendations: recs.concat(sent) })
    } catch (e) {
      if (requestId !== this._recommendationRequestId) return
      if (e.message && e.message.includes('开启')) {
        this.setData({ recommendations: [] })
      } else {
        console.error('[matchmaking] loadRecommendations failed', e)
      }
    }
  },

  openMessages() {
    wx.navigateTo({ url: '/packages/social/pages/messages/messages' })
  },

  switchMainTab(e) {
    if (this.data.guideVisible) {
      wx.setStorageSync('has_seen_guide_findBuddy', true)
      this.setData({ guideVisible: false })
    }
    const tab = e.currentTarget.dataset.tab
    this.setData({ mainTab: tab })
    if (tab === 'recruit') {
      if (this.data.posts.length === 0 && !this.data.postsLoading) {
        this.loadPosts()
      }
      this.loadMyGroups()
    }
  },

  toggleRecruitFilter(e) {
    const filter = e.currentTarget.dataset.filter
    this.setData({ recruitFilter: filter })
    if (filter === 'mine' && this.data.myPosts.length === 0 && !this.data.postsLoading) {
      this.loadMyPosts()
    }
  },

  async loadPosts() {
    this.setData({ postsLoading: true })
    try {
      const posts = await api.listPosts('general', '')

      const recruitCached = wx.getStorageSync('matchmaking_recruit_settings') || {}
      const prefGender = recruitCached.gender || 'any'
      const sameGradeCached = wx.getStorageSync('xipoo_same_grade_filter') || {}
      const sameGrade = sameGradeCached.sameGrade || recruitCached.sameGrade || false

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

      let blockedIds = []
      try {
        const blocked = await api.getBlockedUsers()
        blockedIds = (blocked || []).map(function(b) { return b.blockedUserId }).filter(Boolean)
      } catch (e) { /* ignore */ }

      let visible = (posts || []).filter(function(p) {
        if (p.status === 'closed') return false
        var memberIds = p.memberIds || []
        if (memberIds.length >= (p.maxMembers || 99)) return false
        if (blockedIds.indexOf(p.creatorUserId) >= 0) return false
        var postGf = p.genderFilter || 'any'
        if (postGf !== 'any' && myGenderNorm && postGf !== myGenderNorm) return false
        return true
      })

      if (prefGender !== 'any') {
        visible = visible.filter(p => {
          const gf = p.genderFilter || 'any'
          if (gf !== 'any' && gf !== prefGender) return false
          const creatorGender = genderNormalize(p.creator && p.creator.gender)
          if (creatorGender && creatorGender !== prefGender) return false
          return true
        })
      }

      if (sameGrade && myGrade) {
        visible = visible.filter(p => {
          const cg = p.creator && p.creator.grade
          return cg && cg === myGrade
        })
      }

      this.setData({ posts: processPosts(visible), postsLoading: false })
    } catch (e) {
      this.setData({ postsLoading: false })
      console.error('[matchmaking] loadPosts failed:', e.message || e)
      wx.showToast({ title: (e.message || '加载失败').substring(0, 20), icon: 'none' })
    }
  },

  async loadMyPosts() {
    this.setData({ postsLoading: true })
    try {
      const me = await api.me()
      const myId = me ? (me.xipooId || me.id || '') : ''
      const posts = await api.listPosts('general', '', myId)
      this.setData({ myPosts: processPosts(posts).filter(function(p) { return p.creatorUserId === myId }), postsLoading: false })
    } catch (e) {
      this.setData({ postsLoading: false })
    }
  },

  async loadMyGroups() {
    try {
      const groups = await api.getMyJoinedGroups()
      // 过滤：只保留通用招募帖，排除课程帖（找搭子和找课友招募池不互通）
      const generalOnly = (groups || []).filter(function(g) { return !g.courseId })
      const processed = processPosts(generalOnly)
      const recruiting = processed.filter(function(g) { return g._myStatus === 'recruiting' })
      const joined = processed.filter(function(g) { return g._myStatus === 'joined' })
      const ended = processed.filter(function(g) { return g._myStatus === 'ended' })
      this.setData({
        myGroupsRecruiting: recruiting,
        myGroupsJoined: joined,
        myGroupsEnded: ended
      })
    } catch (e) {
      wx.showToast({ title: (e.message || '加载失败').substring(0, 20), icon: 'none' })
    }
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
      this.loadPosts()
    }
    this.loadMyGroups()
  },

  viewPost(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/packages/social/pages/buddyPost/buddyPost?postId=${encodeURIComponent(id)}` })
  },

  viewCreatorProfile(e) {
    const uid = e.currentTarget.dataset.userid
    if (uid) wx.navigateTo({ url: `/packages/social/pages/friendProfile/friendProfile?friendId=${uid}` })
  },

  switchBuddyType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ buddyType: type })
    this.loadRecommendations()
  },

  async toggleInterest(e) {
    var userId = e.currentTarget.dataset.userid
    var rec = (this.data.recommendations || []).find(function(r) { return r.userId === userId })
    if (rec && rec.status === 'matched') return
    var sentMap = this.data.sentInterestIds
    var reqMap = this.data.interestSentRequestIds
    var STORAGE_KEY = 'match_sent_cache'
    // 合并本地缓存，确保与 loadRecommendations 的判断一致
    var cached = wx.getStorageSync(STORAGE_KEY) || {}
    sentMap = Object.assign({}, cached, sentMap)
    Object.keys(cached).forEach(function(k) {
      if (!reqMap[k] && typeof cached[k] === 'string') reqMap[k] = cached[k]
    })

    // 已申请 → 取消
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
            // 乐观更新：立即将按钮改为"感兴趣"
            var recs2 = (this.data.recommendations || []).map(function(r) {
              if (r.userId === userId) return Object.assign({}, r, { status: undefined })
              return r
            })
            var newSent2 = Object.assign({}, this.data.sentInterestIds)
            delete newSent2[userId]
            var newReq2 = Object.assign({}, this.data.interestSentRequestIds)
            delete newReq2[userId]
            // 从本地缓存移除（重建对象避免 delete 序列化问题）
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
              // 缓存过期（如前任搭子解除后的旧请求），清理缓存并回退按钮
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

    // 未申请 → 发送
    try {
      var result = await api.sendMatchInterest(userId, this.data.buddyType)
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
          content: this.data.lang === 'en'
            ? 'You both expressed interest! Contact info exchanged.'
            : '你们双向互发了感兴趣，已自动匹配！联系方式已交换。',
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
    const requestId = e.currentTarget.dataset.id
    try {
      await api.acceptMatchInterest(requestId)
      wx.showToast({ title: this.data.lang === 'en' ? 'Accepted' : '已同意', icon: 'success' })
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async ignoreInterest(e) {
    const requestId = e.currentTarget.dataset.id
    try {
      await api.ignoreMatchInterest(requestId)
      this.loadAll()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async cancelInterest(e) {
    const requestId = e.currentTarget.dataset.id
    try {
      await api.cancelMatchInterest(requestId)
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
          try {
            await api.unmatchPair(pairId)
            wx.showToast({ title: lang === 'en' ? 'Unmatched' : '已解除', icon: 'success' })
            this.loadAll()
          } catch (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  async blockUser(e) {
    const userId = e.currentTarget.dataset.userid
    const name = e.currentTarget.dataset.name || ''
    const lang = this.data.lang
    wx.showModal({
      title: lang === 'en' ? 'Block User?' : '拉黑用户？',
      content: (lang === 'en' ? `Block ${name}? You won't see each other anymore.` : `确定拉黑 ${name}？双方将永久不可见。`),
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.blockMatchUser(userId)
            wx.showToast({ title: lang === 'en' ? 'Blocked' : '已拉黑', icon: 'success' })
            this.loadAll()
          } catch (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  copyWechat(e) {
    const wechat = e.currentTarget.dataset.wechat
    if (wechat) {
      wx.setClipboardData({ data: wechat })
      wx.showToast({ title: this.data.lang === 'en' ? 'Copied' : '已复制', icon: 'success' })
    }
  },

  toggleTestDropdown() { this.setData({ testDropdown: !this.data.testDropdown }) },

  async switchToTest(e) {
    const xipooId = e.currentTarget.dataset.xipooid
    wx.showLoading({ title: '切换中...' })
    try {
      await api.switchToTestUser(xipooId)
      // 清除所有筛选缓存，避免上一用户的设置过滤掉当前用户的数据
      ;['match_sent_cache', 'match_pool_cache', 'matchmaking_recruit_settings', 'xipoo_same_grade_filter', 'buddyCenter_personal_tags', 'buddySquare_settings', 'schedule_tags'].forEach(function(k) { try { wx.removeStorageSync(k) } catch (e) {} })
      try {
        var info = wx.getStorageInfoSync()
        ;(info.keys || []).forEach(function(k) {
          if (k.indexOf('buddyCenter_settings_') === 0) { try { wx.removeStorageSync(k) } catch (e) {} }
        })
      } catch (e) {}
      this.setData({ testDropdown: false, pool: null, recommendations: [], posts: [], myPosts: [], myGroupsRecruiting: [], myGroupsJoined: [], myGroupsEnded: [] })
      wx.hideLoading()
      wx.showToast({ title: '已切换', icon: 'success' })
      this.loadAll()
      // 如果当前在招募 Tab，需要重新加载帖子和我的小组
      if (this.data.mainTab === 'recruit') {
        this.loadPosts()
        this.loadMyGroups()
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '切换失败', icon: 'none' })
    }
  },

  openSettings() {
    const pool = this.data.pool
    const bt = this.data.buddyType
    const btPool = (pool && pool.pools && pool.pools[bt]) ? pool.pools[bt] : { enabled: false, genderFilter: 'any', selectedTags: [] }
    const personalCached = wx.getStorageSync('buddyCenter_personal_tags') || {}
    const recruitCached = wx.getStorageSync('matchmaking_recruit_settings') || {}
    const sameGradeCached = wx.getStorageSync('xipoo_same_grade_filter') || {}
    this.setData({
      settingsOpen: true,
      settingsSelectedTags: [...(btPool.selectedTags || [])],
      settingsGender: recruitCached.gender || btPool.genderFilter || 'any',
      settingsInPool: btPool.enabled || false,
      settingsPersonalTags: [...(personalCached.tags || [])],
      settingsSameGrade: sameGradeCached.sameGrade || recruitCached.sameGrade || false
    })
    if (this.data.mainTab === 'recommend') {
      this.buildTagGroups()
      this.buildPersonalTagGroups()
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

  togglePersonalTag(e) {
    const tagId = e.currentTarget.dataset.tagid
    let selected = [...this.data.settingsPersonalTags]
    const idx = selected.indexOf(tagId)
    if (idx >= 0) selected.splice(idx, 1)
    else { if (selected.length >= 10) { wx.showToast({ title: this.data.lang === 'en' ? 'Max 10' : '最多10个', icon: 'none' }); return } selected.push(tagId) }
    this.setData({ settingsPersonalTags: selected })
    this.buildPersonalTagGroups()
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

  onSettingsGender(e) { this.setData({ settingsGender: e.currentTarget.dataset.g }) },
  onPoolToggle(e) { this.setData({ settingsInPool: e.detail.value }) },
  onSameGradeToggle(e) { this.setData({ settingsSameGrade: e.detail.value }) },

  async saveSettings() {
    const bt = this.data.buddyType
    if (this.data.mainTab === 'recommend') {
      wx.setStorageSync('buddyCenter_personal_tags', { tags: this.data.settingsPersonalTags })
      api.updateMatchSelectedTags(this.data.settingsPersonalTags).catch(() => {})

      const previousPool = this.data.pool
      const pool = Object.assign({}, previousPool || {}, {
        pools: Object.assign({}, (previousPool && previousPool.pools) || {})
      })
      pool.pools[bt] = Object.assign({}, pool.pools[bt] || {}, {
        enabled: this.data.settingsInPool,
        genderFilter: this.data.settingsGender,
        selectedTags: [...this.data.settingsSelectedTags]
      })
      try {
        const savedPool = await api.setMatchPool(bt, {
          enabled: this.data.settingsInPool,
          genderFilter: this.data.settingsGender,
          selectedTags: this.data.settingsSelectedTags
        })
        const resolvedPool = savedPool && savedPool.pools ? savedPool : pool
        wx.setStorageSync('match_pool_cache', resolvedPool)
        this.setData({ pool: resolvedPool, settingsOpen: false })
      } catch (e) {
        console.error('[saveSettings] setMatchPool failed:', e)
        this.setData({ pool: previousPool, settingsOpen: true })
        wx.showToast({ title: (this.data.lang === 'en' ? 'Save failed' : '保存失败，请重试'), icon: 'none' })
        return
      }

      wx.setStorageSync('xipoo_same_grade_filter', { sameGrade: this.data.settingsSameGrade })
      wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
      this.loadAll()
    } else {
      wx.setStorageSync('xipoo_same_grade_filter', { sameGrade: this.data.settingsSameGrade })
      this.setData({ settingsOpen: false })
      wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
      this.loadPosts()
    }
  }
})
