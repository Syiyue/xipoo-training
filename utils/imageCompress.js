const MAX_SIZE = 5 * 1024 * 1024
const MAX_WIDTH = 800
const MAX_HEIGHT = 800
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp']

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    })
  })
}

function compressImage(src, options = {}) {
  const {
    maxWidth = MAX_WIDTH,
    maxHeight = MAX_HEIGHT,
    quality = 0.8,
    fileType = 'jpg',
    context = null
  } = options

  const compressWithCanvas = () => new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: async (imageInfo) => {
        try {
          let { width, height } = imageInfo

          const aspectRatio = width / height
          if (width > maxWidth) {
            width = maxWidth
            height = width / aspectRatio
          }
          if (height > maxHeight) {
            height = maxHeight
            width = height * aspectRatio
          }

          const deviceInfo = (wx.getDeviceInfo && wx.getDeviceInfo()) || { pixelRatio: 2 }
          const pixelRatio = deviceInfo.pixelRatio || 2

          const canvasWidth = Math.floor(width * pixelRatio)
          const canvasHeight = Math.floor(height * pixelRatio)

          if (context) {
            context.setData({
              compressCanvasWidth: canvasWidth,
              compressCanvasHeight: canvasHeight
            })
            await new Promise(resolve => setTimeout(resolve, 50))
          }

          const ctx = wx.createCanvasContext('compressCanvas', context || null)
          ctx.drawImage(src, 0, 0, canvasWidth, canvasHeight)

          ctx.draw(false, () => {
            setTimeout(() => {
              wx.canvasToTempFilePath({
                canvasId: 'compressCanvas',
                width: canvasWidth,
                height: canvasHeight,
                destWidth: canvasWidth,
                destHeight: canvasHeight,
                fileType,
                quality,
                success: (res) => {
                  console.log('[imageCompress success]', res.tempFilePath)
                  resolve({
                    tempFilePath: res.tempFilePath,
                    width: Math.floor(width),
                    height: Math.floor(height),
                    quality
                  })
                },
                fail: (err) => {
                  console.error('[imageCompress canvasToTempFilePath fail]', err)
                  reject(err)
                }
              }, context || null)
            }, 100)
          })
        } catch (e) {
          console.error('[imageCompress error]', e)
          reject(e)
        }
      },
      fail: reject
    })
  })

  // 在部分设备上，离屏 canvas 的初始化和导出容易因时序或内存失败；
  // 先使用微信提供的原生压缩，再把 canvas 留作兼容回退。
  if (typeof wx.compressImage !== 'function') return compressWithCanvas()
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality: Math.round(Math.max(0, Math.min(1, quality)) * 100),
      success: async (result) => {
        try {
          const info = await getImageInfo(result.tempFilePath)
          resolve({
            tempFilePath: result.tempFilePath,
            width: Math.min(Math.floor(info.width || maxWidth), maxWidth),
            height: Math.min(Math.floor(info.height || maxHeight), maxHeight),
            quality
          })
        } catch (_) {
          resolve({ tempFilePath: result.tempFilePath, width: maxWidth, height: maxHeight, quality })
        }
      },
      fail: () => {
        compressWithCanvas().then(resolve).catch(reject)
      }
    })
  })
}

function validateImage(filePath, size) {
  const match = filePath.match(/\.(\w+)$/)
  const ext = (match && match[1]) ? match[1].toLowerCase() : ''
  
  if (!ALLOWED_EXTS.includes(ext)) {
    return {
      valid: false,
      message: `仅支持 ${ALLOWED_EXTS.join('/')} 格式`
    }
  }

  if (size > MAX_SIZE) {
    return {
      valid: false,
      message: `图片大小不能超过 ${MAX_SIZE / (1024 * 1024)}MB`
    }
  }

  return {
    valid: true,
    message: ''
  }
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: resolve,
      fail: reject
    })
  })
}

module.exports = {
  compressImage,
  validateImage,
  getImageInfo,
  getFileInfo,
  MAX_SIZE,
  MAX_WIDTH,
  MAX_HEIGHT,
  ALLOWED_EXTS
}
