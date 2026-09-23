const api = require('../../../../utils/api')

// 自研预约（模块 3）：站内预约页。游客可看规则与时段，提交/取消需要登录。
Page({
  data: {
    activityId: '',
    lang: 'zh',
    loading: true,
    submitting: false,
    cancelling: false,
    title: '',
    rules: '',
    slots: [],
    selectedSlotId: '',
    myOrder: null
  },

  onLoad(options) {
    this.setData({ activityId: (options && (options.activityId || options.id)) || '' })
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({
      title: lang === 'en' ? 'Reservation' : '活动预约'
    })
    this.loadData()
  },

  async loadData() {
    if (!this.data.activityId) {
      this.setData({ loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await api.getReservationSlots(this.data.activityId)
      const isEn = this.data.lang === 'en'
      const slots = (res.slots || []).map((slot) => Object.assign({}, slot, {
        slotText: `${slot.date} ${slot.start}-${slot.end}`,
        full: Number(slot.remaining) <= 0
      }))
      this.setData({
        loading: false,
        title: isEn ? (res.titleEn || res.title) : (res.title || res.titleEn),
        rules: isEn ? (res.rulesEn || res.rules || '') : (res.rules || ''),
        slots,
        myOrder: res.myOrder || null,
        selectedSlotId: ''
      })
    } catch (error) {
      this.setData({ loading: false, slots: [], myOrder: null })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load' : '加载失败'),
        icon: 'none'
      })
    }
  },

  selectSlot(event) {
    const id = event.currentTarget.dataset.id
    const slot = (this.data.slots || []).find((item) => item.id === id)
    if (!slot || slot.full) return
    this.setData({ selectedSlotId: id })
  },

  async submit() {
    if (this.data.submitting || this.data.myOrder) return
    const isEn = this.data.lang === 'en'
    if (!this.data.selectedSlotId) {
      wx.showToast({ title: isEn ? 'Please select a time slot' : '请先选择预约时段', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.submitReservation(this.data.activityId, this.data.selectedSlotId)
      wx.showToast({ title: isEn ? 'Booked' : '预约成功', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({ url: '/packages/activity/pages/myReservations/myReservations' })
      }, 600)
    } catch (error) {
      this.setData({ submitting: false })
      wx.showToast({
        title: error.message || (isEn ? 'Booking failed' : '预约失败'),
        icon: 'none'
      })
      // 名额/一人一单等状态可能已变化，刷新一次
      this.loadData()
    }
  },

  cancelMyOrder() {
    if (this.data.cancelling || !this.data.myOrder) return
    const isEn = this.data.lang === 'en'
    wx.showModal({
      title: isEn ? 'Cancel reservation' : '取消预约',
      content: isEn ? 'Cancel this booking? The slot will be released.' : '确定取消当前预约吗？名额将被释放。',
      confirmText: isEn ? 'Confirm' : '确定',
      cancelText: isEn ? 'Keep' : '再想想',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ cancelling: true })
        try {
          await api.cancelReservation(this.data.myOrder.id)
          wx.showToast({ title: isEn ? 'Cancelled' : '已取消预约', icon: 'success' })
          await this.loadData()
        } catch (error) {
          wx.showToast({
            title: error.message || (isEn ? 'Cancel failed' : '取消失败'),
            icon: 'none'
          })
        } finally {
          this.setData({ cancelling: false })
        }
      }
    })
  },

  noop() {}
})
