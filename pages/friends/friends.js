const api = require('../../utils/api')
const store = require('../../utils/store')
const { getWindowInfo } = require('../../utils/device')
const { resolveCloudImages } = require('../../utils/cloudImage')

const TIME_GROUPS_KEY = 'xipoo_time_groups'

// 权限等级文案（与 friend 云函数 permission level 对应）
function permLabel(level, lang) {
  const map = {
    none: lang === 'en' ? 'Not shared' : '不共享',
    busy: lang === 'en' ? 'Busy/free only' : '仅忙闲状态',
    title: lang === 'en' ? 'Course title & time' : '课程名称和时间',
    detail: lang === 'en' ? 'Full schedule' : '完整日程'
  }
  return map[level] || map.none
}

function permissionOptions(lang) {
  return [
    { value: 'none', label: lang === 'en' ? 'Not shared' : '不共享', desc: lang === 'en' ? 'They cannot see anything' : '对方无法查看我的任何安排' },
    { value: 'busy', label: lang === 'en' ? 'Busy/free only' : '仅忙闲状态', desc: lang === 'en' ? 'Only busy or free status, no course names or places' : '只显示忙碌或空闲，不含课程信息' },
    { value: 'detail', label: lang === 'en' ? 'Full course info' : '完整课程信息', desc: lang === 'en' ? 'Course names, times and places (private items excluded)' : '展示课程名称、时间和地点（私密日程除外）' }
  ]
}

function normalizeUser(user) {
  return Object.assign({
    signature: '',
    profileTheme: 'mint'
  }, user || {})
}

// 为联系人补充权限文案
function decorateFriends(friends, lang) {
  return (friends || []).map((item) => Object.assign({}, item, {
    rowKey: item && item.friend ? item.friend.id : item.id,
    myPermission: item.myPermission || { level: item.myShare ? 'busy' : 'none' },
    friendPermission: item.friendPermission || { level: item.friendShare ? 'busy' : 'none' },
    myPermLabel: permLabel((item.myPermission || {}).level || (item.myShare ? 'busy' : 'none'), lang),
    friendPermLabel: permLabel((item.friendPermission || {}).level || (item.friendShare ? 'busy' : 'none'), lang)
  }))
}

// 首次 setData 之前先剥离 cloud:// 文件 ID。否则异步换取临时链接还没返回时，
// <image> 已经把 cloud:// 当作页面本地路径加载，开发者工具就会报 127.0.0.1 图片错误。
function hideRawFriendAvatarUrls(records) {
  return (Array.isArray(records) ? records : []).map((item) => {
    if (!item || !item.friend) return item
    const friend = item.friend
    const avatarUrl = String(friend.avatarUrl || '')
    if (!/^cloud:\/\//.test(avatarUrl)) return item
    return Object.assign({}, item, {
      friend: Object.assign({}, friend, {
        avatarUrl: '',
        avatarFileId: avatarUrl
      })
    })
  })
}

// users / friendships 中的头像通常是 cloud:// 文件 ID；<image> 只能安全使用临时 HTTPS URL。
// 获取失败时清空该字段，让界面回退到昵称首字母，绝不把 cloud:// 直接交给渲染层。
async function resolveFriendAvatarUrls(records) {
  const list = Array.isArray(records) ? records : []
  const friendRows = list.map((item) => item && item.friend ? item.friend : null)
  const resolvedFriends = await resolveCloudImages(friendRows, 'avatarUrl')
  return list.map((item, index) => {
    if (!item || !item.friend) return item
    const friend = resolvedFriends[index] || item.friend
    const avatarUrl = /^cloud:\/\//.test(String(friend.avatarUrl || '')) ? '' : (friend.avatarUrl || '')
    return Object.assign({}, item, { friend: Object.assign({}, friend, { avatarUrl }) })
  })
}

Page({
  data: {
    user: null,
    isGuest: false,
    keyword: '',
    results: [],
    friends: [],
    requests: [],
    friendIds: [],
    sentRequestIds: [],
    searchLoading: false,
    friendsView: 'home',
    contactTab: 'share',
    visibleContacts: [],
    authorizedCount: 0,
    requestDialogOpen: false,
    requestDialogTarget: {},
    bannerVisible: false,
    bannerRequest: {},
    hiddenFriends: [],
    hiddenPanelOpen: false,
    timeGroups: [],
    groupNameDraft: '',
    groupMemberDraft: [],
    groupMemberMap: {},
    invitePanelOpen: false,
    inviteFrom: {},
    inviteGrantLevel: 'busy',
    permissionOptions: [],
    shareRangeOpen: false,
    shareRangeRequestId: '',
    shareRangeStart: '',
    shareRangeEnd: '',
    lang: 'zh',
    themeOptions: [
      { id: 'mint', label: '薄荷绿' },
      { id: 'sky', label: '晴空蓝' },
      { id: 'coral', label: '珊瑚粉' },
      { id: 'graphite', label: '石墨灰' }
    ],
    genderOptions: ['男', '女', '其他'],
    degreeOptions: ['Year 1', 'Year 2', 'Year 3', 'Year 4', "Master's", 'PhD'],
    visibilityOptions: [],
    statusBarHeight: 20,
    // 新手引导
    introGuideVisible: false,
    introSteps: []
  },

  onLoad(options = {}) {
    const windowInfo = getWindowInfo()
    this.setData({
      statusBarHeight: Number(windowInfo.statusBarHeight) || 20,
      permissionOptions: permissionOptions('zh'),
      timeGroups: wx.getStorageSync(TIME_GROUPS_KEY) || []
    })
    // 微信邀请卡片进入：记录邀请人，待登录与资料加载完成后弹出接受面板
    if (options.inviteFrom) {
      this.pendingInviteFrom = String(options.inviteFrom).trim().toUpperCase()
    }
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const isGuest = app.isLoggedIn ? !app.isLoggedIn() : false
    this.setData({ lang, isGuest, permissionOptions: permissionOptions(lang) }, () => {
      wx.setNavigationBarTitle({ title: this.data.lang === 'en' ? 'Schedule Sharing' : '日程共享' })
      // 从「多人共同空闲」的邀请按钮跳转而来：自动打开邀请同学面板
      if (!isGuest && app.globalData && app.globalData.pendingFriendsView === 'add') {
        app.globalData.pendingFriendsView = ''
        this.setData({ friendsView: 'add', keyword: '', results: [] })
        wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      }
      if (isGuest) return // 游客只看空态，不加载个人数据

      // 优先同步全局缓存的 userInfo（editProfile 返回时会更新）
      const globalUser = app.globalData && app.globalData.userInfo
      if (globalUser && this.data.user) {
        const needRefresh = globalUser.avatarUrl !== this.data.user.avatarUrl
          || globalUser.name !== this.data.user.name
        if (needRefresh) {
          this.setData({ user: Object.assign({}, globalUser) })
          this._lastLoadAt = Date.now()
          this.maybeOpenInvitePanel()
          return
        }
      }
      if (globalUser && !this.data.user) {
        this.setData({ user: Object.assign({}, globalUser) })
      }

      // 只在数据过期时才重新加载，避免每次 onShow 都发请求
      if (this._lastLoadAt && Date.now() - this._lastLoadAt < 30000) {
        this.maybeOpenInvitePanel()
        return
      }
      this.loadData()
    })
    // 新手引导检查
    setTimeout(() => this.checkIntroGuide(), 800)
  },

  // ==================== 定时轮询 ====================
  startPolling() {
    this.stopPolling()
    this._pollTimer = setInterval(() => {
      this._silentCheckRequests()
    }, 10000)
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  async _silentCheckRequests() {
    try {
      const [friendsResult, requests] = await Promise.all([
        api.getFriendships(),
        api.getRequests()
      ])
      // 适配新返回值格式：{ friends, hidden } 或旧格式的数组
      const friendsList = Array.isArray(friendsResult) ? friendsResult : (friendsResult.friends || [])
      const hiddenList = Array.isArray(friendsResult) ? [] : (friendsResult.hidden || [])
      const oldCount = this.data.requests.length
      const newCount = requests.length
      if (newCount > oldCount && requests.length > 0) {
        const latest = requests.reduce((a, b) => {
          const aTime = a.createdAt || a.createTime || ''
          const bTime = b.createdAt || b.createTime || ''
          return bTime > aTime ? b : a
        })
        this.setData({ bannerVisible: true, bannerRequest: { fromUser: latest.fromUser } })
        wx.showToast({
          title: this.data.lang === 'en'
            ? `${newCount - oldCount} new share invitation(s)!`
            : `收到 ${newCount - oldCount} 条新共享邀请`,
          icon: 'none',
          duration: 2500
        })
      }
      const friendIds = friendsList.map((item) => item.friend && item.friend.id).filter(Boolean)
      // 保留本地乐观更新的 sentRequestIds
      const sentIds = this.data.sentRequestIds || []
      this.applyFriends(friendsList, hiddenList, requests, friendIds, sentIds)
      if (this.data.keyword) {
        this.enrichSearchResults()
      }
      // 更新红点
      if (newCount > 0) {
        wx.setTabBarBadge({ index: 1, text: String(newCount) }).catch(() => {})
      } else {
        wx.removeTabBarBadge({ index: 1 }).catch(() => {})
      }
    } catch (_) {
      // 静默轮询失败不打扰用户
    }
  },

  // 统一刷新联系人相关派生数据
  applyFriends(friendsList, hiddenList, requests, friendIds, sentIds) {
    const lang = this.data.lang
    // 先以安全的占位头像渲染；临时 HTTPS 地址准备好后 hydrateFriendAvatarUrls 再替换。
    const friends = decorateFriends(hideRawFriendAvatarUrls(friendsList), lang)
    const hiddenFriends = decorateFriends(hideRawFriendAvatarUrls(hiddenList), lang)
    const authorizedCount = friends.filter((item) => item.myPermission.level !== 'none').length
    // 「共享」tab 显示所有日程联系人（不过滤权限）；「我的小组」tab 另行处理
    const visibleContacts = friends
    this.setData({
      friends,
      hiddenFriends,
      requests: requests === undefined ? this.data.requests : requests,
      friendIds: friendIds === undefined ? this.data.friendIds : friendIds,
      sentRequestIds: sentIds === undefined ? this.data.sentRequestIds : sentIds,
      authorizedCount,
      visibleContacts
    })
    this.hydrateFriendAvatarUrls(friendsList, hiddenList)
  },

  async hydrateFriendAvatarUrls(friendsList, hiddenList) {
    const [resolvedFriends, resolvedHidden] = await Promise.all([
      resolveFriendAvatarUrls(friendsList),
      resolveFriendAvatarUrls(hiddenList)
    ])
    // 异步临时 URL 返回时，若联系人已被刷新，不能拿旧结果覆盖新数据。
    const currentIds = (this.data.friends || []).map((item) => item.friend && item.friend.id).filter(Boolean).join('|')
    const resolvedIds = (resolvedFriends || []).map((item) => item.friend && item.friend.id).filter(Boolean).join('|')
    if (currentIds !== resolvedIds) return
    const friends = decorateFriends(resolvedFriends, this.data.lang)
    const hiddenFriends = decorateFriends(resolvedHidden, this.data.lang)
    // 「共享」tab 显示所有日程联系人（不过滤权限）
    const visibleContacts = friends
    this.setData({ friends, hiddenFriends, visibleContacts })
  },

  // 云文件临时地址失效时，退回昵称首字母，避免开发者工具持续把 cloud:// 当成本地图片加载。
  onFriendAvatarError(event) {
    const friendId = event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.id
      : ''
    if (!friendId) return
    const clearAvatar = (list) => (list || []).map((item) => {
      if (!item || !item.friend || item.friend.id !== friendId) return item
      return Object.assign({}, item, { friend: Object.assign({}, item.friend, { avatarUrl: '' }) })
    })
    const friends = clearAvatar(this.data.friends)
    const hiddenFriends = clearAvatar(this.data.hiddenFriends)
    const visibleContacts = friends
    this.setData({ friends, hiddenFriends, visibleContacts })
  },

  async loadData() {
    try {
      const app = getApp()

      // 全局缓存优先：命中则立即渲染，后台异步刷新
      const cachedUser = app.getCached('me')
      const cachedFriendships = app.getCached('friendships')
      if (cachedUser && cachedFriendships && !this.data.user) {
        const user = normalizeUser(cachedUser)
        const friendIds = cachedFriendships.map((item) => item.friend && item.friend.id).filter(Boolean)
        this.setData({ user, friendIds })
        this.applyFriends(cachedFriendships, [], undefined, friendIds, undefined)
        this._lastLoadAt = Date.now()
      }

      // 先从 global store 拉取最新资料（内部已调用 api.me()，复用其结果，避免重复请求）
      const rawUser = await store.fetchAndSetUserInfo()
      const [friendsResult, requests] = await Promise.all([
        api.getFriendships(),
        api.getRequests()
      ])

      // 云函数失败时 api 层回退 mock 数据并打 __cloudFailed 标记，
      // 这类结果绝不能覆盖已有的真实数据（云端抖动导致界面内容跳变的根因）
      const userFailed = !rawUser || Boolean(rawUser.__cloudFailed)
      const friendsFailed = Boolean(friendsResult && friendsResult.__cloudFailed)
      const requestsFailed = Boolean(requests && requests.__cloudFailed)

      // 适配新返回值格式：{ friends, hidden } 或旧格式的数组
      const friendsList = friendsFailed
        ? this.data.friends
        : (Array.isArray(friendsResult) ? friendsResult : (friendsResult.friends || []))
      const hiddenList = friendsFailed
        ? this.data.hiddenFriends
        : (Array.isArray(friendsResult) ? [] : (friendsResult.hidden || []))

      // 更新全局缓存（仅真实成功的结果）
      if (!userFailed) app.setCached('me', rawUser)
      if (!friendsFailed) app.setCached('friendships', friendsList)

      const requestsList = requestsFailed ? this.data.requests : requests
      const user = userFailed ? this.data.user : normalizeUser(rawUser)
      const friendIds = (friendsList || []).map((item) => item.friend && item.friend.id).filter(Boolean)
      this.setData({ user })
      this.applyFriends(friendsList, hiddenList, requestsList, friendIds, undefined)
      if (this.data.keyword) {
        this.enrichSearchResults()
      }
      // 更新红点
      const count = (requestsList || []).length
      if (count > 0) {
        wx.setTabBarBadge({ index: 1, text: String(count) }).catch(() => {})
      } else {
        wx.removeTabBarBadge({ index: 1 }).catch(() => {})
      }
      this.maybeOpenInvitePanel()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load' : '日程共享页面加载失败'),
        icon: 'none'
      })
    }
  },

  // ==================== 微信邀请 ====================
  // 邀请卡片：onShareAppMessage 由 open-type="share" 的按钮触发
  onShareAppMessage() {
    const user = this.data.user || {}
    return {
      title: this.data.lang === 'en'
        ? 'Invite you to share schedules with me'
        : '邀请你与我建立日程共享',
      imageUrl: '/images/share/invite-cover.jpg',
      path: `/pages/friends/friends?inviteFrom=${user.id || ''}`
    }
  },

  copyInviterId(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({
          title: this.data.lang === 'en' ? 'Xipoo ID copied' : 'Xipoo ID 已复制',
          icon: 'none'
        })
      }
    })
  },

  copyMyId() {
    const id = this.data.user && this.data.user.id
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({
          title: this.data.lang === 'en' ? 'Xipoo ID copied' : 'Xipoo ID 已复制',
          icon: 'none'
        })
      }
    })
  },

  // 被邀请人打开小程序卡片后：展示接受面板
  async maybeOpenInvitePanel() {
    const inviterId = this.pendingInviteFrom
    if (!inviterId || this.data.isGuest || this.data.invitePanelOpen) return
    const myId = this.data.user && this.data.user.id
    if (!myId || inviterId === myId) {
      this.pendingInviteFrom = ''
      return
    }
    // 已是联系人则不再打扰
    if (this.data.friendIds.includes(inviterId)) {
      this.pendingInviteFrom = ''
      return
    }
    this.pendingInviteFrom = ''
    try {
      const results = await api.searchUsers(inviterId)
      const inviter = (results || []).find((item) => item.id === inviterId)
      if (!inviter) return
      this.setData({
        invitePanelOpen: true,
        inviteFrom: inviter,
        inviteGrantLevel: 'busy'
      })
    } catch (_) { /* 邀请人查询失败则静默忽略 */ }
  },

  selectInviteGrant(event) {
    this.setData({ inviteGrantLevel: event.currentTarget.dataset.value })
  },

  async confirmAcceptInvite() {
    const inviterId = this.data.inviteFrom && this.data.inviteFrom.id
    if (!inviterId) return
    try {
      await api.acceptInvite(inviterId, this.data.inviteGrantLevel)
      this.setData({ invitePanelOpen: false, inviteFrom: {} })
      wx.showToast({
        title: this.data.lang === 'en' ? 'Schedule sharing enabled' : '已建立日程共享',
        icon: 'success'
      })
      this._lastLoadAt = 0
      this.loadData()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    }
  },

  declineInvite() {
    this.setData({ invitePanelOpen: false, inviteFrom: {} })
  },

  // ==================== 搜索与发送共享邀请（Xipoo ID 精确查询） ====================
  onKeyword(event) {
    const value = event.detail.value
    this.setData({ keyword: value })
    if (!value.trim()) {
      this.setData({ results: [] })
    }
  },

  async search() {
    // 防抖：500ms 内不重复搜索
    const now = Date.now()
    if (this._lastSearchAt && now - this._lastSearchAt < 500) return
    this._lastSearchAt = now

    const keyword = this.data.keyword.trim().toUpperCase()
    if (!keyword) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'Please enter a complete Xipoo ID' : '请输入完整 Xipoo ID',
        icon: 'none'
      })
      return
    }
    this.setData({ searchLoading: true })
    try {
      const rawResults = await api.searchUsers(keyword)
      this.setData({ results: rawResults.map((item) => ({ ...item, isFriend: false, requested: false })) })
      this.enrichSearchResults()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Search failed' : '搜索失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ searchLoading: false })
    }
  },

  enrichSearchResults() {
    const { results, friendIds, requests, sentRequestIds } = this.data
    if (!results.length) return
    const enriched = results.map((item) => ({
      ...item,
      isFriend: friendIds.includes(item.id),
      // 乐观：本地 sentRequestIds 包含即算已邀请；后端 requests 是收到的邀请
      requested: sentRequestIds.includes(item.id) || requests.some((req) => req.fromUser && req.fromUser.id === item.id)
    }))
    this.setData({ results: enriched })
  },

  // 打开邀请弹窗（而非直接发送）
  openRequestDialog(event) {
    const target = {
      id: event.currentTarget.dataset.id,
      name: event.currentTarget.dataset.name || '',
      avatar: event.currentTarget.dataset.avatar || '?',
      avatarUrl: event.currentTarget.dataset.avatarUrl || ''
    }
    this.setData({ requestDialogOpen: true, requestDialogTarget: target })
  },

  closeRequestDialog() {
    this.setData({ requestDialogOpen: false, requestDialogTarget: {} })
  },

  // 发送共享邀请（带 message）
  async onSendRequest(e) {
    const { targetId, message } = e.detail
    if (!targetId) return
    this.setData({ requestDialogOpen: false, requestDialogTarget: {} })
    try {
      await api.sendFriendRequest(targetId, message || '', 'xipoo_id')
      wx.showToast({
        title: this.data.lang === 'en' ? 'Share invitation sent' : '共享邀请已发送',
        icon: 'success'
      })
      // === 乐观更新：立即标记为已邀请，防止闪回 ===
      const sentIds = [...(this.data.sentRequestIds || []), targetId]
      this.setData({
        sentRequestIds: sentIds,
        results: this.data.results.map((item) =>
          item.id === targetId ? { ...item, requested: true } : item
        )
      })
      // 静默刷新数据（不覆盖乐观状态）
      this._silentCheckRequests()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to send' : '发送失败'),
        icon: 'none'
      })
    }
  },

  toggleAddPanel() {
    this.setData({ friendsView: 'add', keyword: '', results: [] })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  switchFriendView(event) {
    const view = event.currentTarget.dataset.view
    if (view !== 'add' && view !== 'requests') return
    this.setData({ friendsView: view })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  showFriendsHome() {
    this.setData({
      friendsView: 'home',
      keyword: '',
      results: [],
      requestDialogOpen: false,
      requestDialogTarget: {}
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  // ==================== 联系人标签页 ====================
  switchContactTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (!['share', 'groups'].includes(tab)) return
    this.setData({ contactTab: tab })
    this.applyFriends(this.data.friends, this.data.hiddenFriends, undefined, undefined, undefined)
  },

  openMyShareTab() {
    this.setData({ contactTab: 'share', friendsView: 'home' })
    this.applyFriends(this.data.friends, this.data.hiddenFriends, undefined, undefined, undefined)
    wx.pageScrollTo({ selector: '.friends-list-section', duration: 300 })
  },

  // ==================== 时间小组 ====================
  onGroupNameInput(event) {
    this.setData({ groupNameDraft: event.detail.value })
  },

  toggleGroupMember(event) {
    const id = event.currentTarget.dataset.id
    const draft = this.data.groupMemberDraft.slice()
    const index = draft.indexOf(id)
    if (index >= 0) draft.splice(index, 1)
    else draft.push(id)
    const groupMemberMap = {}
    draft.forEach((memberId) => { groupMemberMap[memberId] = true })
    this.setData({ groupMemberDraft: draft, groupMemberMap })
  },

  saveTimeGroup() {
    const name = (this.data.groupNameDraft || '').trim()
    if (!name) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Please name the group' : '请填写小组名称', icon: 'none' })
      return
    }
    if (!this.data.groupMemberDraft.length) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Please select members' : '请选择成员', icon: 'none' })
      return
    }
    const groups = this.data.timeGroups.concat({
      id: `group-${Date.now()}`,
      name,
      memberIds: this.data.groupMemberDraft.slice(),
      createdAt: new Date().toISOString()
    })
    wx.setStorageSync(TIME_GROUPS_KEY, groups)
    this.setData({ timeGroups: groups, groupNameDraft: '', groupMemberDraft: [], groupMemberMap: {} })
    wx.showToast({ title: this.data.lang === 'en' ? 'Group saved' : '小组已保存', icon: 'success' })
  },

  deleteTimeGroup(event) {
    const id = event.currentTarget.dataset.id
    const groups = this.data.timeGroups.filter((item) => item.id !== id)
    wx.setStorageSync(TIME_GROUPS_KEY, groups)
    this.setData({ timeGroups: groups })
  },

  openTimeGroup(event) {
    const group = this.data.timeGroups.find((item) => item.id === event.currentTarget.dataset.id)
    if (!group) return
    wx.navigateTo({ url: `/packages/schedule/pages/match/match?friendIds=${group.memberIds.join(',')}` })
  },

  showFriendActions(event) {
    const dataset = event.currentTarget.dataset
    wx.showActionSheet({
      itemList: this.data.lang === 'en' ? ['Hide contact', 'Stop schedule sharing'] : ['隐藏联系人', '停止日程共享'],
      success: (result) => {
        if (result.tapIndex === 0) {
          this.hideFriend({ currentTarget: { dataset } })
        } else if (result.tapIndex === 1) {
          this.removeFriend({ currentTarget: { dataset } })
        }
      }
    })
  },

  // ==================== 共享邀请 ====================
  showRequests() {
    this.setData({ friendsView: 'requests' })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  accept(event) {
    const requestId = event.currentTarget.dataset.id
    const lang = this.data.lang
    // 接受前选择自己授予对方的权限（默认仅忙闲状态）
    const options = permissionOptions(lang)
    wx.showActionSheet({
      itemList: options.map((item) => item.label),
      success: (res) => {
        const chosen = options[res.tapIndex] || options[1]
        if (chosen.value === 'detail') {
          // 共享完整日程：可配置共享时间范围（从哪天到哪天）
          this.openShareRangeModal(requestId)
          return
        }
        this.resolveRequest(requestId, true, chosen.value)
      }
    })
  },

  openShareRangeModal(requestId) {
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    this.setData({
      shareRangeOpen: true,
      shareRangeRequestId: requestId,
      shareRangeStart: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      shareRangeEnd: ''
    })
  },

  onShareRangeStart(event) {
    this.setData({ shareRangeStart: event.detail.value })
  },

  onShareRangeEnd(event) {
    this.setData({ shareRangeEnd: event.detail.value })
  },

  closeShareRangeModal() {
    this.setData({ shareRangeOpen: false, shareRangeRequestId: '' })
  },

  confirmShareRange() {
    const { shareRangeRequestId, shareRangeStart, shareRangeEnd } = this.data
    if (shareRangeStart && shareRangeEnd && shareRangeEnd < shareRangeStart) {
      wx.showToast({
        title: this.data.lang === 'en' ? 'End date must be after start date' : '结束日期不能早于开始日期',
        icon: 'none'
      })
      return
    }
    const requestId = shareRangeRequestId
    this.closeShareRangeModal()
    this.resolveRequest(requestId, true, 'detail', { startDate: shareRangeStart, endDate: shareRangeEnd })
  },

  reject(event) {
    this.resolveRequest(event.currentTarget.dataset.id, false)
  },

  async resolveRequest(requestId, accepted, grantLevel, range) {
    try {
      if (accepted) await api.acceptFriendRequest(requestId, grantLevel || 'busy', range)
      else await api.rejectFriendRequest(requestId)
      await this.loadData()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    }
  },

  // ==================== 导航 ====================
  openFriendProfile(event) {
    wx.navigateTo({ url: `/packages/social/pages/friendProfile/friendProfile?friendId=${event.currentTarget.dataset.id}` })
  },

  openGroupAvailability() {
    wx.navigateTo({ url: '/packages/schedule/pages/match/match' })
  },

  noop() {},

  // ==================== 隐藏联系人 ====================
  async hideFriend(e) {
    const friendId = e.currentTarget.dataset.id
    const friendName = e.currentTarget.dataset.name || ''
    if (!friendId) return
    try {
      await api.hideFriend(friendId)
      // 乐观更新：从列表移除，加入隐藏列表
      const hidden = this.data.friends.find((f) => f.friend && f.friend.id === friendId)
      const friends = this.data.friends.filter((f) => f.friend && f.friend.id !== friendId)
      const hiddenFriends = hidden ? [...this.data.hiddenFriends, Object.assign({}, hidden, { hidden: true })] : this.data.hiddenFriends
      this.applyFriends(friends, hiddenFriends, undefined, undefined, undefined)
      wx.showToast({
        title: this.data.lang === 'en'
          ? `${friendName || 'Contact'} hidden. Restore anytime in "Hidden".`
          : `已隐藏${friendName || '联系人'}，可在"已隐藏"中恢复`,
        icon: 'none',
        duration: 3000
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    }
  },

  async unhideFriend(e) {
    const friendId = e.currentTarget.dataset.id
    if (!friendId) return
    try {
      await api.unhideFriend(friendId)
      // 乐观更新：从隐藏列表移除，加入联系人列表
      const restored = this.data.hiddenFriends.find((f) => f.friend && f.friend.id === friendId)
      const hiddenFriends = this.data.hiddenFriends.filter((f) => f.friend && f.friend.id !== friendId)
      const friends = restored
        ? [...this.data.friends, Object.assign({}, restored, { hidden: false })]
        : this.data.friends
      this.applyFriends(friends, hiddenFriends, undefined, undefined, undefined)
      wx.showToast({
        title: this.data.lang === 'en' ? 'Contact restored' : '联系人已恢复',
        icon: 'success'
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    }
  },

  async removeFriend(e) {
    const friendId = e.currentTarget.dataset.id
    if (!friendId) return
    const lang = this.data.lang
    const result = await new Promise((resolve) => {
      wx.showModal({
        title: lang === 'en' ? 'Stop schedule sharing' : '停止日程共享',
        content: lang === 'en'
          ? 'After stopping, neither side can view unauthorized schedules. Past shared free time results are kept.'
          : '停止后，双方将无法继续查看未授权的日程，但历史共同空闲计算结果不会自动删除。',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!result) return
    try {
      await api.removeFriend(friendId)
      // 乐观更新
      const friends = this.data.friends.filter((f) => f.friend && f.friend.id !== friendId)
      this.applyFriends(friends, this.data.hiddenFriends, undefined, undefined, undefined)
      wx.showToast({
        title: lang === 'en' ? 'Schedule sharing stopped' : '已停止日程共享',
        icon: 'success'
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (lang === 'en' ? 'Operation failed' : '操作失败'),
        icon: 'none'
      })
    }
  },

  showHiddenPanel() {
    this.setData({ hiddenPanelOpen: true })
  },

  closeHiddenPanel() {
    this.setData({ hiddenPanelOpen: false })
  },

  /* ===== 新手引导 ===== */
  buildIntroSteps(lang) {
    const isEn = lang === 'en'
    return [
      { selector: '.request-tool', text: isEn ? 'Friend requests & notifications' : '好友申请与提醒通知' },
      { selector: '.free-time-card', fallbackSelector: '.section-card', text: isEn ? 'Shared free time calculator' : '共同空闲时间计算' }
    ]
  },
  checkIntroGuide() {
    if (this.data.isGuest) return
    if (wx.getStorageSync('introGuideFinished') || wx.getStorageSync('introGuideFriendsDone')) return
    if (this.data.introGuideVisible) return
    this.setData({ introGuideVisible: true, introSteps: this.buildIntroSteps(this.data.lang) })
  },
  onIntroComplete() { this.setData({ introGuideVisible: false, introSteps: [] }) },
  onIntroExit() { this.setData({ introGuideVisible: false, introSteps: [] }) },
  onIntroGotoProfile() { this.setData({ introGuideVisible: false, introSteps: [] }) }
})
