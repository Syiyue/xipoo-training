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

Page({
  data: {
    mode: 'course',
    tab: 'square',

    courses: [],
    selectedCourse: null,
    posts: [],
    showForm: false,
    formTitle: '',
    formInfo: '',
    memberOptions: [2, 3, 4, 5, 6, 8, 10],
    memberIdx: 0,
    formGender: 'any',
    formDeadline: '',
    formDeadlineTime: '23:59',
    formLocation: '',

    // 申请弹窗
    applyOpen: false,
    applyPostId: '',
    applyPostTitle: '',
    applyMsg: '',

    // 消息Tab
    receivedApps: [],
    myApps: [],

    // 我的Tab
    myPosts: [],
    myPairs: [],

    // 设置
    settingsOpen: false,
    settingsSelectedTags: [],
    settingsTagGroups: [],
    settingsGender: 'any',

    loading: false,
    lang: 'zh'
  },

  onLoad() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date()
    d.setDate(d.getDate() + 7)
    this.setData({
      lang,
      formDeadline: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }, () => {
      wx.setNavigationBarTitle({ title: lang === 'en' ? 'Team Square' : '组队广场' })
    })
  },

  onShow() {
    const app = getApp()
    if (app.requireLogin && !app.requireLogin()) return
    this.loadCourses()
    this.loadPosts()
    this.loadStatus()
  },

  // ---- 模式切换 ----

  switchMode(e) {
    const m = e.currentTarget.dataset.mode
    this.setData({ mode: m, selectedCourse: null, formTitle: '', formInfo: '' })
    this.loadPosts()
  },

  switchTab(e) {
    const t = e.currentTarget.dataset.tab
    this.setData({ tab: t })
    if (t === 'messages') {
      wx.setStorageSync('msg_last_seen', new Date().toISOString())
      this.setData({ newMsgCount: 0 })
      this.loadStatus()
    }
    if (t === 'mine') this.loadStatus()
    if (t === 'square') this.loadPosts()
  },

  // ---- 课程列表 ----

  async loadCourses() {
    try {
      const center = await api.getBuddyCenter()
      this.setData({ courses: (center.courses || []).filter((c) => c.confirmed !== false) })
    } catch (e) {
      console.error('[buddySquare] loadCourses failed', e)
    }
  },

  selectCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const course = this.data.courses.find((c) => c.id === courseId)
    this.setData({ selectedCourse: course })
    this.loadPosts()
  },

  clearCourse() {
    this.setData({ selectedCourse: null, posts: [] })
  },

  // ---- 帖子列表 ----

  async loadPosts() {
    this.setData({ loading: true })
    try {
      const filters = {}
      if (this.data.mode === 'course' && this.data.selectedCourse) {
        filters.type = 'project'  // 课程组队用 project 类型
      }
      const posts = await api.getBuddyPosts(filters)
      let filtered = posts || []
      if (this.data.mode === 'course') {
        if (this.data.selectedCourse) {
          const cid = this.data.selectedCourse.id
          filtered = filtered.filter((p) => p._courseId === cid || (p.title || '').includes(this.data.selectedCourse.courseCode || ''))
        } else {
          filtered = []
        }
      } else if (this.data.mode === 'general') {
        filtered = filtered.filter((p) => p.type !== 'project')
      }
      // 过滤被屏蔽用户的帖子（兜底，云函数端已做过滤）
      let blockedIds = []
      try {
        const blocked = await api.getBlockedUsers()
        blockedIds = (blocked || []).map(function(b) { return b.blockedUserId }).filter(Boolean)
      } catch (e) { /* ignore */ }
      if (blockedIds.length > 0) {
        filtered = filtered.filter(function(p) { return blockedIds.indexOf(p.creatorUserId) < 0 })
      }
      const me2 = await api.me()
      const myId2 = me2 ? me2.id : ''
      const myP = filtered.filter((p) => p.isCreator)
      const otherPosts = filtered.filter((p) => !p.isCreator)
      this.setData({ posts: otherPosts, myPosts: myP })
    } catch (e) {
      console.error('[buddySquare] loadPosts failed', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  // ---- 发布 ----

  openForm() { this.setData({ showForm: true }) },
  closeForm() { this.setData({ showForm: false, formTitle: '', formInfo: '' }) },
  onTitleInput(e) { this.setData({ formTitle: e.detail.value }) },
  onInfoInput(e) { this.setData({ formInfo: e.detail.value }) },
  onMemberPick(e) { this.setData({ memberIdx: Number(e.detail.value) }) },
  setFormGender(e) { this.setData({ formGender: e.currentTarget.dataset.g }) },
  onDeadlinePick(e) { this.setData({ formDeadline: e.detail.value }) },
  onDeadlineTimePick(e) { this.setData({ formDeadlineTime: e.detail.value }) },
  onFormLoc(e) { this.setData({ formLocation: e.detail.value }) },

  async publish() {
    const title = (this.data.formTitle || '').trim()
    const info = (this.data.formInfo || '').trim()
    const mode = this.data.mode
    if (!title) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Enter a title' : '请输入招募标题', icon: 'none' })
      return
    }

    if (mode === 'course' && !this.data.selectedCourse) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Select a course first' : '请先选择课程', icon: 'none' })
      return
    }

    try {
      const center = await api.getBuddyCenter()
      const campusScope = (center.scopes || []).find((s) => s.scopeType === 'campus')
      const now = new Date()
      const deadline = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      const dStr = `${deadline.getFullYear()}-${pad(deadline.getMonth() + 1)}-${pad(deadline.getDate())}`

      const maxMembers = this.data.memberOptions[this.data.memberIdx]
      const postData = {
        type: mode === 'course' ? 'project' : 'study',
        scopeKey: campusScope ? campusScope.scopeKey : '',
        title: mode === 'course' ? `[${this.data.selectedCourse.courseCode || this.data.selectedCourse.title}] ${title}` : title,
        maxMembers: maxMembers,
        startAt: `${dStr}T12:00:00+08:00`,
        endAt: `${dStr}T14:00:00+08:00`,
        locationTag: this.data.formLocation || '未指定',
        tags: [this.data.formGender],
        description: info,
        deadline: `${this.data.formDeadline}T${this.data.formDeadlineTime}:00+08:00`
      }

      if (mode === 'course' && this.data.selectedCourse) {
        postData._courseId = this.data.selectedCourse.id
      }

      await api.createBuddyPost(postData)
      wx.showToast({ title: this.data.lang === 'en' ? 'Published' : '发布成功', icon: 'success' })
      this.setData({ formTitle: '', formInfo: '' })
      this.loadPosts()
    } catch (e) {
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
    }
  },

  // ---- 详情 ----

  openPost(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/packages/social/pages/buddyPost/buddyPost?postId=${id}` })
  },

  openPostById(e) {
    const id = e.currentTarget.dataset.postid
    if (id) wx.navigateTo({ url: `/packages/social/pages/buddyPost/buddyPost?postId=${id}` })
  },

  viewProfile(e) {
    const uid = e.currentTarget.dataset.userid
    if (uid) wx.navigateTo({ url: `/packages/social/pages/friendProfile/friendProfile?friendId=${uid}` })
  },

  async blockUser(e) {
    const userId = e.currentTarget.dataset.userid
    const name = e.currentTarget.dataset.name || ''
    const lang = this.data.lang
    if (!userId) return
    wx.showModal({
      title: lang === 'en' ? 'Block this user?' : '屏蔽该用户？',
      content: lang === 'en' ? 'You will no longer see this user.' : '屏蔽后将不再看到该用户。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.blockMatchUser(userId)
          wx.showToast({ title: lang === 'en' ? 'Blocked' : '已屏蔽', icon: 'success' })
          this.loadPosts()
        } catch (err) {
          wx.showToast({ title: err.message || (lang === 'en' ? 'Failed' : '操作失败'), icon: 'none' })
        }
      }
    })
  },

  async cancelPost(e) {
    const id = e.currentTarget.dataset.id
    const lang = this.data.lang
    wx.showModal({
      title: lang === 'en' ? 'Cancel recruitment?' : '取消招募？',
      content: lang === 'en' ? 'This will close the recruitment post.' : '这将关闭该招募帖。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteBuddyPost(id)
            wx.showToast({ title: lang === 'en' ? 'Cancelled' : '已取消', icon: 'success' })
            this.loadPosts()
            this.loadStatus()
          } catch (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  // ---- 申请 ----

  openApply(e) {
    this.setData({
      applyOpen: true,
      applyPostId: e.currentTarget.dataset.id,
      applyPostTitle: e.currentTarget.dataset.title || '',
      applyMsg: ''
    })
  },

  closeApply() { this.setData({ applyOpen: false }) },
  onApplyMsg(e) { this.setData({ applyMsg: e.detail.value }) },

  async submitApply(force) {
    const postId = this.data.applyPostId
    const msg = (this.data.applyMsg || '').trim()
    try {
      const result = await api.applyBuddyPost(postId, { message: msg || (this.data.lang === 'en' ? 'I want to join!' : '我想加入！'), force: force === true })
      if (result && result.needConfirm && result.blockedUsers) {
        const names = result.blockedUsers.map((u) => u.name).join('、')
        const that = this
        wx.showModal({
          title: this.data.lang === 'en' ? 'Blocked User in Group' : '小组内有已拉黑用户',
          content: (this.data.lang === 'en' ? `You have blocked: ${names}. Continue?` : `该小组存在你已拉黑的用户：${names}，是否继续申请？`),
          success(res) {
            if (res.confirm) that.submitApply(true)
          }
        })
        return
      }
      wx.showToast({ title: this.data.lang === 'en' ? 'Applied' : '已申请', icon: 'success' })
      this.setData({ applyOpen: false })
      this.loadPosts()
    } catch (e) {
      wx.showToast({ title: e.message || '申请失败', icon: 'none' })
    }
  },

  async applyPost(e) {
    const postId = e.currentTarget.dataset.id
    try {
      const result = await api.applyBuddyPost(postId, { message: this.data.lang === 'en' ? 'I want to join!' : '我想加入！', force: false })
      if (result && result.needConfirm && result.blockedUsers) {
        const names = result.blockedUsers.map((u) => u.name).join('、')
        const that = this
        wx.showModal({
          title: this.data.lang === 'en' ? 'Blocked User in Group' : '小组内有已拉黑用户',
          content: (this.data.lang === 'en' ? `You have blocked: ${names}. Continue?` : `该小组存在你已拉黑的用户：${names}，是否继续申请？`),
          success(res) {
            if (res.confirm) that.applyPostForce(postId)
          }
        })
        return
      }
      wx.showToast({ title: this.data.lang === 'en' ? 'Applied' : '已申请', icon: 'success' })
      this.loadPosts()
    } catch (e) {
      wx.showToast({ title: e.message || '申请失败', icon: 'none' })
    }
  },

  async applyPostForce(postId) {
    try {
      await api.applyBuddyPost(postId, { message: this.data.lang === 'en' ? 'I want to join!' : '我想加入！', force: true })
      wx.showToast({ title: this.data.lang === 'en' ? 'Applied' : '已申请', icon: 'success' })
      this.loadPosts()
    } catch (e) {
      wx.showToast({ title: e.message || '申请失败', icon: 'none' })
    }
  },

  // ---- 消息 & 我的 ----

  async loadStatus() {
    try {
      const [posts, me] = await Promise.all([api.getBuddyPosts({}), api.me()])
      const myId = me.id

      // 收到的申请：我发的帖子中状态为pending的申请
      const myPosts = (posts || []).filter((p) => p.isCreator)
      const received = []
      myPosts.forEach((p) => {
        ;(p.applications || []).forEach((a) => {
          received.push({ id: a.id, postId: p.id, postTitle: p.title, applicant: a.applicant, message: a.message, createdAt: a.createdAt || '', status: a.status })
        })
      })

      // 我的申请（排除已撤回/已删除）
      const myApps = []
      ;(posts || []).forEach((p) => {
        if (p.myApplicationStatus && p.myApplicationStatus !== 'withdrawn' && p.myApplicationStatus !== 'deleted') {
          myApps.push({ id: p.myApplicationId || p.id, postId: p.id, postTitle: p.title, status: p.myApplicationStatus, createdAt: p.createdAt })
        }
      })

      // 已加入的组队
      const myPairs = (posts || []).filter((p) => p.isMember)

      const lastSeen = wx.getStorageSync('msg_last_seen') || '0'
      const newMsgCount = received.filter((r) => (r.createdAt || '') > lastSeen).length + myApps.filter((a) => (a.createdAt || '') > lastSeen).length
      this.setData({ receivedApps: received, myApps, myPosts, myPairs, newMsgCount })
    } catch (e) {
      console.error('[buddySquare] loadStatus failed', e)
    }
  },

  async acceptApplication(e) {
    try {
      await api.acceptBuddyApplication(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Accepted' : '已接受', icon: 'success' })
      this.loadStatus()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async cancelMyApplication(e) {
    try {
      await api.withdrawBuddyApplication(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Cancelled' : '已撤回', icon: 'success' })
      this.loadStatus()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async deleteMyApplication(e) {
    try {
      await api.deleteBuddyApplication(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Deleted' : '已删除', icon: 'success' })
      this.loadStatus()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  async rejectApplication(e) {
    try {
      await api.rejectBuddyApplication(e.currentTarget.dataset.id)
      wx.showToast({ title: this.data.lang === 'en' ? 'Rejected' : '已拒绝', icon: 'success' })
      this.loadStatus()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  // ---- 设置 ----

  openSettings() {
    const cached = wx.getStorageSync('buddySquare_settings') || {}
    this.setData({
      settingsOpen: true,
      settingsSelectedTags: [...(cached.selectedTags || [])],
      settingsGender: cached.gender || 'any'
    })
    this.buildTagGroups()
  },

  noop() {},
  closeSettings() { this.setData({ settingsOpen: false }) },

  toggleSettingsTag(e) {
    const tagId = e.currentTarget.dataset.tagid
    let selected = [...this.data.settingsSelectedTags]
    const idx = selected.indexOf(tagId)
    if (idx >= 0) { selected.splice(idx, 1) }
    else {
      if (selected.length >= 10) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Max 10 tags' : '最多10个标签', icon: 'none' })
        return
      }
      selected.push(tagId)
    }
    this.setData({ settingsSelectedTags: selected })
    this.buildTagGroups()
  },

  buildTagGroups() {
    const catOrder = ['study', 'sport', 'meal', 'lifestyle', 'entertainment']
    const catLabel = {
      zh: { study: '学习', sport: '运动', meal: '饮食', lifestyle: '作息', entertainment: '娱乐' },
      en: { study: 'Study', sport: 'Sports', meal: 'Food', lifestyle: 'Lifestyle', entertainment: 'Entertainment' }
    }
    const lang = this.data.lang
    const selected = this.data.settingsSelectedTags
    const groups = catOrder.map((cat) => ({
      category: cat,
      label: catLabel[lang][cat] || cat,
      tags: SYSTEM_TAGS.filter((t) => t.category === cat).map((t) => ({
        ...t, selected: selected.includes(t.id)
      }))
    }))
    this.setData({ settingsTagGroups: groups })
  },

  onSettingsGender(e) {
    this.setData({ settingsGender: e.currentTarget.dataset.g })
  },

  saveSettings() {
    wx.setStorageSync('buddySquare_settings', {
      selectedTags: this.data.settingsSelectedTags,
      gender: this.data.settingsGender
    })
    wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
    this.setData({ settingsOpen: false })
  }
})
