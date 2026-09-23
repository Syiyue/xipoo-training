const api = require('../../../../utils/api')

Page({
  data: {
    // 表单数据
    form: {
      title: '',
      startTime: '',
      endTime: '',
      allDay: false,
      repeat: 'none',
      repeatLabel: '不重复',
      location: '',
      description: ''
    },
    descLength: 0,

    // 导航栏
    statusBarHeight: 20,
    starActive: false,

    // 时间选择器
    timePickerOpen: false,
    hourOptions: [],
    minuteOptions: [],
    startTimeIdx: [8, 0],
    endTimeIdx: [9, 0],

    // 重复选择器
    repeatPickerOpen: false,
    // 地点输入弹窗
    locationInputOpen: false,
    locationInputValue: '',
    repeatOptions: [
      { key: 'none', label: '不重复' },
      { key: 'daily', label: '每天' },
      { key: 'weekly', label: '每周' },
      { key: 'biweekly', label: '每两周' },
      { key: 'monthly', label: '每月' },
      { key: 'yearly', label: '每年' },
      { key: 'weekday', label: '工作日' }
    ]
  },

  onLoad(options) {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null)
    this.setData({ statusBarHeight: win && win.statusBarHeight ? win.statusBarHeight : 20 })
    // 生成小时和分钟选项
    const hours = []
    for (let h = 0; h < 24; h++) {
      hours.push(String(h).padStart(2, '0'))
    }
    const minutes = []
    for (let m = 0; m < 60; m += 5) {
      minutes.push(String(m).padStart(2, '0'))
    }

    // 接收URL参数自动填充时间和日期
    const updates = {}
    if (options.startHour !== undefined) {
      const sh = parseInt(options.startHour) || 8
      updates['form.startTime'] = `${String(sh).padStart(2, '0')}:00`
      updates['form.endTime'] = `${String((sh + 1) % 24).padStart(2, '0')}:00`
      updates.startTimeIdx = [sh, 0]
      updates.endTimeIdx = [(sh + 1) % 24, 0]
    }
    if (options.allDay === '1') {
      updates['form.allDay'] = true
      updates['form.startTime'] = '00:00'
      updates['form.endTime'] = '23:59'
    }
    // 保存传入的日期，供保存时使用
    if (options.year && options.month && options.day) {
      this._presetDate = `${options.year}-${String(options.month).padStart(2, '0')}-${String(options.day).padStart(2, '0')}`
    }

    this.setData({
      hourOptions: hours,
      minuteOptions: minutes,
      ...updates
    })
  },

  // ========== 导航栏 ==========
  goBack() {
    wx.switchTab({ url: '/pages/schedule/schedule' })
  },

  toggleStar() {
    this.setData({ starActive: !this.data.starActive })
    wx.showToast({
      title: this.data.starActive ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1000
    })
  },

  openMoreMenu() {
    wx.showActionSheet({
      itemList: ['分享日程', '打印日程', '导出日历'],
      success(res) {
        console.log('选中:', res.tapIndex)
      }
    })
  },

  openSettings() {
    wx.showToast({
      title: '设置功能开发中',
      icon: 'none',
      duration: 1000
    })
  },

  // ========== 表单输入 ==========
  onTitleInput(e) {
    this.setData({ 'form.title': e.detail.value })
  },

  onDescInput(e) {
    const val = e.detail.value
    this.setData({
      'form.description': val,
      descLength: val.length
    })
  },

  // ========== 全天切换 ==========
  onAllDayChange(e) {
    this.setData({ 'form.allDay': e.detail.value })
  },

  // ========== 时间选择 ==========
  openTimePicker() {
    // 解析当前时间设置默认选择器位置
    const start = this.data.form.startTime || '08:00'
    const end = this.data.form.endTime || '09:00'
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    const smIdx = Math.floor(sm / 5)
    const emIdx = Math.floor(em / 5)

    this.setData({
      timePickerOpen: true,
      startTimeIdx: [sh, smIdx],
      endTimeIdx: [eh, emIdx]
    })
  },

  closeTimePicker() {
    this.setData({ timePickerOpen: false })
  },

  onStartTimeChange(e) {
    this.setData({ startTimeIdx: e.detail.value })
  },

  onEndTimeChange(e) {
    this.setData({ endTimeIdx: e.detail.value })
  },

  confirmTime() {
    const [sh, smIdx] = this.data.startTimeIdx
    const [eh, emIdx] = this.data.endTimeIdx
    const startTime = `${String(sh).padStart(2, '0')}:${String(smIdx * 5).padStart(2, '0')}`
    const endTime = `${String(eh).padStart(2, '0')}:${String(emIdx * 5).padStart(2, '0')}`
    this.setData({
      'form.startTime': startTime,
      'form.endTime': endTime,
      timePickerOpen: false
    })
  },

  // ========== 重复选择 ==========
  openRepeatPicker() {
    this.setData({ repeatPickerOpen: true })
  },

  closeRepeatPicker() {
    this.setData({ repeatPickerOpen: false })
  },

  selectRepeat(e) {
    const { key, label } = e.currentTarget.dataset
    this.setData({
      'form.repeat': key,
      'form.repeatLabel': label,
      repeatPickerOpen: false
    })
  },

  // ========== 地点选择 ==========
  openLocationPicker() {
    this.setData({
      locationInputOpen: true,
      locationInputValue: this.data.form.location || ''
    })
  },

  onLocationInput(e) {
    this.setData({ locationInputValue: e.detail.value })
  },

  confirmLocationInput() {
    this.setData({
      'form.location': this.data.locationInputValue.trim() || '已添加地点',
      locationInputOpen: false
    })
  },

  closeLocationInput() {
    this.setData({ locationInputOpen: false })
  },

  // ========== 保存 ==========
  async onSave() {
    const { form } = this.data

    // 基本校验
    if (!form.title.trim()) {
      wx.showToast({ title: '请输入日程名称', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    try {
      // 调用 API 保存
      await api.addActivity({
        title: form.title.trim(),
        startTime: form.allDay ? '00:00' : (form.startTime || '08:00'),
        endTime: form.allDay ? '23:59' : (form.endTime || '09:00'),
        allDay: form.allDay,
        repeat: form.repeat,
        location: form.location,
        description: form.description.trim(),
        date: this.getTodayDate()
      })

      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success', duration: 1500 })

      // 延迟返回上一页
      setTimeout(() => {
        wx.navigateBack({ delta: 1 })
      }, 1500)
    } catch (error) {
      wx.hideLoading()
      // 如果 API 失败，保存到本地存储作为后备
      this.saveToLocal()
      wx.showToast({ title: '已保存到本地', icon: 'success', duration: 1500 })
      setTimeout(() => {
        wx.navigateBack({ delta: 1 })
      }, 1500)
    }
  },

  getTodayDate() {
    if (this._presetDate) return this._presetDate
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  saveToLocal() {
    const { form } = this.data
    const schedules = wx.getStorageSync('local_schedules') || []
    schedules.push({
      id: `local_${Date.now()}`,
      title: form.title.trim(),
      startTime: form.allDay ? '00:00' : (form.startTime || '08:00'),
      endTime: form.allDay ? '23:59' : (form.endTime || '09:00'),
      allDay: form.allDay,
      repeat: form.repeat,
      location: form.location,
      description: form.description.trim(),
      date: this.getTodayDate(),
      createdAt: new Date().toISOString()
    })
    wx.setStorageSync('local_schedules', schedules)
  }
})
