const store = require('../../../../utils/store')

const ITEMS = [
  { key: 'gender', label: '性别', labelEn: 'Gender' },
  { key: 'grade', label: '年级', labelEn: 'Year' },
  { key: 'major', label: '专业', labelEn: 'Major' },
  { key: 'school', label: '学校', labelEn: 'School' },
  { key: 'bio', label: '个人介绍', labelEn: 'Bio' },
  { key: 'tags', label: '兴趣标签', labelEn: 'Tags' }
]

Page({
  data: {
    items: [],
    lang: 'zh'
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Privacy Settings' : '隐私设置' })
    store.fetchAndSetUserInfo().then(() => {
      const user = store.getUserInfo() || {}
      const settings = Object.assign(
        { gender: true, grade: true, major: true, school: true, bio: true, tags: true },
        user.privacySettings || {}
      )
      const items = ITEMS.map((item) => ({
        ...item,
        enabled: Boolean(settings[item.key])
      }))
      this.setData({ items })
    })
  },

  async onSwitch(e) {
    const key = e.currentTarget.dataset.key
    const enabled = e.detail.value
    const items = this.data.items.map((item) =>
      item.key === key ? { ...item, enabled } : item
    )
    this.setData({ items })
    try {
      const privacySettings = {}
      items.forEach((item) => { privacySettings[item.key] = item.enabled })
      await store.updateUserInfo({ privacySettings })
    } catch (_) {
      const itemsRollback = this.data.items.map((item) =>
        item.key === key ? { ...item, enabled: !enabled } : item
      )
      this.setData({ items: itemsRollback })
    }
  }
})