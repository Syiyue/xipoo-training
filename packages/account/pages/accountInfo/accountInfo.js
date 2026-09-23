const api = require('../../../../utils/api')
const { dictionaries } = require('../../../../utils/i18n')

Page({
  data: { user: null, lang: 'zh', t: {} },
  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]) })
    wx.setNavigationBarTitle({ title: dictionaries[lang].accountInfo || '账户信息' })
    this.loadData()
  },
  async loadData() {
    try { this.setData({ user: await api.me() }) }
    catch (e) { wx.showToast({ title: e.message || '加载失败', icon: 'none' }) }
  }
})
