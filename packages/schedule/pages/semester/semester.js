Page({
  data: {
    statusBarHeight: 20,
    deleteMode: false,
    dialogOpen: false,
    dialogType: '',
    dialogTarget: null,
    pickerOpen: false,
    pickerYear: '2026-2027',
    pickerTerm: '第一学期',
    yearOptions: ['2020-2021','2021-2022','2022-2023','2023-2024','2024-2025','2025-2026','2026-2027','2027-2028','2028-2029','2029-2030'],
    termOptions: ['第一学期','第二学期','第三学期','第四学期'],
    semesters: [
      {
        year: '2026-2027',
        active: true,
        terms: [
          { name: '第一学期', current: true, courseCount: 0 },
          { name: '第二学期', current: false, courseCount: 0 }
        ]
      },
      {
        year: '2025-2026',
        active: false,
        terms: [
          { name: '第一学期', current: false, courseCount: 18 },
          { name: '第二学期', current: false, courseCount: 9 }
        ]
      },
      {
        year: '2024-2025',
        active: false,
        terms: [
          { name: '第一学期', current: false, courseCount: 0 },
          { name: '第二学期', current: false, courseCount: 0 }
        ]
      }
    ]
  },

  onLoad() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null)
    this.setData({ statusBarHeight: win && win.statusBarHeight ? win.statusBarHeight : 20 })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  toggleDeleteMode() {
    this.setData({ deleteMode: !this.data.deleteMode })
  },

  selectTerm(e) {
    if (this.data.deleteMode) return
    const { year, term, yearidx, termidx } = e.currentTarget.dataset
    this.setData({
      dialogOpen: true,
      dialogType: 'switch',
      dialogTarget: { year, name: term, yearIdx: Number(yearidx), termIdx: Number(termidx) }
    })
  },

  confirmDeleteTerm(e) {
    const { year, term, yearidx, termidx } = e.currentTarget.dataset
    this.setData({
      dialogOpen: true,
      dialogType: 'delete',
      dialogTarget: { year, name: term, yearIdx: Number(yearidx), termIdx: Number(termidx) }
    })
  },

  closeDialog() {
    this.setData({ dialogOpen: false, dialogTarget: null })
  },

  doSwitch() {
    const { yearIdx, termIdx } = this.data.dialogTarget
    const semesters = this.data.semesters.map((sem, si) => {
      sem.active = si === yearIdx
      sem.terms = sem.terms.map((t, ti) => {
        t.current = si === yearIdx && ti === termIdx
        return t
      })
      return sem
    })
    this.setData({ semesters, dialogOpen: false, dialogTarget: null })
    wx.showToast({ title: '学期已切换', icon: 'success' })
  },

  doDelete() {
    const { yearIdx, termIdx } = this.data.dialogTarget
    const semesters = this.data.semesters.map((sem, si) => {
      if (si === yearIdx) {
        sem.terms = sem.terms.map((t, ti) => {
          if (ti === termIdx) return { name: t.name, current: false, courseCount: 0 }
          return t
        })
      }
      return sem
    })
    this.setData({ semesters, dialogOpen: false, dialogTarget: null })
    wx.showToast({ title: '已删除', icon: 'success' })
  },

  openPicker() {
    this.setData({ pickerOpen: true })
  },

  closePicker() {
    this.setData({ pickerOpen: false })
  },

  selectPickerYear(e) {
    this.setData({ pickerYear: e.currentTarget.dataset.val })
  },

  selectPickerTerm(e) {
    this.setData({ pickerTerm: e.currentTarget.dataset.val })
  },

  confirmPicker() {
    const year = this.data.pickerYear
    const term = this.data.pickerTerm
    // 检查是否已存在
    const exists = this.data.semesters.some(s => s.year === year && s.terms.some(t => t.name === term))
    if (exists) {
      wx.showToast({ title: '该学期已存在', icon: 'none' })
      return
    }
    const semesters = this.data.semesters.map(s => ({ ...s, active: false, terms: s.terms.map(t => ({ ...t, current: false })) }))
    // 查找或创建学年
    let target = semesters.find(s => s.year === year)
    if (target) {
      target.terms.push({ name: term, current: true, courseCount: 0 })
      target.active = true
    } else {
      semesters.push({
        year,
        active: true,
        terms: [{ name: term, current: true, courseCount: 0 }]
      })
    }
    this.setData({ semesters, pickerOpen: false })
    wx.showToast({ title: '学期已创建', icon: 'success' })
  },

  createSemester() {
    this.openPicker()
  }
})
