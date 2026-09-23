/**
 * 头像选择弹窗组件 - 预制头像 + 自定义头像(chooseAvatar)
 * 预制头像作为本地资源直接返回，不经过云上传
 */
const api = require('../../utils/api')

Component({
  properties: {
    visible: { type: Boolean, value: false },
    lang: { type: String, value: 'zh' },
    currentAvatarUrl: { type: String, value: '' }
  },

  data: {
    presetAvatars: [],
    selectedPreset: -1,
    t: {}
  },

  observers: {
    'lang': function(lang) {
      this.updateI18n(lang)
    }
  },

  lifetimes: {
    attached() {
      this.loadPresetAvatars()
      this.updateI18n(this.properties.lang)
    }
  },

  methods: {
    loadPresetAvatars() {
      const avatars = []
      for (let i = 1; i <= 6; i++) {
        avatars.push(`/images/default_avatar/avatar_${i}.png`)
      }
      this.setData({ presetAvatars: avatars })
    },

    updateI18n(lang) {
      const dict = {
        zh: {
          selectAvatar: '选择头像',
          customAvatar: '自定义头像',
          cancel: '取消'
        },
        en: {
          selectAvatar: 'Choose Avatar',
          customAvatar: 'Custom Avatar',
          cancel: 'Cancel'
        }
      }
      this.setData({ t: dict[lang] || dict.zh })
    },

    /* 选中预制头像 - 直接作为本地资源路径返回，不走云上传 */
    async selectPreset(e) {
      const index = e.currentTarget.dataset.index
      this.setData({ selectedPreset: index })
      const localUrl = this.data.presetAvatars[index]
      this.triggerEvent('avatarpreview', { avatarUrl: localUrl })
      wx.showLoading({ title: '保存中...', mask: true })
      try {
        // 预制头像直接作为本地资源路径保存
        await api.updateProfile({ avatarUrl: localUrl })
        wx.hideLoading()
        this.triggerEvent('avatarupdated', { avatarUrl: localUrl })
        this.hide()
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    },

    /* 自定义头像 - open-type chooseAvatar 返回临时文件路径，上传云存储 */
    onChooseWechatAvatar(e) {
      const detail = e.detail
      if (!detail || !detail.avatarUrl) {
        wx.showToast({ title: this.data.lang === 'zh' ? '获取头像失败' : 'Failed to get avatar', icon: 'none' })
        return
      }
      this.triggerEvent('avatarpreview', { avatarUrl: detail.avatarUrl })
      wx.showLoading({ title: '保存中...', mask: true })
      this.uploadToCloud(detail.avatarUrl)
    },

    /* 上传到云存储 */
    async uploadToCloud(filePath) {
      try {
        console.log('[avatarPicker] uploadToCloud:', filePath)
        let uploadPath = filePath
        // 如果是网络链接，用 getImageInfo 获取本地临时路径
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
          const info = await wx.getImageInfo({ src: filePath })
          uploadPath = info.path
        }
        const app = getApp()
        if (!app.isCloudReady()) {
          app.initCloud()
        }
        const match = uploadPath.match(/\.(\w+)$/)
        const ext = (match && match[1]) ? match[1].toLowerCase() : 'jpg'
        const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(-8)}.${ext}`
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: uploadPath })

        await api.updateProfile({ avatarUrl: uploadRes.fileID })
        wx.hideLoading()
        this.triggerEvent('avatarupdated', { avatarUrl: uploadRes.fileID })
        this.hide()
      } catch (e) {
        console.error('[avatarPicker] uploadToCloud error:', e)
        wx.hideLoading()
        wx.showToast({ title: e.message || '上传头像失败', icon: 'none' })
      }
    },

    /* 关闭弹窗 - 仅关闭，不修改头像状态 */
    onCancel() {
      this.hide()
    },

    onOverlayTap() { this.onCancel() },
    stopPropagation() {},

    hide() {
      this.triggerEvent('close')
      this.setData({ selectedPreset: -1 })
    }
  }
})
