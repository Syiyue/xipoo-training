Component({
  properties: {
    visible: { type: Boolean, value: false },
    request: { type: Object, value: {} }
  },

  data: {
    showContent: false,
    animating: false
  },

  observers: {
    'visible, request'(visible, request) {
      if (visible && request && request.fromUser) this.show()
    }
  },

  methods: {
    show() {
      if (this.data.animating) return
      this.setData({ animating: true, showContent: true })
      const a = wx.createAnimation({ duration: 400, timingFunction: 'ease-out' })
      a.translateY(0).step()
      this.setData({ slideAnimation: a.export() })
      this._hideTimer = setTimeout(() => this.hide(), 3000)
    },

    hide() {
      const a = wx.createAnimation({ duration: 300, timingFunction: 'ease-in' })
      a.translateY(-200).step()
      this.setData({ slideAnimation: a.export() })
      setTimeout(() => {
        this.setData({ animating: false, showContent: false })
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.isBannerVisible = false
          app.globalData.latestRequest = null
        }
        // 通知当前页面清除 bannerRequest（否则下次 onShow 注入残留值会误触发 observer）
        const pages = getCurrentPages()
        pages.forEach(p => { try { p.setData({ bannerVisible: false, bannerRequest: {} }) } catch (_) {} })
      }, 300)
      if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null }
    },

    onTap() {
      this.hide()
      wx.switchTab({ url: '/pages/friends/friends' })
      setTimeout(() => {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && page.showRequests) page.showRequests()
      }, 300)
    }
  }
})
