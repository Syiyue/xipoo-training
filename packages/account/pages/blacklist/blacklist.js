const { dictionaries } = require('../../../../utils/i18n')

Page({
  data: { blacklist: [], lang: 'zh', t: {} },
  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]) })
    wx.setNavigationBarTitle({ title: dictionaries[lang].blacklist || '黑名单管理' })
    this.loadData()
  },
  async loadData() {
    try {
      this.setData({ blacklist: [] }) // 后续对接真实接口
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },
  removeBlacklist(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ blacklist: this.data.blacklist.filter(b => b.id !== id) })
    wx.showToast({ title: '已移除', icon: 'success' })
  }
})
