/**
 * Resolve a CloudBase file ID on a record to a temporary URL usable by <image>.
 * Non-cloud values and all resolution failures are deliberately left unchanged so
 * a decorative image can never prevent its containing page from rendering.
 */
function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0
}

// 管理端偶尔会把电脑上的文件路径（如 C:\\Users\\...）误存到数据库。
// 这类路径对小程序不可见，<image> 会把它转给开发者工具的本地服务器并持续报错。
// wxfile:// 是小程序临时文件路径，不能与 Windows 盘符路径混为一谈。
function isUnsupportedLocalPath(value) {
  if (typeof value !== 'string') return false
  const source = value.trim().replace(/^['"]+|['"]+$/g, '')
  return /^(?:[a-z]:[\\/]|\\\\|file:\/\/)/i.test(source)
}

function sanitizeImageSource(value) {
  return isUnsupportedLocalPath(value) ? '' : value
}

function getCloudApi() {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    return null
  }
  return wx.cloud
}

async function resolveCloudImage(record, field = 'coverUrl') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record

  const key = typeof field === 'string' && field ? field : 'coverUrl'
  const fileID = record[key]
  if (isUnsupportedLocalPath(fileID)) return Object.assign({}, record, { [key]: '' })
  if (!isCloudFileId(fileID)) return record

  const cloud = getCloudApi()
  if (!cloud) return record

  try {
    const result = await cloud.getTempFileURL({ fileList: [fileID] })
    const file = result && Array.isArray(result.fileList) ? result.fileList[0] : null
    const tempFileURL = file && file.tempFileURL

    if (typeof tempFileURL === 'string' && tempFileURL) {
      return Object.assign({}, record, { [key]: tempFileURL })
    }
  } catch (error) {
    // A cover image must be optional: keep the source value if CloudBase is unavailable.
  }

  return record
}

// 模块级临时 URL 缓存：避免同一张封面在分页加载/页面刷新间重复换取。
// 微信临时 URL 有效期约 2 小时，这里保守缓存 50 分钟。
const tempUrlCache = new Map()
const TEMP_URL_TTL = 50 * 60 * 1000

/**
 * Batch variant of resolveCloudImage: collects every cloud:// file ID across
 * records, fetches all temp URLs in ONE getTempFileURL call (instead of N),
 * and caches them. Records that cannot be resolved are left unchanged.
 */
async function resolveCloudImages(records, field = 'coverUrl') {
  if (!Array.isArray(records) || !records.length) return records

  const key = typeof field === 'string' && field ? field : 'coverUrl'
  const cloud = getCloudApi()
  const now = Date.now()
  const result = records.slice()
  const pendingIndices = []

  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return
    const fileID = record[key]
    if (isUnsupportedLocalPath(fileID)) {
      result[index] = Object.assign({}, record, { [key]: sanitizeImageSource(fileID) })
      return
    }
    if (!isCloudFileId(fileID) || !cloud) return
    const cached = tempUrlCache.get(fileID)
    if (cached && cached.expiresAt > now) {
      result[index] = Object.assign({}, record, { [key]: cached.url })
    } else {
      pendingIndices.push(index)
    }
  })

  if (pendingIndices.length) {
    const uniqueIds = Array.from(new Set(pendingIndices.map((index) => records[index][key])))
    try {
      const response = await cloud.getTempFileURL({ fileList: uniqueIds })
      const files = response && Array.isArray(response.fileList) ? response.fileList : []
      const urlMap = {}
      files.forEach((file) => {
        if (file && file.fileID && typeof file.tempFileURL === 'string' && file.tempFileURL) {
          urlMap[file.fileID] = file.tempFileURL
          tempUrlCache.set(file.fileID, { url: file.tempFileURL, expiresAt: now + TEMP_URL_TTL })
        }
      })
      pendingIndices.forEach((index) => {
        const url = urlMap[records[index][key]]
        if (url) result[index] = Object.assign({}, records[index], { [key]: url })
      })
    } catch (error) {
      // Keep source values if CloudBase is unavailable.
    }
  }

  return result
}

module.exports = {
  resolveCloudImage,
  resolveCloudImages,
  isUnsupportedLocalPath
}
