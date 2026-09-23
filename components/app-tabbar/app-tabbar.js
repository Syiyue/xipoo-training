const { dictionaries } = require('../../utils/i18n')

Component({
  properties: {
    active: {
      type: String,
      value: 'schedule'
    }
  },

  data: {
    items: []
  },

  lifetimes: {
    attached() {
      this.refresh()
    }
  },

  pageLifetimes: {
    show() {
      // 仅在语言变化时才刷新 items，避免每次切换都重新 setData
      const app = getApp()
      const lang = app.getLanguage ? app.getLanguage() : 'zh'
      if (this._lastLang !== lang) {
        this._lastLang = lang
        this.refresh()
      }
    }
  },

  methods: {
    refresh() {
      const app = getApp()
      const lang = app.getLanguage ? app.getLanguage() : 'zh'
      this._lastLang = lang
      const dict = dictionaries[lang] || dictionaries.zh
      this.setData({
        items: [
          { key: 'schedule', label: dict.tabSchedule, icon: '/assets/figma/tab-schedule.png', url: '/pages/schedule/schedule' },
          { key: 'activities', label: dict.tabActivities, icon: '/assets/figma/tab-activities.png', url: '/pages/activities/activities' },
          { key: 'friends', label: dict.tabFriends, icon: '/assets/figma/tab-friends.png', url: '/pages/friends/friends' },
          { key: 'profile', label: dict.tabProfile, icon: '/assets/figma/tab-profile.png', url: '/pages/profile/profile' }
        ]
      })
    },

    navigate(event) {
      const url = event.currentTarget.dataset.url
      if (url) wx.switchTab({ url })
    }
  }
})
