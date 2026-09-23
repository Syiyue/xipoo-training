const api = require('../../../../utils/api')
const { dictionaries } = require('../../../../utils/i18n')

Page({
  data: {
    friends: [],
    lang: 'zh',
    t: {}
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const mergedT = Object.assign({}, dictionaries[lang])
    this.setData({ lang, t: mergedT })
    wx.setNavigationBarTitle({ title: mergedT.myFriends || '日程联系人' })
    this.loadData()
  },

  async loadData() {
    try {
      const friendships = await api.getFriendships()
      const friends = Array.isArray(friendships)
        ? friendships
        : (friendships && Array.isArray(friendships.friends) ? friendships.friends : [])
      this.setData({ friends })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  goFriendSchedule(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/packages/schedule/pages/friendSchedule/friendSchedule?id=' + id })
  },

  goRemoveFriend(e) {
    const user = e.currentTarget.dataset.user
    wx.showModal({
      title: '停止日程共享',
      content: `确定停止与 ${user.name} 的日程共享？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.removeFriend(user.id)
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadData()
          } catch (e) {
            wx.showToast({ title: e.message || '删除失败', icon: 'none' })
          }
        }
      }
    })
  }
})
