const api = require('../../../../utils/api')
const store = require('../../../../utils/store')
const { dictionaries } = require('../../../../utils/i18n')
const { uploadAvatar, compressImageIfNeeded, getFileInfo } = require('../../../../utils/avatarUploader')

Page({
  data: {
    user: null,
    lang: 'zh',
    t: {},
    uploadingAvatar: false,
    showCropper: false,
    cropImageSrc: '',
    showPreview: false,
    previewImageSrc: '',
    showUploadProgress: false,
    uploadProgress: 0,
    uploadMessage: '',
    compressCanvasWidth: 0,
    compressCanvasHeight: 0,
    originalUser: null,
    pendingUploadPath: '',
    showSchoolPicker: false,
    showGradePicker: false,
    showGenderPicker: false,
    showMajorPicker: false,
    tempSchool: '',
    tempGrade: '',
    tempGender: '',
    tempMajor: '',
    gradeOptions: [
      { value: '大一', zh: '大一', en: 'Year 1' },
      { value: '大二', zh: '大二', en: 'Year 2' },
      { value: '大三', zh: '大三', en: 'Year 3' },
      { value: '大四', zh: '大四', en: 'Year 4' },
      { value: '研一', zh: '研一', en: 'Grad 1' },
      { value: '研二', zh: '研二', en: 'Grad 2' },
      { value: '博士', zh: '博士', en: 'PhD' }
    ],
    genderOptions: [
      { value: '男', zh: '男', en: 'Male' },
      { value: '女', zh: '女', en: 'Female' }
    ],
    majorOptions: [
      { value: '会计学', zh: '会计学', en: 'Accounting' },
      { value: '人工智能（行业前沿，太仓）', zh: '人工智能（行业前沿，太仓）', en: 'AI (Industry Frontier, Taicang)' },
      { value: '人工智能（智能系统，园区）', zh: '人工智能（智能系统，园区）', en: 'AI (Intelligent Systems, SIP)' },
      { value: '应用化学', zh: '应用化学', en: 'Applied Chemistry' },
      { value: '应用物理学', zh: '应用物理学', en: 'Applied Physics' },
      { value: '应用统计学', zh: '应用统计学', en: 'Applied Statistics' },
      { value: '建筑学', zh: '建筑学', en: 'Architecture' },
      { value: '工商管理', zh: '工商管理', en: 'Business Administration' },
      { value: '广播电视学', zh: '广播电视学', en: 'Broadcasting & TV Studies' },
      { value: '机器人工程（太仓）', zh: '机器人工程（太仓）', en: 'Robotics Engineering (Taicang)' },
      { value: '汉语国际教育', zh: '汉语国际教育', en: 'Teaching Chinese' },
      { value: '环境科学', zh: '环境科学', en: 'Environmental Science' },
      { value: '经济学', zh: '经济学', en: 'Economics' },
      { value: '经济与金融', zh: '经济与金融', en: 'Economics & Finance' },
      { value: '电气工程及其自动化', zh: '电气工程及其自动化', en: 'Electrical Engineering' },
      { value: '电子科学与技术', zh: '电子科学与技术', en: 'Electronic Science & Technology' },
      { value: '翻译', zh: '翻译', en: 'Translation & Interpreting' },
      { value: '工业设计', zh: '工业设计', en: 'Industrial Design' },
      { value: '工程管理', zh: '工程管理', en: 'Engineering Management' },
      { value: '国际商务', zh: '国际商务', en: 'International Business' },
      { value: '国际事务与国际关系', zh: '国际事务与国际关系', en: 'International Relations' },
      { value: '传播学', zh: '传播学', en: 'Communication Studies' },
      { value: '计算机科学与技术', zh: '计算机科学与技术', en: 'Computer Science' },
      { value: '金融数学', zh: '金融数学', en: 'Financial Mathematics' },
      { value: '精算学', zh: '精算学', en: 'Actuarial Science' },
      { value: '材料科学与工程', zh: '材料科学与工程', en: 'Materials Science & Engineering' },
      { value: '市场营销', zh: '市场营销', en: 'Marketing' },
      { value: '数学与应用数学', zh: '数学与应用数学', en: 'Applied Mathematics' },
      { value: '信息管理与信息系统', zh: '信息管理与信息系统', en: 'Information Management' },
      { value: '信息与计算科学', zh: '信息与计算科学', en: 'Information & Computing Science' },
      { value: '通信工程', zh: '通信工程', en: 'Communication Engineering' },
      { value: '土木工程', zh: '土木工程', en: 'Civil Engineering' },
      { value: '数据科学与大数据技术（太仓）', zh: '数据科学与大数据技术（太仓）', en: 'Data Science & Big Data (Taicang)' },
      { value: '数字媒体技术', zh: '数字媒体技术', en: 'Digital Media Technology' },
      { value: '数字媒体艺术', zh: '数字媒体艺术', en: 'Digital Media Arts' },
      { value: '微电子科学与工程（太仓）', zh: '微电子科学与工程（太仓）', en: 'Microelectronics (Taicang)' },
      { value: '物联网工程（太仓）', zh: '物联网工程（太仓）', en: 'IoT Engineering (Taicang)' },
      { value: '生物科学', zh: '生物科学', en: 'Biological Sciences' },
      { value: '生物信息学', zh: '生物信息学', en: 'Bioinformatics' },
      { value: '生物医学科学', zh: '生物医学科学', en: 'Biomedical Sciences' },
      { value: '生物制药', zh: '生物制药', en: 'Biopharmaceuticals' },
      { value: '药学', zh: '药学', en: 'Pharmacy' },
      { value: '供应链管理（太仓）', zh: '供应链管理（太仓）', en: 'Supply Chain Management (Taicang)' },
      { value: '城乡规划', zh: '城乡规划', en: 'Urban Planning & Design' },
      { value: '人力资源管理', zh: '人力资源管理', en: 'HR Management' },
      { value: '影视摄影与制作', zh: '影视摄影与制作', en: 'Film & TV Production' },
      { value: '英语（金融商务英语）', zh: '英语（金融商务英语）', en: 'English (Finance & Business)' },
      { value: '英语（传媒英语）', zh: '英语（传媒英语）', en: 'English (Media)' },
      { value: '英语（全球语境下的英语研究）', zh: '英语（全球语境下的英语研究）', en: 'English (Global Contexts)' },
      { value: '英语（应用语言学）', zh: '英语（应用语言学）', en: 'English (Applied Linguistics)' },
      { value: '艺术与科技（太仓）', zh: '艺术与科技（太仓）', en: 'Arts & Technology (Taicang)' },
      { value: '机械电子工程', zh: '机械电子工程', en: 'Mechatronics' },
      { value: '智能制造工程（太仓）', zh: '智能制造工程（太仓）', en: 'Smart Manufacturing (Taicang)' },
      { value: '其他', zh: '其他', en: 'Other' }
    ],
    majorGroups: [],
    majorIndexList: [],
    scrollToMajor: '',
    showCustomMajorInput: false,
    customMajor: '',
    showAvatarPicker: false,
    tagInput: '',
    showcaseImages: []
  },

  onLoad(options) {
    if (options && options.focus) {
      this._focus = options.focus
    }
  },

  onShow() {
    const app = getApp()
    if (!app.requireLogin()) return
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    const mergedT = Object.assign({}, dictionaries[lang])
    const isVisible = wx.getStorageSync('xipoo_visible_status') !== false
    this.setData({ lang, t: mergedT })
    wx.setNavigationBarTitle({ title: mergedT.editProfile || '编辑个人信息' })
    // 每次进入都重新加载最新数据（确保标签/照片墙不丢失）
    this.loadData()
  },

  async loadData() {
    try {
      wx.showLoading({ title: '加载中...', mask: true })
      const user = await api.me()
      console.log('[editProfile] api.me() 返回:', JSON.stringify({ id: user.id, tags: user.tags, showcaseImages: user.showcaseImages }))
      const showcase = Array.isArray(user.showcaseImages) ? user.showcaseImages.slice(0, 3) : []
      this.setData({ 
        user: user,
        originalUser: { ...user },
        showcaseImages: showcase
      })
      this._lastLoadAt = Date.now()
      this._handleFocus()
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  _handleFocus() {
    const focus = this._focus
    if (!focus) return
    this._focus = null
    if (focus === 'signature') {
      this._startEdit('signature')
    } else if (focus === 'bio') {
      this._startEdit('bio')
    } else if (focus === 'photos') {
      setTimeout(() => {
        wx.pageScrollTo({ selector: '.save-btn', duration: 300 })
      }, 600)
    }
  },

  _startEdit(field) {
    this.setData({
      editingField: field,
      editingValue: (this.data.user && this.data.user[field]) || ''
    })
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['user.' + field]: e.detail.value })
    this.scheduleAutoSave()
  },

  scheduleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer)
    this.autoSaveTimer = setTimeout(() => { this.autoSaveProfile() }, 1500)
  },

  async saveProfile() {
    try {
      const { user, originalUser } = this.data
      const changedFields = {}
      if (user.name !== originalUser.name) changedFields.name = user.name
      if (user.degree && user.degree.trim() !== '') changedFields.degree = user.degree
      else if (user.degree !== originalUser.degree) changedFields.degree = user.degree
      if (user.gender !== originalUser.gender) changedFields.gender = user.gender
      if (user.major && user.major.trim() !== '') changedFields.major = user.major
      else if (user.major !== originalUser.major) changedFields.major = user.major
      if (user.school !== originalUser.school) changedFields.school = user.school
      if (user.signature !== originalUser.signature) changedFields.signature = user.signature
      if (user.bio !== originalUser.bio) changedFields.bio = user.bio
      if (JSON.stringify(user.tags || []) !== JSON.stringify(originalUser.tags || [])) changedFields.tags = user.tags || []
      if (JSON.stringify(this.data.showcaseImages) !== JSON.stringify(originalUser.showcaseImages || [])) changedFields.showcaseImages = this.data.showcaseImages

      if (Object.keys(changedFields).length === 0) {
        wx.showToast({ title: '未修改任何信息', icon: 'none' })
        return
      }

      const updated = await api.updateProfile(changedFields)
      if (!updated) throw new Error('后端未返回数据')
      this.setData({ user: updated, originalUser: { ...updated } })
      getApp().globalData.userInfo = updated
      wx.setStorageSync('xipoo_user_info', updated)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => { wx.navigateBack() }, 1000)
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  },

  chooseAvatar() { this.setData({ showAvatarPicker: true }) },
  onAvatarPickerClose() { this.setData({ showAvatarPicker: false }) },
  onAvatarPreview(e) {
    if (e.detail.avatarUrl) this.setData({ 'user.avatarUrl': e.detail.avatarUrl })
  },
  onAvatarUpdated(e) {
    const newAvatarUrl = e.detail.avatarUrl
    if (!newAvatarUrl) return
    // 头像组件已完成单字段保存；不能再整页 loadData，否则局部更新返回或网络旧数据会覆盖资料表单。
    const user = Object.assign({}, this.data.user || {}, { avatarUrl: newAvatarUrl })
    const originalUser = Object.assign({}, this.data.originalUser || user, { avatarUrl: newAvatarUrl })
    this.setData({ showAvatarPicker: false, user, originalUser })
    const app = getApp()
    const globalUser = Object.assign({}, (app.globalData && app.globalData.userInfo) || {}, { avatarUrl: newAvatarUrl })
    if (app.globalData) app.globalData.userInfo = globalUser
    wx.setStorageSync('xipoo_user_info', globalUser)
  },

  stopPropagation() {},
  showSchoolPicker() {
    this.setData({ showSchoolPicker: true, tempSchool: this.data.user.school || '' })
  },
  hideSchoolPicker() { this.setData({ showSchoolPicker: false, showAvatarPicker: false }) },
  selectSchool(e) { this.setData({ tempSchool: e.currentTarget.dataset.school }) },
  confirmSchool() {
    this.setData({ 'user.school': this.data.tempSchool })
    this.hideSchoolPicker()
    this.autoSaveProfile()
  },

  showGradePicker() {
    this.setData({ showGradePicker: true, tempGrade: this.data.user.degree || '' })
  },
  hideGradePicker() { this.setData({ showGradePicker: false }) },
  selectGrade(e) { this.setData({ tempGrade: e.currentTarget.dataset.grade }) },
  confirmGrade() {
    this.setData({ 'user.degree': this.data.tempGrade })
    this.hideGradePicker()
    this.autoSaveProfile()
  },

  showGenderPicker() {
    this.setData({ showGenderPicker: true, tempGender: this.data.user.gender || '' })
  },
  hideGenderPicker() { this.setData({ showGenderPicker: false }) },
  selectGender(e) { this.setData({ tempGender: e.currentTarget.dataset.gender }) },
  confirmGender() {
    this.setData({ 'user.gender': this.data.tempGender })
    this.hideGenderPicker()
    this.autoSaveProfile()
  },

  showMajorPicker() {
    this.buildMajorGroups()
    this.setData({ showMajorPicker: true, tempMajor: this.data.user.major || '' })
  },
  buildMajorGroups() {
    const majors = this.data.majorOptions
    const isEn = this.data.lang === 'en'
    const groups = []
    const indexList = []
    const usedLetters = new Set()
    majors.forEach((m, i) => {
      const label = isEn ? (m.en || m.zh) : m.zh
      const first = label.charAt(0).toUpperCase()
      const letter = /[A-Z]/.test(first) ? first : '#'
      if (!usedLetters.has(letter)) {
        usedLetters.add(letter)
        indexList.push(letter)
        groups.push({ letter, startIndex: i })
      }
    })
    this.setData({ majorGroups: groups, majorIndexList: indexList })
  },
  onMajorIndexTap(e) {
    const letter = e.currentTarget.dataset.letter
    const group = this.data.majorGroups.find(g => g.letter === letter)
    if (group) {
      this.setData({ scrollToMajor: 'major-group-' + letter })
    }
  },
  hideMajorPicker() { this.setData({ showMajorPicker: false }) },
  selectMajor(e) { this.setData({ tempMajor: e.currentTarget.dataset.major }) },
  confirmMajor() {
    this.setData({ 'user.major': this.data.tempMajor })
    this.hideMajorPicker()
    this.autoSaveProfile()
  },

  async autoSaveProfile() {
    try {
      const { user, originalUser } = this.data
      const changedFields = {}
      if (user.name !== originalUser.name) changedFields.name = user.name
      if (user.degree && user.degree.trim() !== '') changedFields.degree = user.degree
      else if (user.degree !== originalUser.degree) changedFields.degree = user.degree
      if (user.gender !== originalUser.gender) changedFields.gender = user.gender
      if (user.major && user.major.trim() !== '') changedFields.major = user.major
      else if (user.major !== originalUser.major) changedFields.major = user.major
      if (user.school !== originalUser.school) changedFields.school = user.school
      if (user.signature !== originalUser.signature) changedFields.signature = user.signature
      if (user.bio !== originalUser.bio) changedFields.bio = user.bio
      if (JSON.stringify(user.tags || []) !== JSON.stringify(originalUser.tags || [])) changedFields.tags = user.tags || []
      if (JSON.stringify(this.data.showcaseImages) !== JSON.stringify(originalUser.showcaseImages || [])) changedFields.showcaseImages = this.data.showcaseImages
      console.log('[editProfile] autoSaveProfile changedFields:', JSON.stringify(changedFields))
      if (Object.keys(changedFields).length === 0) return

      const updated = await api.updateProfile(changedFields)
      console.log('[editProfile] autoSaveProfile 返回:', JSON.stringify({ id: updated && updated.id, tags: updated && updated.tags, showcaseImages: updated && updated.showcaseImages }))
      if (!updated) return
      // 输入框绑定的是 user。自动保存返回后若整体替换 user，会让输入框重渲染、
      // 丢失光标，并可能覆盖请求期间继续输入的内容；这里只更新已保存的基线。
      const savedBaseline = Object.assign({}, originalUser, changedFields)
      this.setData({ originalUser: savedBaseline })
      getApp().globalData.userInfo = updated
      wx.setStorageSync('xipoo_user_info', updated)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },

  onTagInput(e) { this.setData({ tagInput: e.detail.value }) },
  addTag() {
    const tag = this.data.tagInput.trim()
    if (!tag) return
    const tags = this.data.user.tags || []
    if (tags.includes(tag)) { wx.showToast({ title: '标签已存在', icon: 'none' }); return }
    if (tags.length >= 10) { wx.showToast({ title: '最多添加10个标签', icon: 'none' }); return }
    this.setData({ 'user.tags': [...tags, tag], tagInput: '' })
    this.scheduleAutoSave()
  },
  removeTag(e) {
    const index = e.currentTarget.dataset.index
    const tags = [...(this.data.user.tags || [])]
    tags.splice(index, 1)
    this.setData({ 'user.tags': tags })
    this.scheduleAutoSave()
  },

  previewPhoto(e) {
    wx.previewImage({ current: this.data.showcaseImages[e.currentTarget.dataset.index], urls: this.data.showcaseImages })
  },

  async removePhoto(e) {
    const index = e.currentTarget.dataset.index
    const images = [...this.data.showcaseImages]
    images.splice(index, 1)
    this.setData({ showcaseImages: images })
    try {
      const updated = await api.updateProfile({ showcaseImages: images })
      if (updated) {
        getApp().globalData.userInfo = updated
        wx.setStorageSync('xipoo_user_info', updated)
        this.setData({ user: updated, originalUser: { ...updated } })
      }
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
  },

  async addPhoto() {
    try {
      if (this.data.showcaseImages.length >= 3) {
        wx.showToast({ title: '最多添加3张照片', icon: 'none' })
        return
      }
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
      const filePath = res.tempFiles[0].tempFilePath

      let fileID = filePath
      if (wx.cloud) {
        try {
          const cloudPath = 'showcase/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg'
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
          fileID = uploadRes.fileID
        } catch (e) {
          console.warn('[editProfile addPhoto] cloud upload failed, using local path:', e.message)
          fileID = filePath
        }
      }

      const images = [...this.data.showcaseImages, fileID]
      this.setData({ showcaseImages: images })

      const updated = await api.updateProfile({ showcaseImages: images })
      if (updated) {
        getApp().globalData.userInfo = updated
        wx.setStorageSync('xipoo_user_info', updated)
        const newOriginal = { ...(this.data.originalUser || {}), showcaseImages: images }
        this.setData({ user: updated, originalUser: newOriginal, showcaseImages: images })
      }
    } catch (err) {
      if (!(err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: err.message || '添加失败', icon: 'none' })
      }
    }
  },

  onUnload() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer)
  }
})
