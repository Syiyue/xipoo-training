// iOS 日历导入的明确兜底页。
// 小程序不能可靠地自动打开 Safari，因此本页只提供可验证的复制链接操作。
Page({
  data: { icsUrl: '', lang: 'zh' },

  onLoad(options) {
    const app = getApp()
    const lang = (app && app.getLanguage) ? app.getLanguage() : 'zh'
    const icsUrl = options && options.icsUrl ? decodeURIComponent(options.icsUrl) : ''
    this.setData({ icsUrl, lang })
  },

  copyUrlToClipboard() {
    const url = this.data.icsUrl
    if (!url) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Invalid link' : '链接无效，请重新导出', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: this.data.lang === 'en' ? 'Open Safari' : '下一步：打开 Safari',
          content: this.data.lang === 'en'
            ? 'Open Safari manually, paste the copied link in the address bar, then choose Add All in Calendar.'
            : '请手动打开 Safari，在地址栏粘贴刚复制的链接并访问。出现日历导入页后，点击「全部添加」。',
          showCancel: false,
          confirmText: this.data.lang === 'en' ? 'Got it' : '知道了'
        })
      },
      fail: () => wx.showToast({ title: this.data.lang === 'en' ? 'Copy failed' : '复制失败，请重试', icon: 'none' })
    })
  }
})
