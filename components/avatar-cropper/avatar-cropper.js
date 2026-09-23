const { dictionaries } = require('../../utils/i18n')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    imageSrc: {
      type: String,
      value: ''
    },
    cropSize: {
      type: Number,
      value: 300
    },
    lang: {
      type: String,
      value: 'zh'
    }
  },

  data: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    imageWidth: 0,
    imageHeight: 0,
    cropBoxWidth: 0,
    cropBoxHeight: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastScale: 1,
    initialPinchDistance: 0,
    isPinching: false,
    t: {}
  },

  lifetimes: {
    attached() {
      this.setData({ t: dictionaries[this.properties.lang] || {} })
    }
  },

  observers: {
    visible(val) {
      if (val) {
        this.initCrop()
      }
    },
    lang(val) {
      this.setData({ t: dictionaries[val] || {} })
    }
  },

  methods: {
    async initCrop() {
      if (!this.properties.imageSrc) {
        console.error('[avatar-cropper initCrop] imageSrc is empty')
        return
      }

      try {
        const imageInfo = await this.getImageInfo(this.properties.imageSrc)
        
        const deviceInfo = (wx.getDeviceInfo && wx.getDeviceInfo()) || { pixelRatio: 2 }
        const windowInfo = (wx.getWindowInfo && wx.getWindowInfo()) || { windowWidth: 375 }
        const pixelRatio = deviceInfo.pixelRatio || 2
        const baseCropBoxWidth = (600 / 750) * windowInfo.windowWidth
        const canvasSize = this.properties.cropSize * pixelRatio

        const displayWidth = baseCropBoxWidth
        const displayHeight = (imageInfo.height / imageInfo.width) * displayWidth

        const scale = this.calculateInitialScale(imageInfo.width, imageInfo.height, baseCropBoxWidth)

        console.log('[avatar-cropper initCrop] imageInfo:', imageInfo)
        console.log('[avatar-cropper initCrop] cropBoxWidth:', baseCropBoxWidth)
        console.log('[avatar-cropper initCrop] canvasSize:', canvasSize)
        console.log('[avatar-cropper initCrop] initial scale:', scale)

        this.setData({
          imageWidth: imageInfo.width,
          imageHeight: imageInfo.height,
          scale: scale,
          offsetX: 0,
          offsetY: 0,
          cropBoxWidth: baseCropBoxWidth,
          cropBoxHeight: baseCropBoxWidth,
          canvasWidth: canvasSize,
          canvasHeight: canvasSize,
          displayWidth: displayWidth,
          displayHeight: displayHeight
        })
      } catch (e) {
        console.error('[avatar-cropper initCrop error]', e)
        wx.showToast({ title: '图片加载失败', icon: 'none' })
        this.triggerEvent('cancel')
      }
    },

    calculateInitialScale(imgWidth, imgHeight, boxWidth) {
      const imgRatio = imgWidth / imgHeight
      const boxRatio = 1
      
      let scale
      if (imgRatio > boxRatio) {
        scale = boxWidth / imgHeight
      } else {
        scale = boxWidth / imgWidth
      }
      
      return Math.max(scale, 1)
    },

    getImageInfo(src) {
      return new Promise((resolve, reject) => {
        wx.getImageInfo({
          src,
          success: (res) => {
            console.log('[avatar-cropper getImageInfo success]', res)
            resolve(res)
          },
          fail: (err) => {
            console.error('[avatar-cropper getImageInfo fail]', err)
            reject(err)
          }
        })
      })
    },

    onImageLoad(e) {
      const { width, height } = e.detail
      console.log('[avatar-cropper onImageLoad]', { width, height })
      if (width && height && (!this.data.imageWidth || !this.data.imageHeight)) {
        this.setData({ imageWidth: width, imageHeight: height })
        if (this.data.cropBoxWidth) {
          const scale = this.calculateInitialScale(width, height, this.data.cropBoxWidth)
          this.setData({ scale: scale })
        }
      }
    },

    onTouchStart(e) {
      if (e.touches.length === 1) {
        this.setData({
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          lastX: this.data.offsetX,
          lastY: this.data.offsetY,
          isPinching: false
        })
      } else if (e.touches.length === 2) {
        const distance = this.getDistance(e.touches[0], e.touches[1])
        this.setData({
          initialPinchDistance: distance,
          lastScale: this.data.scale,
          isPinching: true
        })
      }
    },

    onTouchMove(e) {
      if (e.touches.length === 1 && !this.data.isPinching) {
        const deltaX = e.touches[0].clientX - this.data.startX
        const deltaY = e.touches[0].clientY - this.data.startY
        this.setData({
          offsetX: this.data.lastX + deltaX,
          offsetY: this.data.lastY + deltaY
        })
      } else if (e.touches.length === 2) {
        const distance = this.getDistance(e.touches[0], e.touches[1])
        const scale = this.data.lastScale * (distance / this.data.initialPinchDistance)
        const clampedScale = Math.max(1, Math.min(10, scale))
        this.setData({ scale: clampedScale })
      }
    },

    onTouchEnd() {
      this.setData({ isPinching: false })
    },

    getDistance(touch1, touch2) {
      const dx = touch1.clientX - touch2.clientX
      const dy = touch1.clientY - touch2.clientY
      return Math.sqrt(dx * dx + dy * dy)
    },

    onZoomIn() {
      const newScale = Math.min(10, this.data.scale + 0.2)
      this.setData({ scale: newScale })
    },

    onZoomOut() {
      const newScale = Math.max(1, this.data.scale - 0.2)
      this.setData({ scale: newScale })
    },

    onCancel() {
      this.triggerEvent('cancel')
    },

    async onConfirm() {
      if (!this.data.imageWidth || !this.data.imageHeight) {
        console.error('[avatar-cropper onConfirm] image not loaded')
        wx.showToast({ title: '图片未加载完成', icon: 'none' })
        return
      }

      try {
        wx.showLoading({ title: '裁剪中...', mask: true })
        const croppedPath = await this.cropImage()
        wx.hideLoading()
        console.log('[avatar-cropper onConfirm] crop success:', croppedPath)
        this.triggerEvent('confirm', { tempFilePath: croppedPath })
      } catch (e) {
        wx.hideLoading()
        console.error('[avatar-cropper onConfirm error]', e)
        wx.showToast({ title: '裁剪失败，请重试', icon: 'none' })
        this.triggerEvent('confirm', { tempFilePath: '' })
      }
    },

    async cropImage() {
      const { imageSrc, scale, offsetX, offsetY, imageWidth, imageHeight, canvasWidth, canvasHeight, cropBoxWidth } = this.data

      console.log('[avatar-cropper cropImage] params:', {
        imageSrc, scale, offsetX, offsetY, imageWidth, imageHeight, canvasWidth, canvasHeight, cropBoxWidth
      })

      if (!imageSrc) {
        throw new Error('imageSrc is empty')
      }

      if (!canvasWidth || !canvasHeight) {
        throw new Error('canvas size is 0')
      }

      const displayScale = cropBoxWidth / imageWidth
      const totalScale = displayScale * scale

      const centerX = cropBoxWidth / 2 + offsetX
      const centerY = cropBoxWidth / 2 + offsetY

      let cropX = (centerX - cropBoxWidth / 2) / totalScale
      let cropY = (centerY - cropBoxWidth / 2) / totalScale
      let cropW = cropBoxWidth / totalScale
      let cropH = cropBoxWidth / totalScale

      cropX = Math.max(0, Math.min(cropX, imageWidth - cropW))
      cropY = Math.max(0, Math.min(cropY, imageHeight - cropH))

      console.log('[avatar-cropper cropImage] crop rect:', { cropX, cropY, cropW, cropH })

      const ctx = wx.createCanvasContext('cropCanvas', this)

      ctx.save()
      ctx.drawImage(imageSrc, cropX, cropY, cropW, cropH, 0, 0, canvasWidth, canvasHeight)
      ctx.restore()

      return new Promise((resolve, reject) => {
        ctx.draw(false, () => {
          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvasId: 'cropCanvas',
              width: canvasWidth,
              height: canvasHeight,
              destWidth: canvasWidth,
              destHeight: canvasHeight,
              fileType: 'jpg',
              quality: 0.9,
              success: (res) => {
                console.log('[avatar-cropper canvasToTempFilePath success]', res.tempFilePath)
                resolve(res.tempFilePath)
              },
              fail: (err) => {
                console.error('[avatar-cropper canvasToTempFilePath fail]', err)
                reject(new Error('canvas转换失败: ' + (err.errMsg || err.message)))
              }
            }, this)
          }, 200)
        })
      })
    }
  }
})