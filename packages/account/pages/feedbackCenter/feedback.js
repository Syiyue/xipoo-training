const api = require('../../../../utils/api')
const { resolveCloudImages } = require('../../../../utils/cloudImage')

const STATUS_TEXT = {
  zh: { pending: '待处理', resolved: '已解决', ignored: '已忽略' },
  en: { pending: 'Pending', resolved: 'Resolved', ignored: 'Closed' }
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    typeIndex: 0,
    typeOptions: ['Bug反馈', '功能建议', '其他'],
    content: '',
    images: [],
    contact: '',
    submitting: false,
    lang: 'zh',
    myFeedbacks: [],
    myFeedbacksLoading: false
  },

  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Feedback' : '意见反馈' })
    this.loadMyFeedbacks()
  },

  async loadMyFeedbacks() {
    this.setData({ myFeedbacksLoading: true })
    try {
      const list = await api.listMyFeedbacks()
      const items = (Array.isArray(list) ? list : []).map((f) => Object.assign({}, f, {
        images: Array.isArray(f.images) ? f.images : []
      }))

      // images 是 cloud:// fileID 数组：扁平化后批量换临时 URL，再按条还原
      const flat = []
      items.forEach((f, fi) => {
        f.images.forEach((fileID) => flat.push({ fi, fileID }))
      })
      const resolvedFlat = await resolveCloudImages(flat, 'fileID')
      const urlByIndex = {}
      resolvedFlat.forEach((r) => {
        urlByIndex[r.fi] = urlByIndex[r.fi] || []
        urlByIndex[r.fi].push(r.fileID)
      })

      const lang = this.data.lang
      const statusText = STATUS_TEXT[lang] || STATUS_TEXT.zh
      this.setData({
        myFeedbacks: items.map((f, fi) => ({
          id: f.id || `fb-${fi}`,
          type: f.type || (lang === 'en' ? 'Feedback' : '用户反馈'),
          content: f.content || '',
          imageUrls: urlByIndex[fi] || [],
          status: ['pending', 'resolved', 'ignored'].includes(f.status) ? f.status : 'pending',
          statusText: statusText[['pending', 'resolved', 'ignored'].includes(f.status) ? f.status : 'pending'],
          adminNote: f.adminNote || '',
          timeText: formatTime(f.createdAt)
        }))
      })
    } catch (e) {
      // 列表加载失败静默降级，不影响提交表单
      console.warn('[feedback] load my feedbacks failed:', (e && e.message) || e)
      this.setData({ myFeedbacks: [] })
    } finally {
      this.setData({ myFeedbacksLoading: false })
    }
  },

  previewImage(e) {
    const { src, urls } = e.currentTarget.dataset
    if (!src) return
    wx.previewImage({ current: src, urls: urls && urls.length ? urls : [src] })
  },

  previewQr() {
    wx.previewImage({ urls: ['/packages/account/pages/feedbackCenter/feedback-qr.png'] })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  chooseImage() {
    const remaining = 3 - (this.data.images || []).length
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传3张图片', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ images: [...this.data.images, ...res.tempFilePaths] })
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    const images = [...this.data.images]
    images.splice(index, 1)
    this.setData({ images })
  },

  async submit() {
    const { typeOptions, typeIndex, content, submitting } = this.data
    if (submitting) return
    if (!content.trim()) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      // 上传图片到云存储
      const imageUrls = []
      if (this.data.images.length > 0) {
        for (const filePath of this.data.images) {
          const cloudPath = `feedback/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
          imageUrls.push(uploadRes.fileID)
        }
      }

      // 经 buddy 云函数写入（服务端做文本+图片内容安全检测）
      if (wx.cloud) {
        await api.submitFeedback({
          type: typeOptions[typeIndex],
          content: content.trim(),
          images: imageUrls,
          contact: this.data.contact.trim()
        })
      } else {
        // 无云环境时 mock 写入本地
        const feedbacks = wx.getStorageSync('xipoo_feedbacks') || []
        feedbacks.push({
          type: typeOptions[typeIndex],
          content: content.trim(),
          images: imageUrls,
          contact: this.data.contact.trim(),
          status: 'pending',
          createTime: new Date().toISOString()
        })
        wx.setStorageSync('xipoo_feedbacks', feedbacks)
      }

      wx.hideLoading()
      wx.showToast({ title: '感谢您的反馈！', icon: 'success', duration: 2000 })
      // 清空表单并刷新“我的反馈”列表，让用户立即看到新记录
      this.setData({ content: '', images: [], contact: '', typeIndex: 0 })
      this.loadMyFeedbacks()
    } catch (e) {
      wx.hideLoading()
      console.error('[feedback submit error]', e)
      // 内容违规时云函数返回统一提示文案，直接展示
      wx.showToast({ title: (e && e.message) || '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
