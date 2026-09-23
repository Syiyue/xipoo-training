const { dictionaries } = require('../../../../utils/i18n')
Page({
  data: { lang: 'zh', t: {} },
  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]) })
    wx.setNavigationBarTitle({ title: dictionaries[lang].contactUs || '联系我们' })
  },

  copyEmail() {
    const email = this.data.t.contactEmail || '268182534@139.com'
    wx.setClipboardData({
      data: email,
      success: () => wx.showToast({ title: this.data.lang === 'zh' ? '邮箱已复制' : 'Email copied', icon: 'none' })
    })
  }
})
