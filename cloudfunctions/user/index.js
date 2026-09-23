const cloud = require('wx-server-sdk')
const secCheck = require('./secCheck')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const users = db.collection('users')

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

// 默认可见性，与前端 mockBackend 保持一致
function defaultVisibility() {
  return { gender: true, degree: true, major: true, school: true, tags: true, bio: true }
}

// 把云库里的 user 记录转成前端「我的」页需要的形状（对齐 mockBackend.ownUser）
function toOwnUser(record) {
  if (!record) return null
  const phone = record.phone
    ? String(record.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    : ''
  return {
    id: record.xipooId,
    openid: record.openid || '',
    unionid: record.unionid || '',
    phone,
    name: record.name || 'Xipoo User',
    school: record.school || 'XJTLU',
    age: record.age || '',
    degree: record.degree || '',
    major: record.major || '',
    grade: record.grade || '',
    gender: record.gender || '',
    avatar: record.avatar || 'X',
    avatarUrl: record.avatarUrl || '',
    coverUrl: record.coverUrl || '',
    bio: record.bio || '',
    signature: record.signature || '',
    featureTags: Array.isArray(record.featureTags) ? record.featureTags : [],
    selectedTags: Array.isArray(record.selectedTags) ? record.selectedTags : [],
    profileTheme: record.profileTheme || 'mint',
    profileVisibility: Object.assign(defaultVisibility(), record.profileVisibility || {}),
    buddyWechatId: record.buddyWechatId || '',
    subscriptions: Array.isArray(record.subscriptions) ? record.subscriptions : [],
    wechatBound: Boolean(record.openid),
    tags: Array.isArray(record.tags) ? record.tags : [],
    showcaseImages: Array.isArray(record.showcaseImages) ? record.showcaseImages : []
  }
}

async function findByOpenid(openid) {
  const found = await users.where({ openid }).limit(1).get()
  return (found.data && found.data[0]) || null
}

async function getProfile(openid) {
  const record = await findByOpenid(openid)
  if (!record) {
    return fail('USER_NOT_FOUND', '用户不存在，请重新登录')
  }
  return ok(toOwnUser(record))
}

async function updateProfile(openid, payload = {}) {
  const record = await findByOpenid(openid)
  if (!record) {
    return fail('USER_NOT_FOUND', '用户不存在，请重新登录')
  }

  const p = payload || {}
  console.log('[user cloud] updateProfile payload keys:', Object.keys(p), 'tags:', p.tags, 'showcaseImages:', p.showcaseImages)
  const nextName = p.name === undefined ? (record.name || '') : String(p.name || '').trim()

  // 内容安全：仅检测本次提交发生变更的文本字段（scene=1 资料）
  const textParts = []
  if (p.name !== undefined && p.name !== record.name) textParts.push(p.name)
  if (p.signature !== undefined && p.signature !== record.signature) textParts.push(p.signature)
  if (p.bio !== undefined && p.bio !== record.bio) textParts.push(p.bio)
  if (p.major !== undefined && p.major !== record.major) textParts.push(p.major)
  if (Array.isArray(p.featureTags)) textParts.push(p.featureTags)
  if (p.buddyWechatId !== undefined && p.buddyWechatId !== record.buddyWechatId) textParts.push(p.buddyWechatId)
  if (await secCheck.isTextRisky(openid, textParts, 1)) {
    return secCheck.contentRisky()
  }
  // 内容安全：新头像图片（scene=1）
  if (typeof p.avatarUrl === 'string' && p.avatarUrl.indexOf('cloud://') === 0 && p.avatarUrl !== record.avatarUrl) {
    if (await secCheck.isImageRisky(p.avatarUrl)) {
      return secCheck.contentRisky()
    }
  }

  const nextData = {
    name: nextName,
    // updateProfile 是局部更新接口：未传字段必须保留，不能在换头像等操作时被写空。
    age: p.age === undefined ? (record.age || '') : p.age,
    degree: p.degree === undefined ? (record.degree || '') : p.degree,
    major: p.major === undefined ? (record.major || '') : p.major,
    grade: p.grade === undefined ? (record.grade || '') : String(p.grade || '').trim(),
    school: p.school === undefined ? (record.school || 'XJTLU') : p.school,
    gender: p.gender === undefined ? (record.gender || '') : p.gender,
    bio: p.bio === undefined ? (record.bio || '') : p.bio,
    signature: p.signature === undefined ? (record.signature || '') : p.signature,
    featureTags: p.featureTags === undefined
      ? (Array.isArray(record.featureTags) ? record.featureTags : [])
      : Array.from(new Set((p.featureTags || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 8),
    selectedTags: p.selectedTags === undefined
      ? (Array.isArray(record.selectedTags) ? record.selectedTags : [])
      : (Array.isArray(p.selectedTags) ? p.selectedTags.slice(0, 10) : []),
    profileTheme: p.profileTheme === undefined ? (record.profileTheme || 'mint') : p.profileTheme,
    profileVisibility: Object.assign(
      defaultVisibility(),
      record.profileVisibility || {},
      p.profileVisibility || {}
    ),
    buddyWechatId: p.buddyWechatId === undefined
      ? (record.buddyWechatId || '')
      : String(p.buddyWechatId || '').trim(),
    tags: p.tags === undefined
      ? (Array.isArray(record.tags) ? record.tags : [])
      : (Array.isArray(p.tags) ? p.tags.slice(0, 10) : []),
    showcaseImages: p.showcaseImages === undefined
      ? (Array.isArray(record.showcaseImages) ? record.showcaseImages : [])
      : (Array.isArray(p.showcaseImages) ? p.showcaseImages.slice(0, 3) : []),
    updatedAt: db.serverDate()
  }
  nextData.avatar = nextName ? nextName.substring(0, 1).toUpperCase() : (record.avatar || 'X')
  nextData.avatarUrl = p.avatarUrl !== undefined ? p.avatarUrl : (record.avatarUrl || '')
  nextData.coverUrl = p.coverUrl !== undefined ? p.coverUrl : (record.coverUrl || '')

  await users.doc(record._id).update({ data: nextData })

  const merged = Object.assign({}, record, nextData)
  return ok(toOwnUser(merged))
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const { action, payload = {} } = event || {}

    if (!openid && action !== 'ping') {
      return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')
    }

    switch (action) {
      case 'ping':
        return ok({ openid, appid: wxContext.APPID, env: wxContext.ENV, time: Date.now() })

      case 'getProfile':
        return await getProfile(openid)

      case 'updateProfile':
        return await updateProfile(openid, payload)

      case 'uploadAvatar': {
        const { fileID } = payload || {}
        console.log('[user cloud] uploadAvatar, fileID:', fileID)
        if (!fileID) return fail('INVALID_PARAMS', '缺少文件ID')
        // 内容安全：头像图片检测
        if (await secCheck.isImageRisky(fileID)) {
          return secCheck.contentRisky()
        }
        const record = await findByOpenid(openid)
        if (!record) return fail('USER_NOT_FOUND', '用户不存在')
        // avatar 字段应是首字母（用于降级显示），不应被 fileID 覆盖
        const nameFirstLetter = (record.name || 'X').substring(0, 1).toUpperCase()
        await users.doc(record._id).update({
          data: {
            avatarUrl: fileID,
            avatar: record.avatar || nameFirstLetter,
            updatedAt: db.serverDate()
          }
        })
        return ok({ avatarUrl: fileID, avatar: record.avatar || nameFirstLetter })
      }

      default:
        return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[user cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
