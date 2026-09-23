/**
 * Xipoo 登录云函数 — 企业级标准化版本
 *
 * 功能：
 *   - 微信 OPENID 登录 / 自动注册
 *   - 统一错误码体系（对齐 shared/errorCodes.js）
 *   - 数据库重试 + 降级策略
 *   - 结构化日志输出
 *
 * 规范对齐：CloudBase CloudFunction 最佳实践
 */
const cloud = require('wx-server-sdk')

// ========== 初始化 ==========
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// ========== 配置 ==========
const CONFIG = {
  DB_RETRY_MAX: 2,           // 数据库操作最大重试次数
  DB_RETRY_DELAY_MS: 300,    // 重试间隔
  COLLECTION_USERS: 'users',
  DEFAULT_NAME: 'Xipoo User',
  VERSION: 'login-v2-20260720'
}

// ========== 错误码（对齐 shared/errorCodes.js） ==========
const ERROR_CODES = {
  NO_OPENID:      'AUTH_NO_OPENID',
  DB_READ_FAILED: 'DB_READ_FAILED',
  DB_WRITE_FAILED: 'DB_WRITE_FAILED',
  DB_COLLECTION_NOT_FOUND: 'DB_COLLECTION_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED:   'RATE_LIMITED'
}

// ========== 工具函数 ==========

/**
 * 延迟 Promise
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 数据库操作重试包装器
 * @param {Function} fn - 返回 Promise 的数据库操作
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise}
 */
async function withRetry(fn, maxRetries = CONFIG.DB_RETRY_MAX) {
  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await delay(CONFIG.DB_RETRY_DELAY_MS)
      return await fn()
    } catch (err) {
      lastError = err
      // 集合不存在 → 不重试
      if (err && err.errCode === -502005) {
        console.error(`[login] 集合不存在 (attempt ${attempt}/${maxRetries}):`, err.message)
        throw err
      }
      // 超时 → 重试
      if (err && (err.errCode === -1 || String(err.message || '').includes('timeout'))) {
        console.warn(`[login] 数据库超时，重试 ${attempt}/${maxRetries}:`, err.message)
        continue
      }
      // 网络错误 → 重试
      if (err && String(err.message || '').includes('ETIMEDOUT')) {
        console.warn(`[login] 网络错误，重试 ${attempt}/${maxRetries}:`, err.message)
        continue
      }
      throw err
    }
  }
  throw lastError
}

/**
 * 构建统一错误响应
 */
function errorResponse(code, message, detail = null) {
  return {
    ok: false,
    version: CONFIG.VERSION,
    code,
    message,
    detail: detail ? String(detail) : null
  }
}

/**
 * 构建统一成功响应
 */
function successResponse(data) {
  return {
    ok: true,
    version: CONFIG.VERSION,
    ...data
  }
}

/**
 * 标准化用户头像（取名字首字母）
 */
function normalizeAvatar(name, avatarUrl) {
  if (avatarUrl) return avatarUrl
  if (name && name !== CONFIG.DEFAULT_NAME) {
    return name.substring(0, 1).toUpperCase() || 'X'
  }
  return 'X'
}

/**
 * 生成 Xipoo ID
 */
function createXipooId() {
  const ts = Date.now().toString().slice(-6)
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
  return `XP${ts}${rand}`
}

/**
 * 构建公开用户数据
 */
function publicUser(record) {
  return {
    id: record.xipooId || '',
    openid: record.openid || '',
    unionid: record.unionid || '',
    phone: record.phone || '',
    name: record.name || CONFIG.DEFAULT_NAME,
    school: record.school || '',
    age: record.age || '',
    gender: record.gender || '',
    degree: record.degree || '',
    major: record.major || 'Not filled',
    avatar: record.avatar || 'X',
    avatarUrl: record.avatarUrl || '',
    bio: record.bio || '',
    signature: record.signature || '',
    featureTags: record.featureTags || [],
    profileTheme: record.profileTheme || 'mint',
    profileVisibility: record.profileVisibility || {
      gender: false, degree: false, major: false, school: false, tags: false, bio: false
    },
    buddyWechatId: record.buddyWechatId || '',
    subscriptions: record.subscriptions || [],
    wechatBound: true
  }
}

// ========== 主入口 ==========
exports.main = async (event = {}) => {
  const startTime = Date.now()

  try {
    // ---------- 1. 获取微信上下文 ----------
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID
    const unionid = wxContext.UNIONID || ''
    const appid = wxContext.APPID || ''

    if (!openid) {
      console.error('[login] 无 OPENID — 可能从非小程序环境调用')
      return errorResponse(
        ERROR_CODES.NO_OPENID,
        'No OPENID. Please call login from the mini program, not cloud test.'
      )
    }

    console.log('[login] 登录请求:', {
      openid: openid.substring(0, 8) + '***',
      appid,
      hasUnionid: !!unionid,
      hasProfile: !!(event.profile && event.profile.nickName)
    })

    // ---------- 2. 获取微信用户信息 ----------
    const wxNickName = (event.profile && event.profile.nickName) || ''
    const wxAvatarUrl = (event.profile && event.profile.avatarUrl) || ''
    const displayName = wxNickName || CONFIG.DEFAULT_NAME
    const displayAvatar = normalizeAvatar(displayName, wxAvatarUrl)

    // ---------- 3. 查找已有用户 ----------
    // users 集合由部署流程预先创建。每次登录额外探测一次集合会增加一次数据库
    // 往返，在冷启动时还会与登录读写请求竞争资源。
    const found = await withRetry(() =>
      db.collection(CONFIG.COLLECTION_USERS)
        .where({ openid })
        .limit(1)
        .get()
    )

    let record = found.data && found.data[0]

    // ---------- 4. 更新或创建 ----------
    const now = db.serverDate()

    if (record) {
      // --- 已有用户：更新登录信息 ---
      console.log('[login] 已有用户登录:', { xipooId: record.xipooId })
      const updateData = {
        unionid: unionid || record.unionid || '',
        name: record.name && record.name !== CONFIG.DEFAULT_NAME && record.name !== 'X' ? record.name : displayName,
        avatar: record.avatar && record.avatar !== 'X' ? record.avatar : displayAvatar,
        avatarUrl: record.avatarUrl || wxAvatarUrl || '',
        lastLoginAt: now,
        updatedAt: now
      }

      await withRetry(() =>
        db.collection(CONFIG.COLLECTION_USERS).doc(record._id).update({
          data: updateData
        })
      )

      // 合并最新数据用于返回
      record = Object.assign({}, record, updateData)
    } else {
      // --- 新用户：创建记录 ---
      console.log('[login] 新用户注册')
      const xipooId = createXipooId()

      record = {
        openid,
        unionid,
        xipooId,
        phone: '',
        name: displayName,
        school: '',
        age: '',
        gender: '',
        degree: '',
        major: 'Not filled',
        avatar: displayAvatar,
        avatarUrl: wxAvatarUrl,
        bio: '',
        signature: '',
        featureTags: [],
        profileTheme: 'mint',
        profileVisibility: {
          gender: false, degree: false, major: false, school: false, tags: false, bio: false
        },
        buddyWechatId: '',
        subscriptions: [],
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      }

      const created = await withRetry(() =>
        db.collection(CONFIG.COLLECTION_USERS).add({ data: record })
      )
      record._id = created._id
    }

    // ---------- 5. 构建响应 ----------
    const user = publicUser(record)
    const sessionToken = `cloud-${openid}-${Date.now()}`

    const elapsedMs = Date.now() - startTime
    console.log('[login] 登录成功:', {
      xipooId: user.id,
      name: user.name,
      isNew: !!(!found.data || found.data.length === 0),
      elapsedMs
    })

    return successResponse({
      session: {
        token: sessionToken,
        userId: user.id,
        openid
      },
      user
    })

  } catch (error) {
    const elapsedMs = Date.now() - startTime

    // 数据库集合不存在
    if (error && error.errCode === -502005) {
      console.error('[login] 数据库集合不存在:', error.message)
      return errorResponse(
        ERROR_CODES.DB_COLLECTION_NOT_FOUND,
        `Collection '${CONFIG.COLLECTION_USERS}' not found. Please create it in CloudBase console.`,
        error.message
      )
    }

    // 数据库读取失败
    if (error && (error.errCode === -1 || String(error.message || '').includes('ETIMEDOUT'))) {
      console.error('[login] 数据库超时:', error.message)
      return errorResponse(
        ERROR_CODES.DB_READ_FAILED,
        'Database operation timed out. Please try again.',
        error.message
      )
    }

    // 限流（云函数并发限制）
    if (error && error.errCode === -504002) {
      console.error('[login] 云函数未找到 (errCode -504002):', error.message)
      return errorResponse(
        ERROR_CODES.INTERNAL_ERROR,
        'Login function not deployed. Please run `tcb deploy login` in cloudfunctions folder.',
        error.message
      )
    }

    // 未知错误
    console.error('[login] 未知错误:', {
      message: error.message,
      errCode: error.errCode,
      errMsg: error.errMsg,
      stack: error.stack,
      elapsedMs
    })

    return errorResponse(
      ERROR_CODES.INTERNAL_ERROR,
      error.message || error.errMsg || 'Cloud login failed. Please try again.',
      error.stack ? error.stack.substring(0, 500) : null
    )
  }
}
