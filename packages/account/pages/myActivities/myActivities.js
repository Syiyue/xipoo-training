const api = require('../../../../utils/api')
const { dictionaries } = require('../../../../utils/i18n')

Page({
  data: { registrations: [], lang: 'zh', t: {} },
  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]) })
    wx.setNavigationBarTitle({ title: '我的活动' })
    this.loadData()
  },
  async loadData() {
    try {
      const registrations = await api.getActivityRegistrations()
      this.setData({ registrations })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  cancelRegistration(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消报名',
      content: '确定取消此活动报名？',
      success: async (res) => {
        if (res.confirm) {
          await api.cancelActivityRegistration(id)
          this.loadData()
          wx.showToast({ title: '已取消', icon: 'success' })
        }
      }
    })
  },
  openActivity(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/packages/activity/pages/activityDetail/activityDetail?id=' + id })
  }
})
