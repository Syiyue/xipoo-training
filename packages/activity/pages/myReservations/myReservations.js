const api = require('../../../../utils/api')

// 自研预约（模块 3）：我的预约列表
Page({
  data: {
    lang: 'zh',
    loading: true,
    list: []
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({
      title: lang === 'en' ? 'My reservations' : '我的预约'
    })
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const res = await api.getMyReservations()
      const isEn = this.data.lang === 'en'
      const list = ((res && res.list) || []).map((order) => Object.assign({}, order, {
        displayTitle: isEn
          ? (order.activityTitleEn || order.activityTitle || '')
          : (order.activityTitle || order.activityTitleEn || ''),
        statusText: order.status === 'booked'
          ? (isEn ? 'Booked' : '已预约')
          : (isEn ? 'Cancelled' : '已取消'),
        verifyText: order.verifyStatus === 'verified'
          ? (isEn ? 'Verified' : '已核销')
          : (isEn ? 'Not verified' : '待核销'),
        createdAtText: formatDateTime(order.createdAt)
      }))
      this.setData({ loading: false, list })
    } catch (error) {
      this.setData({ loading: false, list: [] })
      wx.showToast({
        title: error.message || (this.data.lang === 'en' ? 'Failed to load' : '加载失败'),
        icon: 'none'
      })
    }
  },

  cancelOrder(event) {
    const id = event.currentTarget.dataset.id
    const order = (this.data.list || []).find((item) => item.id === id)
    if (!order || order.status !== 'booked') return
    const isEn = this.data.lang === 'en'
    wx.showModal({
      title: isEn ? 'Cancel reservation' : '取消预约',
      content: isEn
        ? `Cancel the booking for "${order.displayTitle}"?`
        : `确定取消「${order.displayTitle}」的预约吗？名额将被释放。`,
      confirmText: isEn ? 'Confirm' : '确定',
      cancelText: isEn ? 'Keep' : '再想想',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.cancelReservation(id)
          wx.showToast({ title: isEn ? 'Cancelled' : '已取消预约', icon: 'success' })
          this.loadData()
        } catch (error) {
          wx.showToast({
            title: error.message || (isEn ? 'Cancel failed' : '取消失败'),
            icon: 'none'
          })
        }
      }
    })
  },

  noop() {}
})

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (v) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
