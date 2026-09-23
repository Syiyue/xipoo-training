const api = require('./api')
const { compressImage, validateImage, getFileInfo } = require('./imageCompress')

const CONFIG = {
  MAX_SIZE: 5 * 1024 * 1024,
  MAX_WIDTH: 800,
  MAX_HEIGHT: 800,
  COMPRESS_QUALITY: 0.75,
  COMPRESS_THRESHOLD: 500 * 1024,
  ALLOWED_EXTS: ['jpg', 'jpeg', 'png', 'webp'],
  UPLOAD_TIMEOUT: 30000
}

function isCloudAvailable() {
  const app = getApp()
  if (!wx.cloud || !wx.cloud.uploadFile) {
    console.warn('[avatarUploader] cloud API not available')
    return false
  }
  if (!app.isCloudReady()) {
    console.warn('[avatarUploader] cloud not initialized, trying to init...')
    try {
      app.initCloud()
    } catch (e) {
      console.error('[avatarUploader] cloud init failed:', e)
    }
    return app.isCloudReady()
  }
  return true
}

function isValidCloudUrl(url) {
  return typeof url === 'string' && url.startsWith('cloud://') && url.length > 10
}

function generateCloudPath(filePath) {
  const match = filePath.match(/\.(\w+)$/)
  const ext = (match && match[1]) ? match[1].toLowerCase() : 'jpg'
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(-8)
  return `avatars/${timestamp}_${random}.${ext}`
}

async function selectImage(options = {}) {
  const {
    sourceType = ['album', 'camera'],
    sizeType = ['compressed']
  } = options

  return new Promise((resolve, reject) => {
    const choose = wx.chooseMedia || wx.chooseImage
    if (typeof choose !== 'function') {
      reject(new Error('当前微信版本不支持图片选择'))
      return
    }
    choose({
      count: 1,
      sourceType,
      sizeType,
      success: (res) => {
        // chooseMedia 返回 tempFiles；兼容 API chooseImage 返回 tempFilePaths / tempFiles。
        const tempFile = (res.tempFiles && res.tempFiles[0]) || {
          tempFilePath: res.tempFilePaths && res.tempFilePaths[0],
          size: res.tempFiles && res.tempFiles[0] && res.tempFiles[0].size,
          type: 'image'
        }
        if (!tempFile || !tempFile.tempFilePath) {
          reject(new Error('未选择图片'))
          return
        }
        
        const validation = validateImage(tempFile.tempFilePath, tempFile.size)
        if (!validation.valid) {
          reject(new Error(validation.message))
          return
        }
        
        resolve({
          tempFilePath: tempFile.tempFilePath,
          size: tempFile.size,
          type: tempFile.type,
          duration: tempFile.duration
        })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) {
          reject(new Error('用户取消选择'))
        } else {
          reject(new Error(`选择图片失败: ${err.errMsg}`))
        }
      }
    })
  })
}

async function compressImageIfNeeded(filePath, options = {}) {
  const { context = null } = options
  
  try {
    const fileInfo = await getFileInfo(filePath)
    
    if (fileInfo.size <= CONFIG.COMPRESS_THRESHOLD) {
      return { tempFilePath: filePath, compressed: false }
    }
    
    const compressed = await compressImage(filePath, {
      maxWidth: CONFIG.MAX_WIDTH,
      maxHeight: CONFIG.MAX_HEIGHT,
      quality: CONFIG.COMPRESS_QUALITY,
      context
    })
    
    return {
      tempFilePath: compressed.tempFilePath,
      compressed: true,
      originalSize: fileInfo.size,
      compressedSize: await getFileInfo(compressed.tempFilePath).then(i => i.size)
    }
  } catch (e) {
    console.warn('[avatarUploader] compress failed, using original:', e)
    return { tempFilePath: filePath, compressed: false }
  }
}

async function uploadToCloud(filePath, onProgress) {
  if (!isCloudAvailable()) {
    throw new Error('云开发不可用，请检查云环境配置')
  }

  const cloudPath = generateCloudPath(filePath)
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('云存储上传超时'))
    }, CONFIG.UPLOAD_TIMEOUT)
    
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        clearTimeout(timeoutId)
        resolve({
          fileID: res.fileID,
          cloudPath
        })
      },
      fail: (err) => {
        clearTimeout(timeoutId)
        let errorMsg = '云存储上传失败'
        if (err.errMsg) {
          if (err.errMsg.includes('auth')) {
            errorMsg = '云存储认证失败，请检查云环境配置'
          } else if (err.errMsg.includes('quota')) {
            errorMsg = '云存储配额不足，请联系管理员'
          } else if (err.errMsg.includes('network')) {
            errorMsg = '网络异常，请检查网络连接'
          } else {
            errorMsg = `云存储上传失败: ${err.errMsg}`
          }
        }
        reject(new Error(errorMsg))
      },
      complete: () => {
        clearTimeout(timeoutId)
        if (onProgress) {
          onProgress({ status: 'completed', progress: 100 })
        }
      }
    })
  })
}

async function updateUserAvatar(fileID) {
  try {
    console.log('[avatarUploader updateUserAvatar] updating avatar:', fileID)
    const updated = await api.updateProfile({ avatarUrl: fileID })
    
    console.log('[avatarUploader updateUserAvatar] response:', updated)
    
    if (!updated) {
      throw new Error('服务器未返回用户信息')
    }
    
    if (!updated.avatarUrl) {
      console.warn('[avatarUploader updateUserAvatar] avatarUrl is empty in response')
    } else if (!updated.avatarUrl.startsWith('cloud://')) {
      console.warn('[avatarUploader updateUserAvatar] avatarUrl is not cloud URL:', updated.avatarUrl)
    }
    
    return updated
  } catch (e) {
    console.error('[avatarUploader updateUserAvatar error]', e)
    if (e.message && e.message.includes('timeout')) {
      throw new Error('服务器响应超时，请稍后重试')
    }
    throw e
  }
}

async function uploadAvatar(options = {}) {
  const {
    filePath = null,
    onProgress,
    onError,
    sourceType = ['album', 'camera'],
    context = null
  } = options

  if (!isCloudAvailable()) {
    const errorMsg = '云开发不可用，请检查云环境配置'
    if (onError) {
      onError({ message: errorMsg })
    }
    return {
      success: false,
      error: errorMsg,
      details: new Error(errorMsg)
    }
  }

  try {
    let selectedFilePath = filePath
    let selectedInfo = null

    if (!filePath) {
      if (onProgress) {
        onProgress({ status: 'selecting', progress: 0, message: '请选择图片' })
      }
      
      const selected = await selectImage({ sourceType })
      selectedFilePath = selected.tempFilePath
      selectedInfo = selected
      
      if (onProgress) {
        onProgress({ status: 'selected', progress: 10, message: '图片已选择', fileInfo: selected })
      }
    }
    
    if (onProgress) {
      onProgress({ status: 'compressing', progress: 20, message: '正在压缩图片...' })
    }
    
    const compressed = await compressImageIfNeeded(selectedFilePath, { context })
    
    if (onProgress) {
      const msg = compressed.compressed 
        ? `图片已压缩 (${(compressed.compressedSize / 1024).toFixed(1)}KB)` 
        : '图片无需压缩'
      onProgress({ status: 'compressed', progress: 40, message: msg, compressedInfo: compressed })
    }
    
    if (onProgress) {
      onProgress({ status: 'uploading', progress: 50, message: '正在上传...' })
    }
    
    const uploaded = await uploadToCloud(compressed.tempFilePath, onProgress)
    
    if (onProgress) {
      onProgress({ status: 'uploaded', progress: 80, message: '上传完成', fileID: uploaded.fileID })
    }
    
    if (onProgress) {
      onProgress({ status: 'saving', progress: 90, message: '正在保存...' })
    }
    
    const updatedUser = await updateUserAvatar(uploaded.fileID)
    
    if (onProgress) {
      onProgress({ status: 'success', progress: 100, message: '头像更新成功', user: updatedUser })
    }
    
    return {
      success: true,
      fileID: uploaded.fileID,
      cloudPath: uploaded.cloudPath,
      user: updatedUser,
      selected: selectedInfo,
      compressed
    }
    
  } catch (error) {
    const errorMessage = error.message || '头像上传失败'
    
    if (onError) {
      onError({ message: errorMessage, error })
    }
    
    return {
      success: false,
      error: errorMessage,
      details: error
    }
  }
}

module.exports = {
  uploadAvatar,
  selectImage,
  compressImageIfNeeded,
  uploadToCloud,
  updateUserAvatar,
  generateCloudPath,
  isCloudAvailable,
  CONFIG,
  getFileInfo
}
