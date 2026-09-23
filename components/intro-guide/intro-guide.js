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
    lang: {
      type: String,
      value: 'zh'
    },
    themePrimary: {
      type: String,
      value: '#61b673'
    },
    darkMode: {
      type: Boolean,
      value: false
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
    bubbleTop: 0,
    bubbleLeft: 0,
    bubbleArrowDir: 'down', // up | down
    bubbleArrowLeft: '50%',
    bubbleVisible: false,
    animating: false,
    showCompletion: false,
    completionTitle: '',
    completionBody: '',
    completionBtnPrimary: '',
    completionBtnSecondary: ''
  },

  observers: {
    'visible'(val) {
      if (val) {
        this.setData({
          currentStep: 0,
          holeReady: false,
          bubbleVisible: false,
          showCompletion: false
        })
        setTimeout(() => this.locateCurrentStep(), 400)
      }
    }
  },

  methods: {
    /** 定位当前步骤的目标元素并计算挖洞 + 气泡位置 */
    async locateCurrentStep() {
      const steps = this.properties.steps
      const idx = this.data.currentStep
      if (idx >= steps.length) return

      const step = steps[idx]
      // 通知父页面当前步骤（可用于执行自定义逻辑，如切换视图）
      this.triggerEvent('stepenter', { index: idx, step })
      // 最后一步：完成弹窗（无高亮）
      if (step.isCompletion) {
        this.setData({ holeReady: true, bubbleVisible: false, showCompletion: true })
        return
      }

      const selector = step.selector
      if (!selector) {
        this.setData({ holeReady: true, bubbleVisible: true, showCompletion: false })
        return
      }

      try {
        const rect = await this.queryRect(selector)
        if (!rect || rect.width === 0) {
          if (step.fallbackSelector) {
            const fr = await this.queryRect(step.fallbackSelector)
            if (fr && fr.width > 0) {
              this.showHoleAndBubble(fr)
              return
            }
          }
          this.setData({ holeReady: true, bubbleVisible: true, showCompletion: false })
          return
        }

        await this.scrollToVisible(rect)
        // 滚动后重新查询位置
        const rerect = await this.queryRect(selector)
        const rr = rerect && rerect.width > 0 ? rerect : rect
        this.showHoleAndBubble(rr)
      } catch (e) {
        console.error('[intro-guide] locate failed', e)
        this.setData({ holeReady: true, bubbleVisible: true, showCompletion: false })
      }
    },

    /** 查询元素位置 */
    queryRect(selector) {
      return new Promise((resolve) => {
        const q = wx.createSelectorQuery()
        q.select(selector).boundingClientRect((res) => {
          resolve(res || null)
        }).exec()
      })
    },

    /** 计算挖洞 + 气泡位置 */
    showHoleAndBubble(rect) {
      const sysInfo = wx.getSystemInfoSync()
      const viewH = sysInfo.windowHeight
      const pad = 10 // 挖洞 padding

      const holeTop = rect.top - pad
      const holeLeft = rect.left - pad
      const holeWidth = rect.width + pad * 2
      const holeHeight = rect.height + pad * 2
      const holeCenterX = holeLeft + holeWidth / 2
      const holeBottom = holeTop + holeHeight

      // 气泡尺寸估算
      const bubbleW = Math.min(560, sysInfo.windowWidth - 40)
      const bubbleH = 200 // rpx，需近似转 px
      const bubbleHPx = bubbleH * (sysInfo.windowWidth / 750)

      // 默认气泡在上方
      let arrowDir = 'down' // 箭头指向下方（气泡在上方）
      let bubbleTop = holeTop - bubbleHPx - 16
      let arrowLeft = Math.max(20, Math.min(holeCenterX - holeLeft, bubbleW - 20))

      // 如果上方空间不足，放下方
      if (bubbleTop < (sysInfo.statusBarHeight || 20) + 10) {
        arrowDir = 'up' // 箭头指向上方（气泡在下方）
        bubbleTop = holeBottom + 16
        arrowLeft = Math.max(20, Math.min(holeCenterX - holeLeft, bubbleW - 20))
      }

      const bubbleLeft = Math.max(10, Math.min(holeCenterX - bubbleW / 2, sysInfo.windowWidth - bubbleW - 10))

      this.setData({
        holeTop,
        holeLeft,
        holeWidth,
        holeHeight,
        bubbleTop,
        bubbleLeft,
        bubbleArrowDir: arrowDir,
        bubbleArrowLeft: Math.round(arrowLeft) + 'rpx',
        holeReady: true,
        bubbleVisible: true,
        showCompletion: false
      })
    },

    /** 自动滚动保证目标可见 */
    async scrollToVisible(rect) {
      const sysInfo = wx.getSystemInfoSync()
      const viewH = sysInfo.windowHeight
      const statusH = sysInfo.statusBarHeight || 0
      const bubbleH = 240 // 气泡预估高度

      const visibleTop = statusH + 20
      const visibleBottom = viewH - bubbleH - 20

      if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return

      const centerY = rect.top + rect.height / 2
      const targetCenter = visibleTop + (visibleBottom - visibleTop) / 2
      const delta = centerY - targetCenter

      try {
        await new Promise((resolve) => {
          wx.pageScrollTo({
            scrollTop: Math.max(0, (this._anchorScroll || 0) + delta),
            duration: 250,
            success: resolve,
            fail: resolve
          })
        })
        this._anchorScroll = (this._anchorScroll || 0) + delta
        await new Promise(r => setTimeout(r, 350))
      } catch (e) { /* 非关键 */ }
    },

    /** 下一步 */
    onNext() {
      if (this.data.animating) return
      this.data.animating = true

      const next = this.data.currentStep + 1
      const steps = this.properties.steps

      if (next >= steps.length) {
        this.markFinished()
        this.triggerEvent('complete')
        this.data.animating = false
        return
      }

      const step = steps[next]
      // 如果是完成弹窗步骤
      if (step && step.isCompletion) {
        this.setData({
          currentStep: next,
          holeReady: true,
          bubbleVisible: false,
          showCompletion: true
        })
        this.data.animating = false
        return
      }

      this.setData({
        currentStep: next,
        holeReady: false,
        bubbleVisible: false,
        showCompletion: false
      })

      setTimeout(() => {
        this.locateCurrentStep()
      }, 320)

      setTimeout(() => {
        this.data.animating = false
      }, 400)
    },

    /** 收尾弹窗 — 去完善资料 */
    onCompletionPrimary() {
      this.markFinished()
      this.triggerEvent('gotoProfile')
    },

    /** 收尾弹窗 — 先逛逛 */
    onCompletionSecondary() {
      this.markFinished()
      this.triggerEvent('complete')
    },

    /** 点击遮罩退出 */
    onMaskTap() {
      const t = this._texts()
      wx.showModal({
        title: t.exitTitle,
        content: t.exitContent,
        confirmText: t.exitConfirm,
        cancelText: t.exitCancel,
        success: (res) => {
          if (res.confirm) {
            this.markFinished()
            this.triggerEvent('exit')
          }
        }
      })
    },

    /** 标记引导已完成（按 storageKey 写入，无 key 时写全局标记） */
    markFinished() {
      const key = this.properties.storageKey || 'introGuideFinished'
      wx.setStorageSync(key, true)
      // 如果是分页引导，同时检查是否所有页都完成了
      this._checkAllDone()
    },

    /** 检查所有分页是否都完成，是则写全局 finished */
    _checkAllDone() {
      const allKeys = ['introGuideScheduleDone', 'introGuideActivitiesDone', 'introGuideFriendsDone']
      const allDone = allKeys.every(k => wx.getStorageSync(k))
      if (allDone) {
        wx.setStorageSync('introGuideFinished', true)
      }
    },

    /** 当前语言的文案 */
    _texts() {
      const lang = this.properties.lang || 'zh'
      return lang === 'en'
        ? {
            exitTitle: 'Exit guide?',
            exitContent: 'You can re-enable it anytime in settings.',
            exitConfirm: 'Exit',
            exitCancel: 'Continue'
          }
        : {
            exitTitle: '退出新手引导？',
            exitContent: '退出后本次不再展示，可随时在设置中重新开启',
            exitConfirm: '退出',
            exitCancel: '继续'
          }
    },

    noop() {}
  }
})