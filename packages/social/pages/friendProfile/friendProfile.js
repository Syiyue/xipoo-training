const api = require('../../../../utils/api')

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

Page({
  data: {
    friendId: '',
    profile: null,
    loading: true,
    lang: 'zh',
    editingNote: false,
    noteDraft: '',
    permissionOptions: [],
    friendPermLabel: '',
    // 本地编辑中的“对方可以查看我的内容”设置
    settings: { level: 'busy', showLocation: false, allowFreeTimeCalc: true, startDate: '', endDate: '' },
    settingsDirty: false,
    saving: false
  },

  onLoad(options) {
    this.setData({ friendId: options.friendId || '' })
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, permissionOptions: permissionOptions(lang) }, () => {
      wx.setNavigationBarTitle({ title: lang === 'en' ? 'Share settings' : '共享设置' })
      if (this._lastLoadAt && Date.now() - this._lastLoadAt < 30000) return
      this.loadProfile()
    })
  },

  async loadProfile() {
    try {
      const profile = await api.getFriendProfile(this.data.friendId)
      const myPermission = profile.myPermission || { level: profile.myScheduleShared ? 'busy' : 'none' }
      const friendPermission = profile.friendPermission || { level: profile.friendScheduleShared ? 'busy' : 'none' }
      this.setData({
        profile,
        loading: false,
        friendPermLabel: permLabel(friendPermission.level, this.data.lang),
        settings: {
          level: myPermission.level || 'none',
          showLocation: Boolean(myPermission.showLocation),
          allowFreeTimeCalc: myPermission.allowFreeTimeCalc !== false,
          startDate: myPermission.startDate || '',
          endDate: myPermission.endDate || ''
        },
        settingsDirty: false
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load' : '共享设置加载失败'),
        icon: 'none'
      })
    }
  },

  // ==================== 区域二：对方可以查看我的内容 ====================
  selectLevel(event) {
    this.setData({
      'settings.level': event.currentTarget.dataset.value,
      settingsDirty: true
    })
  },

  toggleShowLocation(event) {
    this.setData({ 'settings.showLocation': event.detail.value, settingsDirty: true })
  },

  toggleAllowFreeTimeCalc(event) {
    this.setData({ 'settings.allowFreeTimeCalc': event.detail.value, settingsDirty: true })
  },

  onStartDate(event) {
    this.setData({ 'settings.startDate': event.detail.value, settingsDirty: true })
  },

  onEndDate(event) {
    this.setData({ 'settings.endDate': event.detail.value, settingsDirty: true })
  },

  async saveSettings() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      // 权限修改必须写入服务端，不能只做前端隐藏
      const saved = await api.setSharePermission(this.data.friendId, this.data.settings)
      this.setData({
        'profile.myPermission': saved,
        settingsDirty: false
      })
      wx.showToast({
        title: this.data.lang === 'en' ? 'Permissions saved' : '权限已保存',
        icon: 'success'
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Save failed' : '保存失败'),
        icon: 'none'
      })
    } finally {
      this.setData({ saving: false })
    }
  },

  // ==================== 区域一：我可以查看的内容 ====================
  openSchedule() {
    const permission = (this.data.profile && this.data.profile.friendPermission) || { level: 'none' }
    if (permission.level === 'none') {
      wx.showToast({
        title: this.data.lang === 'en' ? 'They have not shared their schedule with you.' : '对方暂未向你共享日程',
        icon: 'none'
      })
      return
    }
    wx.navigateTo({ url: `/packages/schedule/pages/friendSchedule/friendSchedule?friendId=${this.data.friendId}` })
  },

  openCommonCourses() {
    const friendId = this.data.friendId
    wx.navigateTo({ url: `/packages/schedule/pages/friendSchedule/friendSchedule?friendId=${friendId}&commonOnly=1` })
  },

  removeFriend() {
    const lang = this.data.lang
    wx.showModal({
      title: lang === 'en' ? 'Stop schedule sharing' : '停止日程共享',
      content: lang === 'en'
        ? 'After stopping, neither side can view unauthorized schedules. Past shared free time results are kept.'
        : '停止后，双方将无法继续查看未授权的日程，但历史共同空闲计算结果不会自动删除。',
      confirmColor: '#D94B4B',
      success: async (res) => {
        if (!res.confirm) return
        await api.removeFriend(this.data.friendId)
        wx.navigateBack()
      }
    })
  },

  previewPhoto(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.profile.showcaseImages || []
    wx.previewImage({ current: images[index], urls: images })
  },

  noop() {},

  // ========== 联系人备注 ==========
  startEditNote() {
    this.setData({
      editingNote: true,
      noteDraft: (this.data.profile && this.data.profile.note) || ''
    })
  },

  onNoteInput(e) {
    this.setData({ noteDraft: e.detail.value })
  },

  async saveNote() {
    const note = (this.data.noteDraft || '').trim()
    this.setData({ editingNote: false })
    try {
      const result = await api.setFriendNote(this.data.friendId, note)
      // 本地更新 profile 中的 note 字段
      this.setData({ 'profile.note': (result && result.note) || note })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  reportUser() {
    const lang = this.data.lang
    const userId = this.data.friendId
    const itemList = lang === 'en'
      ? ['Report Nickname', 'Report Avatar', 'Report Behavior']
      : ['举报违规昵称', '举报违规头像', '举报用户行为']
    const typeMap = ['nickname_report', 'avatar_report', 'behavior_report']
    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const type = typeMap[res.tapIndex]
        const reason = itemList[res.tapIndex]
        try {
          await api.reportUser(userId, { type, reason })
          wx.showToast({
            title: lang === 'en' ? 'Report submitted' : '举报已提交',
            icon: 'success'
          })
        } catch (e) {
          wx.showToast({ title: e.message || (lang === 'en' ? 'Failed' : '举报失败'), icon: 'none' })
        }
      }
    })
  }
})
