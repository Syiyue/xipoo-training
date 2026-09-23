const api = require('../../utils/api')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    postType: {
      type: String,
      value: 'general'
    },
    courseId: {
      type: String,
      value: ''
    },
    courseName: {
      type: String,
      value: ''
    },
    lang: {
      type: String,
      value: 'zh'
    }
  },

  data: {
    title: '',
    description: '',
    maxMembers: '',
    genderFilter: 'any',
    genderIndex: 0,
    deadlineDate: '',
    deadlineTime: '',
    place: '',
    submitting: false,
    genderOptions: []
  },

  lifetimes: {
    attached() {
      this.setData({
        genderOptions: [
          this.properties.lang === 'en' ? 'Anyone' : '不限',
          this.properties.lang === 'en' ? 'Male only' : '仅男生',
          this.properties.lang === 'en' ? 'Female only' : '仅女生'
        ]
      })
      this.reset()
    }
  },

  methods: {
    noop() {},

    reset() {
      const today = new Date()
      today.setDate(today.getDate() + 7)
      const deadlineDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const deadlineTime = '23:59'
      this.setData({
        title: '',
        description: '',
        maxMembers: '',
        genderFilter: 'any',
        genderIndex: 0,
        deadlineDate,
        deadlineTime,
        place: '',
        submitting: false
      })
    },

    onTitleInput(e) { this.setData({ title: e.detail.value }) },
    onDescInput(e) { this.setData({ description: e.detail.value }) },
    onMaxMembers(e) { const v = Number(e.detail.value); this.setData({ maxMembers: v > 0 ? v : '' }) },
    onGenderChange(e) {
      const genderMap = ['any', 'male', 'female']
      const index = Number(e.detail.value) || 0
      this.setData({ genderIndex: index, genderFilter: genderMap[index] || 'any' })
    },
    onDeadlineDateChange(e) { this.setData({ deadlineDate: e.detail.value }) },
    onDeadlineTimeChange(e) { this.setData({ deadlineTime: e.detail.value }) },
    onPlaceInput(e) { this.setData({ place: e.detail.value }) },

    close() {
      this.triggerEvent('close')
    },

    async submit() {
      if (this.data.submitting) return
      const title = this.data.title.trim()
      if (!title) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Title is required' : '请填写标题', icon: 'none' })
        return
      }
      const description = this.data.description.trim()
      if (!description) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Description is required' : '请填写描述', icon: 'none' })
        return
      }
      const deadlineDate = this.data.deadlineDate
      const deadlineTime = this.data.deadlineTime
      if (!deadlineDate || !deadlineTime) {
        wx.showToast({ title: this.data.lang === 'en' ? 'Deadline is required' : '请选择截止日期和时间', icon: 'none' })
        return
      }
      const deadline = deadlineDate + ' ' + deadlineTime
      if (!this.data.maxMembers || this.data.maxMembers < 2) {
        wx.showModal({
          title: this.data.lang === 'en' ? 'Invalid count' : '人数无效',
          content: this.data.lang === 'en' ? 'Please set at least 2 members.' : '人数不能为零，至少2人',
          showCancel: false
        })
        return
      }

      this.setData({ submitting: true })
      try {
        const result = await api.createPost({
          type: this.data.postType,
          courseId: this.data.courseId,
          courseName: this.data.courseName,
          title,
          description,
          maxMembers: this.data.maxMembers,
          genderFilter: this.data.genderFilter,
          deadline: deadline,
          place: this.data.place.trim() || ''
        })
        this.setData({ submitting: false })
        wx.showToast({ title: this.data.lang === 'en' ? 'Posted!' : '发布成功', icon: 'success' })
        this.reset()
        this.triggerEvent('published', { post: result })
      } catch (err) {
        this.setData({ submitting: false })
        wx.showToast({ title: err.message || (this.data.lang === 'en' ? 'Failed to publish' : '发布失败'), icon: 'none' })
      }
    }
  }
})
