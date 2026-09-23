Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    steps: {
      type: Array,
      value: []
    },
    storageKey: {
      type: String,
      value: ''
    }
  },

  data: {
    currentStep: 0,
    holeTop: 0,
    holeLeft: 0,
    holeWidth: 0,
    holeHeight: 0,
    holeReady: false,
    animating: false,
    sheetClass: '',
    renderSteps: []
  },

  observers: {
    'steps'(steps) {
      const renderSteps = (steps || []).map((step, index) => Object.assign({}, step, { _guideKey: index }))
      this.setData({ renderSteps })
    },
    'visible'(val) {
      if (val) {
        this.setData({ currentStep: 0, holeReady: false, sheetClass: 'sheet-enter' })
        setTimeout(() => this.locateCurrentStep(), 400)
      }
    }
  },

  methods: {
    markSeen() {
      if (this.properties.storageKey) {
        wx.setStorageSync(this.properties.storageKey, true)
      }
    },

    async locateCurrentStep() {
      const steps = this.properties.steps
      const idx = this.data.currentStep
      if (idx >= steps.length) return

      const step = steps[idx]
      // 最后一步（完成）无高亮目标
      if (idx === steps.length - 1) {
        this.setData({ holeReady: true })
        return
      }

      const selector = step.selector
      if (!selector) {
        this.setData({ holeReady: true })
        return
      }

      try {
        // 使用全局 query 查询页面级元素
        const q = wx.createSelectorQuery()
        const node = q.select(selector)
        if (!node) {
          this.setData({ holeReady: true })
          return
        }

        const rect = await new Promise((resolve) => {
          node.boundingClientRect(resolve).exec()
        })

        const r = (rect && rect[0]) || null
        if (!r || r.width === 0) {
          if (step.fallbackSelector) {
            const fb = await new Promise((res) => {
              wx.createSelectorQuery().select(step.fallbackSelector).boundingClientRect(res).exec()
            })
            const fr = (fb && fb[0]) || null
            if (fr && fr.width > 0) {
              this.showHole(fr)
              return
            }
          }
          this.setData({ holeReady: true })
          return
        }

        await this.scrollToVisible(r)
        const rerect = await new Promise((resolve) => {
          wx.createSelectorQuery().select(selector).boundingClientRect(resolve).exec()
        })
        const rr = (rerect && rerect[0]) || r
        this.showHole(rr)

      } catch (e) {
        console.error('[guide-overlay] locate failed', e)
        this.setData({ holeReady: true })
      }
    },

    showHole(rect) {
      const pad = 8
      this.setData({
        holeTop: rect.top - pad,
        holeLeft: rect.left - pad,
        holeWidth: rect.width + pad * 2,
        holeHeight: rect.height + pad * 2,
        holeReady: true
      })
    },

    async scrollToVisible(rect) {
      const sysInfo = wx.getSystemInfoSync()
      const viewH = sysInfo.windowHeight
      const statusH = sysInfo.statusBarHeight || 0
      const sheetH = 280 // 估算浮窗高度

      const visibleTop = statusH + 20
      const visibleBottom = viewH - sheetH - 20

      if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return

      // 计算需要的滚动量
      const centerY = rect.top + rect.height / 2
      const targetCenter = visibleTop + (visibleBottom - visibleTop) / 2
      const delta = centerY - targetCenter

      try {
        await new Promise((resolve) => {
          wx.pageScrollTo({ scrollTop: Math.max(0, (wx.getStorageSync('_guide_scroll') || 0) + delta), duration: 250, success: resolve, fail: resolve })
        })
        await new Promise(r => setTimeout(r, 300))
      } catch (e) { /* 非关键 */ }
    },

    onNext() {
      if (this.data.animating) return
      this.data.animating = true

      const next = this.data.currentStep + 1
      const steps = this.properties.steps

      if (next >= steps.length) {
        this.markSeen()
        this.triggerEvent('complete')
        this.data.animating = false
        return
      }

      this.setData({ currentStep: next, holeReady: false, sheetClass: '' })
      setTimeout(() => {
        this.setData({ sheetClass: 'sheet-enter' })
        this.locateCurrentStep()
      }, 320)

      setTimeout(() => {
        this.data.animating = false
      }, 350)
    },

    onMaskTap() {
      wx.showModal({
        title: '确定退出引导？',
        content: '可随时在设置中重新开启',
        confirmText: '退出',
        cancelText: '继续',
        success: (res) => {
          if (res.confirm) {
            this.markSeen()
            this.triggerEvent('exit')
          }
        }
      })
    },

    noop() {}
  }
})
