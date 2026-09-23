const api = require('../../../../utils/api')

const TYPE_LABELS = {
  zh: {
    interest_accepted: '接受了你的搭子请求',
    interest_matched: '和你双向匹配了',
    interest_ignored: '忽略了你的搭子请求',
    post_applied: '申请加入',
    post_accepted: '已同意你加入',
    post_rejected: '拒绝了你的申请',
    post_full: '已满员',
    unmatched: '已解除搭子关系'
  },
  en: {
    interest_accepted: 'accepted your buddy request',
    interest_matched: 'matched with you',
    interest_ignored: 'declined your buddy request',
    post_applied: 'applied to join',
    post_accepted: 'approved your application',
    post_rejected: 'rejected your application',
    post_full: 'is now full',
    unmatched: 'unmatched with you'
  }
}

Page({
  data: {
    lang: 'zh',
    notifications: [],
    loading: true
  },

  onLoad(options) {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Messages' : '消息中心' })
    this.loadNotifications()
    // 进入页面即标记已读
    api.markNotificationsRead().catch(() => {})
  },

  onShow() {
    const app = getApp()
    if (app.requireLogin && !app.requireLogin()) return
  },

  async loadNotifications() {
    this.setData({ loading: true })
    try {
      const notifications = await api.listNotifications()
      const lang = this.data.lang
      const labels = TYPE_LABELS[lang] || TYPE_LABELS.zh
      const grouped = this.groupNotifications(notifications, labels)
      this.setData({ notifications: grouped, loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  groupNotifications(raw, labels) {
    const grouped = []
    const map = {}
    const now = Date.now()

    raw.forEach((n) => {
      const key = n.type + '_' + (n.postId || '') + '_' + (n.fromUserId || '')
      if (map[key]) {
        map[key].count += 1
        map[key].items.push(n)
        if (n.createdAt && (!map[key].latest || n.createdAt > map[key].latest)) {
          map[key].latest = n.createdAt
        }
        return
      }
      const label = labels[n.type] || n.type
      const timeStr = n.createdAt ? this.formatTime(n.createdAt) : ''
      const entry = {
        id: n.type + '_' + (n.postId || n.fromUserId || ''),
        type: n.type,
        fromUserName: n.fromUserName || '',
        postTitle: n.postTitle || '',
        buddyType: n.buddyType || '',
        postId: n.postId || '',
        count: 1,
        items: [n],
        label,
        timeStr,
        latest: n.createdAt || '',
        read: n.read
      }
      map[key] = entry
      grouped.push(entry)
    })

    // 按时间倒序
    grouped.sort((a, b) => String(b.latest || '').localeCompare(String(a.latest || '')))
    return grouped
  },

  formatTime(iso) {
    try {
      const d = new Date(iso)
      const now = new Date()
      const diff = now - d
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
      const month = d.getMonth() + 1
      const day = d.getDate()
      return month + '/' + day
    } catch (e) { return '' }
  },

  onNotificationTap(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    if (item.postId) {
      wx.navigateTo({ url: `/packages/social/pages/buddySquare/buddySquare?postId=${encodeURIComponent(item.postId)}` })
    }
  },

  onPullDownRefresh() {
    this.loadNotifications().then(() => wx.stopPullDownRefresh())
  }
})
