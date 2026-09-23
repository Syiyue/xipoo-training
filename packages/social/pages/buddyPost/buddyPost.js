const api = require('../../../../utils/api')

Page({
  data: {
    postId: '',
    post: null,
    lang: 'zh'
  },

  onLoad(query) {
    this.setData({ postId: query.postId || '' })
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang }, () => {
      this.loadPost()
    })
  },

  viewProfile(e) {
    const uid = e.currentTarget.dataset.userid
    if (uid) wx.navigateTo({ url: `/packages/social/pages/friendProfile/friendProfile?friendId=${uid}` })
  },

  async loadPost() {
    try {
      const post = await api.getBuddyPost(this.data.postId)
      if (post && post.deadline) {
        post.deadline = post.deadline.substring(0, 16).replace('T', ' ')
      }
      this.setData({ post })
      wx.setNavigationBarTitle({
        title: this.data.lang === 'en' ? 'Team detail' : '组队详情'
      })
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load team detail' : '组队详情加载失败'),
        icon: 'none'
      })
    }
  },

  async apply() {
    try {
      await api.applyBuddyPost(
        this.data.postId,
        {
          message: this.data.lang === 'en'
            ? 'The time and place work for me; I would love to join.'
            : '时间地点合适，希望一起参加。'
        }
      )
      await this.loadPost()
    } catch (error) {
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Application failed' : '申请失败'),
        icon: 'none'
      })
    }
  },

  async resolve(event) {
    const id = event.currentTarget.dataset.id
    if (event.currentTarget.dataset.action === 'accept') await api.acceptBuddyApplication(id)
    else await api.rejectBuddyApplication(id)
    await this.loadPost()
  },

  copyWechat(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.wechat })
  },

  async blockCreator() {
    await api.blockUser(this.data.post.creator.id)
    wx.navigateBack()
  },

  async reportCreator() {
    const lang = this.data.lang
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
          await api.reportUser(this.data.post.creator.id, { type, reason })
          wx.showToast({
            title: lang === 'en' ? 'Report submitted' : '举报已提交',
            icon: 'success'
          })
        } catch (e) {
          wx.showToast({ title: e.message || (lang === 'en' ? 'Failed' : '举报失败'), icon: 'none' })
        }
      }
    })
  },

  cancelPost() {
    wx.showModal({
      title: this.data.lang === 'en' ? 'Cancel request' : '取消需求',
      content: this.data.lang === 'en'
        ? 'All pending applications will become invalid after cancellation.'
        : '取消后所有待审核申请将失效。',
      success: async (res) => {
        if (!res.confirm) return
        await api.deleteBuddyPost(this.data.postId)
        wx.navigateBack()
      }
    })
  },

  leavePost() {
    wx.showModal({
      title: this.data.lang === 'en' ? 'Leave group' : '退出小组',
      content: this.data.lang === 'en'
        ? 'You will no longer be able to view group contact details after leaving.'
        : '退出后将无法查看组内联系方式。',
      success: async (res) => {
        if (!res.confirm) return
        await api.leaveBuddyPost(this.data.postId)
        await this.loadPost()
      }
    })
  }
})
