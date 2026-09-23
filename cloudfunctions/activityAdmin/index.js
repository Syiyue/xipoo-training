/**
 * Xipoo Activity Admin 云函数 — 企业级标准化版本
 *
 * 功能：
 *   - 活动管理 CRUD
 *   - 发布方（Publisher）全生命周期管理
 *   - 用户举报/反馈处理
 *   - Token 认证（Base64 简化方案）
 *   - 数据库重试 + 统一错误码
 *   - HTTP 触发器兼容
 *
 * 版本：v2.0.0
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const ACCOUNTS = require('./accounts')

// ========== 初始化 ==========
// 部署到哪个环境，就连接哪个环境；避免发布后仍访问已删除的旧环境。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// ========== 配置 ==========
const CONFIG = {
  DB_RETRY_MAX: 2,
  DB_RETRY_DELAY_MS: 300,
  TOKEN_TTL_MS: 12 * 60 * 60 * 1000, // 12 小时
  VERSION: 'activityAdmin-v2-20260727',
  COLLECTIONS: {
    activities: 'activities',
    publishers: 'activity_publishers',
    reports: 'user_reports',
    feedbacks: 'feedbacks',
    users: 'users',
    registrations: 'activity_registrations',
    moderation: 'moderation_actions',
    logs: 'activity_publisher_logs',
    subscriptions: 'activity_subscriptions',
    companionAds: 'companion_ads',
    companionAdEvents: 'companion_ad_events',
    clicks: 'activity_clicks',
    reservationActivities: 'reservation_activities',
    reservationSlots: 'reservation_slots',
    reservationOrders: 'reservation_orders',
    categories: 'activity_categories',
    spaceManagers: 'space_managers'
  }
}

// ========== 集合引用 ==========
const activities = db.collection(CONFIG.COLLECTIONS.activities)
const activityPublishers = db.collection(CONFIG.COLLECTIONS.publishers)
const userReports = db.collection(CONFIG.COLLECTIONS.reports)
const feedbacksCol = db.collection(CONFIG.COLLECTIONS.feedbacks)
const usersCol = db.collection(CONFIG.COLLECTIONS.users)
const activityRegistrations = db.collection(CONFIG.COLLECTIONS.registrations)
const moderationActions = db.collection(CONFIG.COLLECTIONS.moderation)
const publisherLogs = db.collection(CONFIG.COLLECTIONS.logs)
const activitySubscriptions = db.collection(CONFIG.COLLECTIONS.subscriptions)
const companionAds = db.collection(CONFIG.COLLECTIONS.companionAds)
const companionAdEvents = db.collection(CONFIG.COLLECTIONS.companionAdEvents)
const activityClicks = db.collection(CONFIG.COLLECTIONS.clicks)
const reservationActivities = db.collection(CONFIG.COLLECTIONS.reservationActivities)
const reservationSlots = db.collection(CONFIG.COLLECTIONS.reservationSlots)
const reservationOrders = db.collection(CONFIG.COLLECTIONS.reservationOrders)
const activityCategories = db.collection(CONFIG.COLLECTIONS.categories)
const spaceManagers = db.collection(CONFIG.COLLECTIONS.spaceManagers)

// 分类一级分区（模块 4）：paispace=π空间专属；global=全站通用
const CATEGORY_SCOPES = ['paispace', 'global']

// 跳转类型（模块 2/3）：none=小程序内详情页；registrationTool=报名工具；quickReservation=快预约；
// nativeReservation=自研预约（站内预约页，不需要 AppID/路径，改配预约规则与时段）
const JUMP_TYPES = ['none', 'registrationTool', 'quickReservation', 'otherMiniProgram', 'nativeReservation']

// ========== 统一错误码 ==========
const ERROR_CODES = {
  INVALID_PARAM: 'INVALID_PARAM',
  NOT_LOGIN: 'NOT_LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  HAS_ACTIVITIES: 'HAS_ACTIVITIES',
  PUBLISHER_DISABLED: 'PUBLISHER_DISABLED',
  DELETE_FAILED: 'DELETE_FAILED',
  UPDATE_FAILED: 'UPDATE_FAILED',
  ACTION_FAILED: 'ACTION_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  QUERY_FAILED: 'QUERY_FAILED',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST'
}

// ========== 工具函数 ==========

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 数据库操作重试包装器
 */
async function withRetry(fn, maxRetries = CONFIG.DB_RETRY_MAX) {
  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await delay(CONFIG.DB_RETRY_DELAY_MS)
      return await fn()
    } catch (err) {
      lastError = err
      if (err && err.errCode === -502005) throw err // 集合不存在不重试
      if (err && (err.errCode === -1 || String(err.message || '').includes('timeout') || String(err.message || '').includes('ETIMEDOUT'))) {
        console.warn(`[activityAdmin] DB retry ${attempt}/${maxRetries}:`, err.message)
        continue
      }
      throw err
    }
  }
  throw lastError
}

/**
 * Token 签发
 */
function signToken(username) {
  const expireAt = Date.now() + CONFIG.TOKEN_TTL_MS
  const payload = `${username}:${expireAt}`
  const secret = process.env.ACTIVITY_ADMIN_TOKEN_SECRET
  if (!secret) throw new Error('ACTIVITY_ADMIN_TOKEN_SECRET 未配置')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${signature}`
}

/**
 * π空间主理人（模块 4）：ACCOUNTS 硬编码表查不到时回源 space_managers 集合。
 * 命中后组装成 publisher_admin 形态账号，现有 canAccessPublisher/canManagePublisher
 * 权限体系无需改动即可生效。
 * 安全说明：space_managers 沿用 accounts.js 的明文密码 demo 约定（内网/学生项目场景），
 * 正式上线应改为加盐哈希存储。
 */
function managerToAccount(manager) {
  if (!manager || manager.enabled === false || !manager.username) return null
  return {
    username: manager.username,
    role: 'publisher_admin',
    publisherKey: manager.publisherKey || 'pai_space',
    publisherKeys: [manager.publisherKey || 'pai_space'],
    displayName: manager.displayName || manager.username,
    isSpaceManager: true
  }
}

function canManagePaiManagers(account) {
  return isSuperAdmin(account) || canManagePublisher(account, 'pai_space')
}

async function findManagerAccount(condition) {
  try {
    const res = await withRetry(() => spaceManagers.where(condition).limit(1).get())
    return managerToAccount((res.data || [])[0])
  } catch (e) {
    return null // 集合未创建时视为无主理人
  }
}

/**
 * Token 验证（async：可能回源 space_managers）
 */
async function verifyToken(token) {
  if (!token) return null
  try {
    const parts = String(token).split('.')
    if (parts.length !== 2 || !process.env.ACTIVITY_ADMIN_TOKEN_SECRET) return null
    const decoded = Buffer.from(parts[0], 'base64url').toString('utf8')
    const expected = crypto.createHmac('sha256', process.env.ACTIVITY_ADMIN_TOKEN_SECRET).update(decoded).digest('base64url')
    if (parts[1].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null
    const idx = decoded.lastIndexOf(':')
    if (idx < 0) return null
    const username = decoded.slice(0, idx)
    const expireAt = Number(decoded.slice(idx + 1))
    if (!expireAt || Date.now() > expireAt) return null
    const account = ACCOUNTS.find(a => a.username === username)
    if (account) return account
    // 主理人账号（模块 4）：被禁用后旧 token 立即失效
    return await findManagerAccount({ username })
  } catch (_) {
    return null
  }
}

function ok(data = {}, message = 'success') {
  return { ok: true, version: CONFIG.VERSION, data, message }
}

function fail(errorCode, message) {
  return { ok: false, version: CONFIG.VERSION, errorCode, message }
}

function stripInternal(doc) {
  if (!doc) return doc
  const copy = Object.assign({}, doc)
  delete copy._id
  delete copy._openid
  return copy
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,，]/).map(v => v.trim()).filter(Boolean)
  return []
}

// 校区归一化：campus 为权威字段（'tc' | 'sip'），旧数据缺失时按 discoveryTags 中的 sip 标记推导，默认 tc
function resolvePublisherCampus(publisher) {
  if (!publisher) return 'tc'
  if (publisher.campus === 'sip' || publisher.campus === 'tc') return publisher.campus
  return (Array.isArray(publisher.discoveryTags) && publisher.discoveryTags.includes('sip')) ? 'sip' : 'tc'
}

function buildTimeString(date, start, end) {
  if (!date) return ''
  const range = start && end ? `${start}-${end}` : (start || '')
  return range ? `${date} ${range}` : date
}

// 浏览器文件输入会暴露本机绝对路径；它无法被小程序客户端读取，也不能写入活动封面字段。
function isUnsupportedLocalImagePath(value) {
  const source = String(value || '').trim().replace(/^['"]+|['"]+$/g, '')
  return /^(?:[a-z]:[\\/]|\\\\|file:\/\/)/i.test(source)
}

async function writeLog(publisherKey, action, changes, adminUser) {
  try {
    await withRetry(() =>
      publisherLogs.add({
        data: {
          publisherKey,
          action,
          changes: JSON.stringify(changes || {}),
          adminUser,
          createdAt: db.serverDate()
        }
      })
    )
  } catch (e) {
    console.warn('[activityAdmin] log write failed (non-critical):', e.message)
  }
}

async function getPublisherActivityStats(publisherKey) {
  const today = new Date().toISOString().split('T')[0]
  try {
    const res = await withRetry(() => activities.where({ publisherKey }).limit(500).get())
    const list = res.data || []
    return {
      total: list.length,
      upcoming: list.filter(a => a.date >= today).length,
      ongoing: list.filter(a => a.date === today).length,
      past: list.filter(a => a.date < today).length
    }
  } catch (_) {
    return { total: 0, upcoming: 0, ongoing: 0, past: 0 }
  }
}

// ========== Auth ==========

async function login(payload) {
  const username = String(payload.username || '').trim()
  const password = String(payload.password != null ? payload.password : '')
  if (!username || !password) return fail(ERROR_CODES.INVALID_PARAM, '请输入账号和密码')

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
  let account = ACCOUNTS.find(a => a.username === username && a.passwordHash === passwordHash)
  // 主理人账号回源（模块 4）：硬编码表查不到再查 space_managers
  if (!account) account = await findManagerAccount({ username, password })
  if (!account) return fail(ERROR_CODES.LOGIN_FAILED, '账号或密码错误')

  console.log(`[activityAdmin] 登录成功: ${account.username} (${account.role})`)

  return ok({
    token: signToken(account.username),
    username: account.username,
    displayName: account.displayName || account.username,
    role: account.role || 'publisher_admin',
    publisherKey: account.publisherKey || '',
    publisherKeys: account.publisherKeys || [],
    expiresIn: CONFIG.TOKEN_TTL_MS
  })
}

// ========== Activity CRUD ==========

// 云存储桶为「仅创建者可读写」：后台/云函数上传的封面与 Logo 对浏览器端匿名登录用户不可见，
// 客户端 getTempFileURL 拿不到临时链接。因此在云函数出口统一把 cloud:// fileID 换成 HTTPS 临时地址。
function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0
}

async function resolveCloudFileUrls(values) {
  const fileIds = Array.from(new Set((values || []).filter(isCloudFileId)))
  const urlMap = {}
  if (!fileIds.length) return urlMap
  for (let index = 0; index < fileIds.length; index += 50) {
    try {
      const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) })
      ;(result.fileList || []).forEach((file) => {
        if (file && file.fileID && file.tempFileURL) urlMap[file.fileID] = file.tempFileURL
      })
    } catch (error) {
      console.warn('[activityAdmin] image URL resolve failed:', error && error.message)
    }
  }
  return urlMap
}

async function listActivities() {
  const res = await withRetry(() => activities.orderBy('date', 'desc').limit(500).get())
  const list = (res.data || []).map(a => {
    const clean = stripInternal(a)
    clean.id = a._id
    return clean
  })
  // 封面 cloud:// → HTTPS 临时链接
  const coverMap = await resolveCloudFileUrls(list.map(a => a.coverUrl))
  list.forEach(a => { if (isCloudFileId(a.coverUrl)) a.coverUrl = coverMap[a.coverUrl] || '' })
  return ok(list)
}

async function getActivity(payload) {
  const id = payload.id
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动 id')
  try {
    const res = await withRetry(() => activities.doc(id).get())
    if (!res.data) return fail(ERROR_CODES.NOT_FOUND, '活动不存在')
    const clean = stripInternal(res.data)
    clean.id = id
    // 自研预约（模块 3）：编辑回填需要现有预约规则与时段
    try {
      const cfgRes = await withRetry(() => reservationActivities.where({ activityId: id }).limit(1).get())
      const cfg = cfgRes.data && cfgRes.data[0]
      if (cfg) {
        const slotRows = await fetchAll(reservationSlots, { activityId: id })
        clean.reservation = {
          rules: cfg.rules || '',
          rulesEn: cfg.rulesEn || '',
          slots: slotRows
            .filter((slot) => !slot.closed)
            .map((slot) => ({
              date: slot.date || '',
              start: slot.start || '',
              end: slot.end || '',
              capacity: Number(slot.capacity) || 1
            }))
            .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
        }
      }
    } catch (e) { /* 预约集合未创建时忽略，按无配置处理 */ }
    return ok(clean)
  } catch (e) {
    return fail(ERROR_CODES.NOT_FOUND, '活动不存在')
  }
}

// 自研预约（模块 3）：校验并规范化后台提交的预约配置；返回 fail 结果或规范化数据
function normalizeReservationInput(input) {
  const reservation = input || {}
  const rules = String(reservation.rules || '').trim()
  const rulesEn = String(reservation.rulesEn || '').trim()
  const rawSlots = Array.isArray(reservation.slots) ? reservation.slots : []
  const slots = rawSlots.map((slot) => ({
    date: String((slot && slot.date) || '').trim(),
    start: String((slot && slot.start) || '').trim(),
    end: String((slot && slot.end) || '').trim(),
    capacity: Number(slot && slot.capacity)
  }))
  if (!rules) return fail(ERROR_CODES.INVALID_PARAM, '自研预约活动必须填写预约规则')
  if (!slots.length) return fail(ERROR_CODES.INVALID_PARAM, '自研预约活动至少配置一个预约时段')
  for (const slot of slots) {
    if (!slot.date || !slot.start || !slot.end || !(slot.capacity >= 1)) {
      return fail(ERROR_CODES.INVALID_PARAM, '每个预约时段的日期/开始/结束必填，容量至少为 1')
    }
  }
  return { rules, rulesEn, slots }
}

// 自研预约（模块 3）：保存活动后同步 reservation_activities / reservation_slots。
// 时段按 date+start+end 匹配：匹配上的保留原 _id 并按已约数量折算 remaining；
// 未匹配的旧时段无订单则删除、有订单则保留并标记 closed；新时段 remaining=capacity。
async function syncReservationConfig(activityId, config, account) {
  const totalStock = config.slots.reduce((sum, slot) => sum + slot.capacity, 0)
  const configData = {
    activityId,
    rules: config.rules,
    rulesEn: config.rulesEn,
    totalStock,
    updatedAt: db.serverDate(),
    updatedBy: account.username
  }
  const cfgRes = await withRetry(() => reservationActivities.where({ activityId }).limit(1).get())
  const cfgDoc = cfgRes.data && cfgRes.data[0]
  if (cfgDoc) {
    await withRetry(() => reservationActivities.doc(cfgDoc._id).update({ data: configData }))
  } else {
    await withRetry(() => reservationActivities.add({ data: Object.assign({ createdAt: db.serverDate() }, configData) }))
  }

  const oldSlots = await fetchAll(reservationSlots, { activityId })
  let orders = []
  try {
    orders = await fetchAll(reservationOrders, { activityId })
  } catch (e) { /* 订单集合未创建时视为无订单 */ }
  const orderedSlotIds = new Set(orders.map((order) => order.slotId))
  const keyOf = (slot) => `${slot.date}|${slot.start}|${slot.end}`
  const oldByKey = {}
  oldSlots.forEach((slot) => { oldByKey[keyOf(slot)] = slot })

  const matchedOldIds = new Set()
  for (const slot of config.slots) {
    const old = oldByKey[keyOf(slot)]
    if (old) {
      matchedOldIds.add(old._id)
      const booked = Math.max(0, Number(old.capacity || 0) - Number(old.remaining || 0))
      const remaining = Math.max(0, slot.capacity - booked)
      await withRetry(() => reservationSlots.doc(old._id).update({
        data: { capacity: slot.capacity, remaining, closed: false }
      }))
    } else {
      await withRetry(() => reservationSlots.add({
        data: {
          activityId,
          date: slot.date,
          start: slot.start,
          end: slot.end,
          capacity: slot.capacity,
          remaining: slot.capacity,
          createdAt: db.serverDate()
        }
      }))
    }
  }
  for (const old of oldSlots) {
    if (matchedOldIds.has(old._id)) continue
    if (orderedSlotIds.has(old._id)) {
      await withRetry(() => reservationSlots.doc(old._id).update({ data: { closed: true } }))
    } else {
      await withRetry(() => reservationSlots.doc(old._id).remove())
    }
  }
}

async function saveActivity(account, payload) {
  const input = payload.activity || {}
  const titleZh = String(input.titleZh || '').trim()
  const date = String(input.date || '').trim()
  if (!titleZh) return fail(ERROR_CODES.INVALID_PARAM, '中文标题必填')
  if (!date) return fail(ERROR_CODES.INVALID_PARAM, '活动日期必填')

  const publisherKey = input.publisherKey || account.publisherKey || 'chips'
  if (!canManagePublisher(account, publisherKey)) {
    return fail(ERROR_CODES.FORBIDDEN, '无权管理该活动方的活动')
  }

  // 检查发布方是否启用
  try {
    const pub = await withRetry(() => activityPublishers.where({ key: publisherKey }).limit(1).get())
    const pubData = pub.data && pub.data[0]
    if (pubData && pubData.enabled === false) {
      return fail(ERROR_CODES.PUBLISHER_DISABLED, '该活动方已被禁用，无法创建活动')
    }
  } catch (e) { /* 集合可能不存在，允许继续 */ }

  const start = String(input.start || '').trim()
  const end = String(input.end || '').trim()
  const title = input.title ? String(input.title).trim() : titleZh
  if (isUnsupportedLocalImagePath(input.coverUrl)) {
    return fail(ERROR_CODES.INVALID_PARAM, '封面图片必须使用 https:// 地址或 cloud:// fileID，不能使用本机文件路径')
  }

  const isNew = !input.id
  const id = isNew ? `activity-${Date.now()}` : String(input.id)

  let existing = null
  if (!isNew) {
    try {
      const res = await withRetry(() => activities.doc(id).get())
      existing = res.data || null
    } catch (e) { existing = null }
  }

  const time = buildTimeString(date, start, end)
  const record = {
    id,
    publisherKey,
    category: input.category || (existing && existing.category) || 'other',
    // 二级分类（模块 4）：可选，空串表示清除；scope=paispace 的分类仅 pai_space 活动可用（下方校验）
    categoryKey: String(input.categoryKey != null ? input.categoryKey : (existing && existing.categoryKey) || '').trim(),
    typeZh: input.typeZh || (existing && existing.typeZh) || '',
    typeEn: input.typeEn || (existing && existing.typeEn) || '',
    title, titleZh,
    coverUrl: input.coverUrl || (existing && existing.coverUrl) || '',
    time, date, start, end,
    place: input.place || (existing && existing.place) || '',
    placeZh: input.placeZh || (existing && existing.placeZh) || '',
    host: input.host || (existing && existing.host) || '',
    hostZh: input.hostZh || (existing && existing.hostZh) || '',
    desc: input.desc || (existing && existing.desc) || '',
    descZh: input.descZh || (existing && existing.descZh) || '',
    // 旧版点按弹窗已下线；保存活动时同步清空历史配置。
    popupTitleZh: '',
    popupTitle: '',
    popupContentZh: '',
    popupContent: '',
    tags: toStringArray(input.tags),
    tagsZh: toStringArray(input.tagsZh),
    scheduleTag: input.scheduleTag || `${time} ${titleZh}`.trim(),
    pinned: input.pinned != null ? Boolean(input.pinned) : Boolean(existing && existing.pinned),
    polished: input.polished != null ? Boolean(input.polished) : Boolean(existing && existing.polished),
    // 发现页运营位：热门活动（顶部轮播）/ 推荐活动（双列流），后台勾选控制
    isHot: input.isHot != null ? Boolean(input.isHot) : Boolean(existing && existing.isHot),
    isRecommended: input.isRecommended != null ? Boolean(input.isRecommended) : Boolean(existing && existing.isRecommended),
    // 第三方小程序跳转（模块 2）：none 时清空跳转参数
    jumpType: JUMP_TYPES.includes(input.jumpType) ? input.jumpType : ((existing && existing.jumpType) || 'none'),
    targetShortLink: String(input.targetShortLink != null ? input.targetShortLink : (existing && existing.targetShortLink) || '').trim(),
    targetAppId: String(input.targetAppId != null ? input.targetAppId : (existing && existing.targetAppId) || '').trim(),
    targetPath: String(input.targetPath != null ? input.targetPath : (existing && existing.targetPath) || '').trim(),
    activityParams: String(input.activityParams != null ? input.activityParams : (existing && existing.activityParams) || '').trim(),
    clickCount: existing ? Number(existing.clickCount || 0) : 0,
    shareCount: existing ? Number(existing.shareCount || 0) : 0,
    likeCount: existing ? Number(existing.likeCount || 0) : 0,
    joinCount: existing ? Number(existing.joinCount || 0) : 0,
    comments: existing && Array.isArray(existing.comments) ? existing.comments : [],
    updatedBy: account.username,
    updatedAt: db.serverDate()
  }
  if (isNew) record.createdAt = db.serverDate()
  else if (existing && existing.createdAt) record.createdAt = existing.createdAt

  // 第三方跳转可使用微信复制的小程序链接，旧数据继续兼容 AppID + 页面路径。
  // none 与 nativeReservation（自研预约）都清空跳转参数。
  if (record.jumpType === 'none' || record.jumpType === 'nativeReservation') {
    record.targetShortLink = ''
    record.targetAppId = ''
    record.targetPath = ''
    record.activityParams = ''
  } else if (!record.targetShortLink && (!record.targetAppId || !record.targetPath)) {
    return fail(ERROR_CODES.INVALID_PARAM, '请填写目标小程序链接，或同时填写 AppID 和页面路径')
  }

  // 自研预约（模块 3）：预约规则与时段必填，保存主表后同步预约配置与库存
  let reservationConfig = null
  if (record.jumpType === 'nativeReservation') {
    reservationConfig = normalizeReservationInput(input.reservation)
    if (reservationConfig.ok === false) return reservationConfig
  }

  // 二级分类校验（模块 4）：paispace 分区的分类只能挂在 pai_space 活动上
  if (record.categoryKey) {
    try {
      const catRes = await withRetry(() => activityCategories.where({ key: record.categoryKey }).limit(1).get())
      const cat = catRes.data && catRes.data[0]
      if (cat && cat.scope === 'paispace' && record.publisherKey !== 'pai_space') {
        return fail(ERROR_CODES.INVALID_PARAM, 'π空间专属分类只能用于 pai_space 的活动')
      }
    } catch (e) { /* 分类集合未创建时跳过校验 */ }
  }

  await withRetry(() => activities.doc(id).set({ data: record }))
  if (reservationConfig) {
    await syncReservationConfig(id, reservationConfig, account)
  }
  console.log(`[activityAdmin] 活动${isNew ? '创建' : '更新'}: ${id} by ${account.username}`)
  return ok({ id, isNew })
}

async function deleteActivity(account, payload) {
  const id = payload.id
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动 id')
  try {
    const activity = await withRetry(() => activities.doc(id).get())
    if (!activity.data) return fail(ERROR_CODES.NOT_FOUND, '活动不存在')
    if (!canManagePublisher(account, activity.data.publisherKey)) {
      return fail(ERROR_CODES.FORBIDDEN, '无权删除该活动方的活动')
    }
    await withRetry(() => activities.doc(id).remove())
    console.log(`[activityAdmin] 活动删除: ${id}`)
    return ok({ id })
  } catch (e) {
    return fail(ERROR_CODES.DELETE_FAILED, e.message || '删除失败')
  }
}

// 轻量更新发现页运营位标记（热门轮播 / 推荐双列），不走 saveActivity 全量保存，
// 避免局部提交把 tags、封面等未传字段冲掉
async function setActivityFlags(account, payload) {
  const id = payload.id
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动 id')
  const data = {}
  if (payload.isHot != null) data.isHot = Boolean(payload.isHot)
  if (payload.isRecommended != null) data.isRecommended = Boolean(payload.isRecommended)
  if (!Object.keys(data).length) return fail(ERROR_CODES.INVALID_PARAM, '缺少要更新的标记')
  try {
    const activity = await withRetry(() => activities.doc(id).get())
    if (!activity.data) return fail(ERROR_CODES.NOT_FOUND, '活动不存在')
    if (!canManagePublisher(account, activity.data.publisherKey)) {
      return fail(ERROR_CODES.FORBIDDEN, '无权管理该活动方的活动')
    }
    data.updatedBy = account.username
    data.updatedAt = db.serverDate()
    await withRetry(() => activities.doc(id).update({ data }))
    console.log(`[activityAdmin] 活动运营标记更新: ${id} ${JSON.stringify(data)} by ${account.username}`)
    return ok({ id, isHot: data.isHot, isRecommended: data.isRecommended })
  } catch (e) {
    return fail(ERROR_CODES.UPDATE_FAILED, e.message || '操作失败')
  }
}

async function listPublishersLegacy() {
  try {
    const res = await withRetry(() => activityPublishers.limit(100).get())
    const list = (res.data || []).map(stripInternal)
    return ok(list)
  } catch (e) {
    return ok([])
  }
}

async function listActivitiesByPublisher(account, payload) {
  const filterKeys = Array.isArray(payload.publisherKeys) && payload.publisherKeys.length
    ? payload.publisherKeys
    : []
  const dateFrom = payload.dateFrom || ''
  const dateTo = payload.dateTo || ''

  const res = await withRetry(() => activities.orderBy('date', 'desc').limit(500).get())
  let list = (res.data || []).map(a => { const c = stripInternal(a); c.id = a._id; return c })

  if (dateFrom) list = list.filter(a => a.date >= dateFrom)
  if (dateTo) list = list.filter(a => a.date <= dateTo)

  let publisherMap = {}
  try {
    const pubRes = await withRetry(() => activityPublishers.limit(100).get())
    for (const p of pubRes.data || []) {
      const clean = stripInternal(p)
      publisherMap[clean.key] = clean
    }
  } catch (e) { /* ignore */ }

  const today = new Date().toISOString().split('T')[0]
  const allKeys = filterKeys.length ? filterKeys : [...new Set(list.map(a => a.publisherKey))].filter(Boolean)

  const result = {}
  for (const key of allKeys) {
    const pubActivities = list
      .filter(a => a.publisherKey === key)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    result[key] = {
      publisher: publisherMap[key] || { key, nameZh: key, name: key, _missing: true },
      totalCount: pubActivities.length,
      futureCount: pubActivities.filter(a => a.date >= today).length,
      activities: pubActivities
    }
  }
  return ok(result)
}

// 后台图片上传：走云函数服务端上传，绕开存储桶 PRIVATE ACL 的客户端限制
// payload: { base64, mime } → { fileID }
async function uploadImage(account, payload) {
  const base64 = String(payload.base64 || '')
  if (!base64) return fail(ERROR_CODES.INVALID_PARAM, '缺少图片内容')
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length) return fail(ERROR_CODES.INVALID_PARAM, '图片内容无效')
  // 3MB 上限：base64 传输约放大 1/3，留足云函数请求体余量
  if (buffer.length > 3 * 1024 * 1024) return fail(ERROR_CODES.INVALID_PARAM, '图片不能超过 3MB')
  const mimeToExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
  const ext = mimeToExt[String(payload.mime || '').toLowerCase()] || 'png'
  const cloudPath = `publishers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  try {
    const res = await cloud.uploadFile({ cloudPath, fileContent: buffer })
    console.log(`[activityAdmin] 图片上传: ${cloudPath} by ${account.username}`)
    return ok({ fileID: res.fileID, cloudPath })
  } catch (e) {
    return fail(ERROR_CODES.UPDATE_FAILED, e.message || '上传失败')
  }
}

// ========== Publisher Management ==========

async function listPublishersFull(payload = {}) {
  try {
    const res = await withRetry(() => activityPublishers.orderBy('sortWeight', 'desc').limit(100).get())
    // 后台编辑需要 _id 定位记录；stripInternal 会剥掉，这里补回（仅管理端接口，不下发openid）
    let list = (res.data || []).map(d => { const clean = stripInternal(d); clean._id = d._id; return clean })

    if (payload.status) {
      if (payload.status === 'enabled') list = list.filter(p => p.enabled !== false)
      else if (payload.status === 'disabled') list = list.filter(p => p.enabled === false)
    }
    // 按校区筛选：campus 为权威字段，旧数据缺失时回退用 discoveryTags 里的 sip 标记推导
    if (payload.campus === 'tc' || payload.campus === 'sip') {
      list = list.filter(p => resolvePublisherCampus(p) === payload.campus)
    }
    if (payload.keyword) {
      const kw = String(payload.keyword).toLowerCase()
      list = list.filter(p => (p.nameZh || '').toLowerCase().includes(kw) || (p.key || '').toLowerCase().includes(kw))
    }
    if (payload.dateFrom) list = list.filter(p => p.createdAt >= payload.dateFrom)
    if (payload.dateTo) list = list.filter(p => p.createdAt <= payload.dateTo)

    for (const p of list) {
      p.activityStats = await getPublisherActivityStats(p.key)
    }

    // Logo / 横幅 cloud:// → HTTPS 临时链接
    const logoMap = await resolveCloudFileUrls(list.map(p => p.logoUrl))
    const coverMap = await resolveCloudFileUrls(list.map(p => p.coverUrl))
    list.forEach(p => {
      if (isCloudFileId(p.logoUrl)) p.logoUrl = logoMap[p.logoUrl] || ''
      if (isCloudFileId(p.coverUrl)) p.coverUrl = coverMap[p.coverUrl] || ''
    })

    return ok(list)
  } catch (e) {
    return ok([])
  }
}

async function savePublisher(account, payload) {
  const input = payload.publisher || {}
  const key = String(input.key || '').trim()
  if (!key) return fail(ERROR_CODES.INVALID_PARAM, '活动方 key 必填')
  if (!/^[a-z0-9_]+$/i.test(key)) return fail(ERROR_CODES.INVALID_PARAM, '活动方 key 只能包含字母、数字、下划线')

  const nameZh = (input.nameZh || key).trim()
  const isNew = !input._id
  if (isNew && !isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅总管理员可新建活动方')
  if (!isNew && !canManagePublisher(account, key)) return fail(ERROR_CODES.FORBIDDEN, '无权编辑该活动方')

  if (isNew) {
    const exist = await withRetry(() => activityPublishers.where({ key }).count())
    if (exist.total > 0) return fail(ERROR_CODES.DUPLICATE_KEY, `活动方 key "${key}" 已存在`)
  }

  // 校区：campus 为权威字段；未显式传时按提交的 discoveryTags 推导，默认 tc
  const discoveryTags = toStringArray(input.discoveryTags)
  let campus = input.campus === 'sip' ? 'sip' : (input.campus === 'tc' ? 'tc' : '')
  if (!campus) campus = discoveryTags.includes('sip') ? 'sip' : 'tc'
  // 仅当提交方带了 discoveryTags（总管理员运营配置）时，回写其中的 sip 标记与 campus 保持一致，
  // 保证小程序端按 sip 标签过滤的行为不变
  if (Array.isArray(input.discoveryTags)) {
    const sipIndex = discoveryTags.indexOf('sip')
    if (campus === 'sip' && sipIndex < 0) discoveryTags.push('sip')
    if (campus === 'tc' && sipIndex >= 0) discoveryTags.splice(sipIndex, 1)
  }

  const record = {
    key,
    nameZh,
    campus,
    name: (input.name || key).trim(),
    logoUrl: input.logoUrl || '',
    coverUrl: input.coverUrl || '',
    description: input.description || '',
    descriptionZh: input.descriptionZh || '',
    color: input.color || '#6366f1',
    accent: input.accent || input.color || '#6366f1',
    icon: input.icon || '📌',
    enabled: input.enabled !== false,
    verified: Boolean(input.verified),
    tagline: input.tagline || '',
    taglineZh: input.taglineZh || '',
    // 来源渠道：未认证活动方在小程序端展示「摘自 xx」标注
    sourceChannel: input.sourceChannel || '',
    location: input.location || '',
    locationZh: input.locationZh || '',
    foundedLabel: input.foundedLabel || '',
    foundedLabelZh: input.foundedLabelZh || '',
    storyTitle: input.storyTitle || '',
    storyTitleZh: input.storyTitleZh || '',
    story: input.story || '',
    storyZh: input.storyZh || '',
    contentTags: toStringArray(input.contentTags),
    contentTagsZh: toStringArray(input.contentTagsZh),
    contactLabel: input.contactLabel || '',
    contactLabelZh: input.contactLabelZh || '',
    contactValue: input.contactValue || '',
    galleryUrls: Array.isArray(input.galleryUrls) ? input.galleryUrls : [],
    discoveryTags,
    quotaFlash: Math.max(0, Math.min(20, Number(input.quotaFlash) || 3)),
    quotaRecommend: Math.max(0, Math.min(50, Number(input.quotaRecommend) || 6)),
    sortWeight: Math.max(0, Math.min(100, Number(input.sortWeight) || 50)),
    pinned: Boolean(input.pinned),
    presetTags: toStringArray(input.presetTags),
    visibility: input.visibility || 'all',
    createdBy: isNew ? account.username : (input.createdBy || account.username),
    updatedBy: account.username,
    updatedAt: db.serverDate()
  }
  if (isNew) record.createdAt = db.serverDate()

  if (isNew) {
    await withRetry(() => activityPublishers.add({ data: record }))
  } else {
    await withRetry(() => activityPublishers.doc(input._id).update({ data: record }))
  }

  await writeLog(key, isNew ? 'create' : 'update', record, account.username)
  console.log(`[activityAdmin] 活动方${isNew ? '创建' : '更新'}: ${key} by ${account.username}`)
  return ok({ key, isNew })
}

async function togglePublisher(account, payload) {
  const key = payload.key
  const enabled = Boolean(payload.enabled)
  if (!key) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动方 key')
  if (!canManagePublisher(account, key)) return fail(ERROR_CODES.FORBIDDEN, '无权修改该活动方')
  try {
    const res = await withRetry(() => activityPublishers.where({ key }).limit(1).get())
    if (!res.data || !res.data.length) return fail(ERROR_CODES.NOT_FOUND, '活动方不存在')
    await withRetry(() =>
      activityPublishers.doc(res.data[0]._id).update({
        data: { enabled, updatedBy: account.username, updatedAt: db.serverDate() }
      })
    )
    await writeLog(key, enabled ? 'enable' : 'disable', { enabled }, account.username)
    return ok({ key, enabled })
  } catch (e) {
    return fail(ERROR_CODES.UPDATE_FAILED, e.message || '操作失败')
  }
}

async function deletePublisher(account, payload) {
  const key = payload.key
  if (!key) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动方 key')
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅总管理员可删除活动方')
  try {
    const count = await withRetry(() => activities.where({ publisherKey: key }).count())
    if (count.total > 0) {
      return fail(ERROR_CODES.HAS_ACTIVITIES,
        `当前存在 ${count.total} 条归属该活动方的活动，无法删除。请先迁移或删除关联活动。`)
    }
    const res = await withRetry(() => activityPublishers.where({ key }).limit(1).get())
    if (!res.data || !res.data.length) return fail(ERROR_CODES.NOT_FOUND, '活动方不存在')
    await withRetry(() => activityPublishers.doc(res.data[0]._id).remove())
    await writeLog(key, 'delete', { key }, account.username)
    return ok({ key })
  } catch (e) {
    if (e.errorCode === ERROR_CODES.HAS_ACTIVITIES) return fail(ERROR_CODES.HAS_ACTIVITIES, e.message)
    return fail(ERROR_CODES.DELETE_FAILED, e.message || '删除失败')
  }
}

async function batchUpdatePublishers(account, payload) {
  const { keys = [], updates = {} } = payload
  if (!keys.length) return fail(ERROR_CODES.INVALID_PARAM, '请选择至少一个活动方')
  if (!keys.every(key => canManagePublisher(account, key))) return fail(ERROR_CODES.FORBIDDEN, '包含无权管理的活动方')

  const data = { updatedBy: account.username, updatedAt: db.serverDate() }
  if (updates.enabled !== undefined) data.enabled = Boolean(updates.enabled)
  if (updates.sortWeight !== undefined) data.sortWeight = Math.max(0, Math.min(100, Number(updates.sortWeight)))
  if (updates.quotaFlash !== undefined) data.quotaFlash = Math.max(0, Math.min(20, Number(updates.quotaFlash)))
  if (updates.quotaRecommend !== undefined) data.quotaRecommend = Math.max(0, Math.min(50, Number(updates.quotaRecommend)))

  let updated = 0
  for (const key of keys) {
    try {
      const res = await withRetry(() => activityPublishers.where({ key }).limit(1).get())
      if (res.data && res.data.length) {
        await withRetry(() => activityPublishers.doc(res.data[0]._id).update({ data }))
        updated++
      }
    } catch (e) { /* 跳过失败项 */ }
  }
  await writeLog('batch', 'batch_update', { keys, updates }, account.username)
  console.log(`[activityAdmin] 批量更新活动方: ${updated}/${keys.length}`)
  return ok({ updated, total: keys.length })
}

async function getPublisherStats() {
  try {
    const pubRes = await withRetry(() => activityPublishers.limit(100).get())
    const pubs = pubRes.data || []
    const enabled = pubs.filter(p => p.enabled !== false).length
    const disabled = pubs.filter(p => p.enabled === false).length

    let totalActivities = 0
    for (const p of pubs) {
      try {
        const count = await withRetry(() => activities.where({ publisherKey: p.key }).count())
        totalActivities += count.total || 0
      } catch (e) { /* ignore */ }
    }

    return ok({
      totalPublishers: pubs.length,
      enabled,
      disabled,
      totalActivities,
      tc: pubs.filter(p => resolvePublisherCampus(p) === 'tc').length,
      sip: pubs.filter(p => resolvePublisherCampus(p) === 'sip').length
    })
  } catch (e) {
    return ok({ totalPublishers: 0, enabled: 0, disabled: 0, totalActivities: 0, tc: 0, sip: 0 })
  }
}

async function getPublisherLogs(payload = {}) {
  try {
    let query = publisherLogs.orderBy('createdAt', 'desc').limit(200)
    if (payload.publisherKey) {
      query = publisherLogs.where({ publisherKey: payload.publisherKey }).orderBy('createdAt', 'desc').limit(200)
    }
    const res = await withRetry(() => query.get())
    const list = (res.data || []).map(r => {
      const clean = stripInternal(r)
      clean.id = r._id
      clean.changesParsed = (() => {
        try { return JSON.parse(clean.changes || '{}') } catch (e) { return {} }
      })()
      return clean
    })
    return ok(list)
  } catch (e) {
    return ok([])
  }
}

// ========== Reports / Feedback ==========

async function listReports(payload) {
  try {
    const res = await withRetry(() =>
      userReports.where({ type: db.command.neq('feedback') }).orderBy('createdAt', 'desc').limit(500).get()
    )
    let list = (res.data || []).map(r => { const c = stripInternal(r); c.id = r._id; return c })
    if (payload.status) list = list.filter(r => r.status === payload.status)
    return ok(list)
  } catch (e) { return ok([]) }
}

async function getReportDetail(payload) {
  const id = payload.id
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少举报 id')
  try {
    const res = await withRetry(() => userReports.doc(id).get())
    if (!res.data) return fail(ERROR_CODES.NOT_FOUND, '举报不存在')
    const clean = stripInternal(res.data); clean.id = id
    try {
      if (clean.reporterUserId) {
        const u = await withRetry(() => usersCol.where({ xipooId: clean.reporterUserId }).limit(1).get())
        if (u.data && u.data.length) clean.reporterName = u.data[0].name || clean.reporterUserId
      }
      if (clean.reportedUserId) {
        const u = await withRetry(() => usersCol.where({ xipooId: clean.reportedUserId }).limit(1).get())
        if (u.data && u.data.length) clean.reportedName = u.data[0].name || clean.reportedUserId
      }
    } catch (e) { /* ignore */ }
    return ok(clean)
  } catch (e) { return fail(ERROR_CODES.NOT_FOUND, '举报不存在') }
}

async function resolveReport(account, payload) {
  const id = payload.id
  const newStatus = payload.status || 'resolved'
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少举报 id')
  if (!['resolved', 'ignored'].includes(newStatus)) return fail(ERROR_CODES.INVALID_PARAM, '状态无效')
  try {
    await withRetry(() =>
      userReports.doc(id).update({
        data: {
          status: newStatus,
          adminNote: String(payload.adminNote || '').trim(),
          resolvedBy: account.username,
          resolvedAt: db.serverDate()
        }
      })
    )
    return ok({ id, status: newStatus })
  } catch (e) { return fail(ERROR_CODES.UPDATE_FAILED, e.message || '更新失败') }
}

async function listFeedbacks(payload) {
  // 反馈有两个来源：buddy 云函数写入的 user_reports(type=feedback)，
  // 以及小程序反馈中心写入的独立 feedbacks 集合（含图片/分类）。合并展示。
  let legacy = []
  try {
    const res = await withRetry(() =>
      userReports.where({ type: 'feedback' }).orderBy('createdAt', 'desc').limit(500).get()
    )
    legacy = (res.data || []).map(r => {
      const c = stripInternal(r)
      c.id = r._id
      c.source = 'user_reports'
      return c
    })
  } catch (e) { /* 集合可能不存在 */ }

  let center = []
  try {
    const res = await withRetry(() => feedbacksCol.orderBy('createdAt', 'desc').limit(500).get())
    center = (res.data || []).map(r => {
      const c = stripInternal(r)
      c.id = r._id
      c.source = 'feedbacks'
      c.detail = c.content || ''
      c.reason = c.type || '用户反馈'
      return c
    })
  } catch (e) { /* 集合可能不存在 */ }

  let list = legacy.concat(center).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  if (payload.status) list = list.filter(r => (r.status || 'pending') === payload.status)
  return ok(list)
}

async function resolveFeedback(account, payload) {
  const id = payload.id
  const newStatus = payload.status || 'resolved'
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少反馈 id')
  if (!['resolved', 'ignored'].includes(newStatus)) return fail(ERROR_CODES.INVALID_PARAM, '状态无效')
  const data = {
    status: newStatus,
    adminNote: String(payload.adminNote || '').trim(),
    resolvedBy: account.username,
    resolvedAt: db.serverDate()
  }
  // feedbacks 集合与 user_reports 集合的文档 id 命名不同，按来源集合分别更新
  const targetCol = payload.source === 'feedbacks' ? feedbacksCol : userReports
  try {
    await withRetry(() => targetCol.doc(id).update({ data }))
    return ok({ id, status: newStatus })
  } catch (e) { return fail(ERROR_CODES.UPDATE_FAILED, e.message || '更新失败') }
}

// ========== AI 识图录入（豆包视觉优先，混元回退） ==========
// 豆包通过火山方舟 OpenAI 兼容接口调用，密钥只从 ARK_API_KEY 环境变量读取。
const https = require('https')

function postJson(url, headers, body, timeoutMs = 100000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }, headers),
      timeout: timeoutMs
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch (e) { reject(new Error(`AI 接口返回非 JSON: ${raw.slice(0, 200)}`)) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('AI 接口请求超时')))
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

const AI_IMPORT_PROMPT = `你是校园活动海报/日程截图的信息提取助手。请从图片中提取活动信息，只输出一个 JSON 对象（不要使用 markdown 代码块），字段如下：
titleZh（中文标题，必填）、title（英文标题，尽量从海报提取；没有则根据中文标题翻译）、
date（活动日期，YYYY-MM-DD）、start（开始时间，HH:mm）、end（结束时间，HH:mm）、
placeZh（中文地点）、place（英文地点，没有则翻译）、
hostZh（主办方中文名）、host（主办方英文名，没有则翻译）、
descZh（中文活动描述，100 字以内）、desc（英文活动描述，两句话以内，根据中文翻译）、
tagsZh（中文标签数组，最多 5 个）、tags（英文标签数组，与中文标签对应翻译）、
category（从 sports / academic / culture / career / social / other 中选一个）、
typeZh（活动类型中文，如 讲座 / 工作坊 / 比赛）、typeEn（活动类型英文，如 Lecture / Workshop / Contest）。
确实无法确定的字段输出空字符串或空数组，不要编造具体人名、电话、地址。`

async function callDoubaoVision(base64, mime, prompt) {
  const apiKey = String(process.env.ARK_API_KEY || '').trim()
  if (!apiKey) throw new Error('ARK_API_KEY 未配置')
  const endpoint = process.env.ARK_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
  const model = process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215'
  const response = await postJson(endpoint, { Authorization: `Bearer ${apiKey}` }, {
    model,
    temperature: 0.1,
    max_tokens: 1800,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
      { type: 'text', text: prompt }
    ] }]
  }, 100000)
  if (response.status < 200 || response.status >= 300) {
    const detail = response.body && (response.body.error && response.body.error.message || response.body.message)
    throw new Error(`豆包接口 ${response.status}${detail ? `：${detail}` : ''}`)
  }
  return response.body && response.body.choices && response.body.choices[0] && response.body.choices[0].message && response.body.choices[0].message.content
}

async function aiImportActivity(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权使用 AI 录入')

  let base64 = payload.imageBase64
  let mime = payload.mimeType || 'image/jpeg'
  if (!base64) {
    const fileID = String(payload.fileID || '').trim()
    if (!fileID) return fail(ERROR_CODES.INVALID_PARAM, '缺少图片')
    try {
      const downloaded = await cloud.downloadFile({ fileID })
      base64 = downloaded.fileContent.toString('base64')
      if (/\.png(\?|$)/i.test(fileID)) mime = 'image/png'
      else if (/\.webp(\?|$)/i.test(fileID)) mime = 'image/webp'
    } catch (e) {
      return fail(ERROR_CODES.NOT_FOUND, '图片下载失败，请重新上传')
    }
  }

  try {
    // 优先使用豆包视觉；未配置密钥时回退到 CloudBase 混元视觉。
    let content = null
    let doubaoError = null
    if (process.env.ARK_API_KEY) {
      try { content = await callDoubaoVision(base64, mime, AI_IMPORT_PROMPT) }
      catch (error) { doubaoError = error; console.warn('[activityAdmin] 豆包视觉不可用，回退混元:', error.message) }
    }
    if (content) {
      const draft = extractDraftJson(String(content))
      if (!draft) return fail(ERROR_CODES.ACTION_FAILED, '豆包返回格式异常，请重试')
      return ok({ draft: normalizeAiDraft(draft), provider: 'doubao' })
    }

    const configuredGroup = process.env.HUNYUAN_VISION_GROUP || ''
    const configuredModel = process.env.HUNYUAN_VISION_MODEL || ''
    const candidates = [
      [configuredGroup || 'cloudbase', configuredModel || 'hunyuan-vision'],
      ['hunyuan', configuredModel || 'hunyuan-vision'],
      ['cloudbase', 'hunyuan-vision-v2']
    ].filter((pair, index, list) => list.findIndex((item) => item[0] === pair[0] && item[1] === pair[1]) === index)
    let res = null
    let lastError = null
    for (const [group, model] of candidates) {
      try {
        const aiModel = getAiApp().ai().createModel(group)
        res = await aiModel.generateText({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          { type: 'text', text: AI_IMPORT_PROMPT }
        ]
      }],
          temperature: 0.1
        })
        if (res) break
      } catch (error) {
        lastError = error
        console.warn(`[activityAdmin] 视觉模型 ${group}/${model} 不可用，尝试下一个:`, error.message)
      }
    }
    if (!res && lastError) throw lastError
    const fallbackContent = res && (res.text || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))
    if (!fallbackContent) {
      if (doubaoError && !lastError) throw doubaoError
      console.error('[activityAdmin] 混元视觉返回异常:', JSON.stringify(res || {}).slice(0, 500))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 识别失败，请换一张更清晰的海报')
    }
    const draft = extractDraftJson(String(fallbackContent))
    if (!draft) {
      console.error('[activityAdmin] 混元识图返回格式异常:', String(fallbackContent || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    return ok({ draft: normalizeAiDraft(draft) })
  } catch (e) {
    console.error('[activityAdmin] 混元识图调用失败:', e.message)
    const status403 = /403/.test(String((e && e.response && e.response.status) || e.message || ''))
    if (status403) {
      return fail(ERROR_CODES.ACTION_FAILED, '豆包/混元视觉模型不可用（403）。请检查 CloudBase 中的 ARK_API_KEY、ARK_MODEL 配置，或改用文字录入')
    }
    return fail(ERROR_CODES.ACTION_FAILED, `AI 识别失败：${e.message}`)
  }
}

// ========== AI 语音/文字录入（混元大模型，CloudBase AI） ==========
// 环境为「小程序成长计划」，混元仅允许云开发 SDK 调用（HTTP 网关会报 AI_CHANNEL_NOT_ALLOWED），
// 因此这里用 @cloudbase/node-sdk 的 app.ai()，无需 API Key（云函数运行时自带凭证）。
// 可用环境变量覆盖：HUNYUAN_GROUP（默认 cloudbase）、HUNYUAN_MODEL（默认 hy3-preview）。
const tcb = require('@cloudbase/node-sdk')
let _aiApp = null
function getAiApp() {
  if (!_aiApp) _aiApp = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV })
  return _aiApp
}

const AI_VOICE_PARSE_PROMPT = `你是校园活动信息整理助手。老师会用口语描述一个活动，请把描述整理成结构化信息，只输出一个 JSON 对象（不要使用 markdown 代码块），字段如下：
titleZh（中文标题，必填，根据描述概括）、title（英文标题，根据中文标题翻译）、
date（活动日期，YYYY-MM-DD；“明天/后天/下周X/本周X”等相对日期按今天 {TODAY} 换算）、start（开始时间，HH:mm，24 小时制）、end（结束时间，HH:mm）、
placeZh（中文地点）、place（英文地点，没有则翻译）、
hostZh（主办方中文名）、host（主办方英文名，没有则翻译）、
descZh（中文活动描述，100 字以内，口语内容书面化）、desc（英文活动描述，两句话以内，根据中文翻译）、
tagsZh（中文标签数组，最多 5 个）、tags（英文标签数组，与中文标签对应翻译）、
category（从 sports / academic / culture / career / social / other 中选一个）、
typeZh（活动类型中文，如 讲座 / 工作坊 / 比赛）、typeEn（活动类型英文，如 Lecture / Workshop / Contest）。
确实无法确定的字段输出空字符串或空数组，不要编造具体人名、电话、地址。`

function extractDraftJson(content) {
  const raw = String(content || '').trim()
  const candidates = [raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()]
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (_) {}
  }
  return null
}

// 模型输出只作为候选值，入库前统一约束类型和格式，避免异常响应污染活动数据。
function normalizeAiDraft(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const text = (key, max) => String(source[key] == null ? '' : source[key]).trim().slice(0, max)
  const list = (key) => (Array.isArray(source[key]) ? source[key] : String(source[key] || '').split(/[,，、]/))
    .map(item => String(item).trim()).filter(Boolean).slice(0, 5)
  const date = text('date', 10)
  const time = (key) => { const value = text(key, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '' }
  const categories = new Set(['sports', 'academic', 'culture', 'career', 'social', 'other'])
  return {
    titleZh: text('titleZh', 100), title: text('title', 160),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', start: time('start'), end: time('end'),
    placeZh: text('placeZh', 120), place: text('place', 160), hostZh: text('hostZh', 100), host: text('host', 140),
    descZh: text('descZh', 500), desc: text('desc', 800), tagsZh: list('tagsZh'), tags: list('tags'),
    category: categories.has(source.category) ? source.category : 'other',
    typeZh: text('typeZh', 40), typeEn: text('typeEn', 60)
  }
}

function todayCn() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // 东八区
}

// 混元文本调用公共入口（语音整理 / 对话改稿 / 简介润色共用）
async function callHunyuanText(systemPrompt, userText) {
  const group = process.env.HUNYUAN_GROUP || 'cloudbase'
  const modelName = process.env.HUNYUAN_MODEL || 'hy3-preview'
  const aiModel = getAiApp().ai().createModel(group)
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await aiModel.generateText({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
        temperature: 0.1
      })
      const text = res && (res.text || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))
      if (text) return text
      lastError = new Error('AI 返回为空')
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  throw lastError || new Error('AI 调用失败')
}

async function aiParseActivityText(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权使用 AI 录入')
  const text = String((payload && payload.text) || '').trim()
  if (!text) return fail(ERROR_CODES.INVALID_PARAM, '缺少语音转写文本')
  const input = text.slice(0, 2000)

  try {
    const content = await callHunyuanText(AI_VOICE_PARSE_PROMPT.replace('{TODAY}', todayCn()), input)
    const draft = extractDraftJson(content)
    if (!draft) {
      console.error('[activityAdmin] 混元返回格式异常:', String(content || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    return ok({ draft: normalizeAiDraft(draft) })
  } catch (e) {
    console.error('[activityAdmin] 混元调用失败:', e.message)
    return fail(ERROR_CODES.ACTION_FAILED, `AI 整理失败：${e.message}`)
  }
}

// ========== AI 对话式改稿：当前草稿 JSON + 一句修改意见 → 更新后的完整草稿 ==========
const AI_REVISE_PROMPT = `你是校园活动信息修改助手。给你一份活动信息 JSON 和一条中文修改意见，请按意见修改后输出完整的 JSON（不要使用 markdown 代码块），字段保持不变：
titleZh、title、date（YYYY-MM-DD）、start（HH:mm）、end（HH:mm）、placeZh、place、hostZh、host、descZh、desc、tagsZh（数组）、tags（数组）、category（sports/academic/culture/career/social/other 之一）、typeZh、typeEn。
规则：只改意见涉及的字段；中文内容有改动时同步更新对应英文翻译；“明天/下周X”等相对日期按今天 {TODAY} 换算；其余字段原样保留，不要编造信息。`

async function aiReviseActivityDraft(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权使用 AI 录入')
  const draft = payload && payload.draft
  const instruction = String((payload && payload.instruction) || '').trim()
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return fail(ERROR_CODES.INVALID_PARAM, '缺少草稿数据')
  if (!instruction) return fail(ERROR_CODES.INVALID_PARAM, '缺少修改意见')

  try {
    const content = await callHunyuanText(
      AI_REVISE_PROMPT.replace('{TODAY}', todayCn()),
      JSON.stringify(draft) + '\n\n修改意见：' + instruction.slice(0, 500)
    )
    const next = extractDraftJson(content)
    if (!next) {
      console.error('[activityAdmin] 改稿返回格式异常:', String(content || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    return ok({ draft: normalizeAiDraft(next) })
  } catch (e) {
    console.error('[activityAdmin] 改稿调用失败:', e.message)
    return fail(ERROR_CODES.ACTION_FAILED, `AI 改稿失败：${e.message}`)
  }
}

// ========== AI 简介润色：口语化简介 → 宣传稿文案（中英双语） ==========
const AI_POLISH_PROMPT = `你是校园活动文案助手。请把给定的活动简介润色成正式、有吸引力的宣传文案，并给出对应英文翻译。只输出一个 JSON 对象（不要使用 markdown 代码块）：{"descZh": "100字以内的中文宣传文案", "desc": "两句话以内的英文文案"}。保留原文事实信息，不要编造时间、地点、人名。`

async function aiPolishActivityDesc(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权使用 AI 录入')
  const titleZh = String((payload && payload.titleZh) || '').slice(0, 100)
  const descZh = String((payload && payload.descZh) || '').trim()
  if (!descZh) return fail(ERROR_CODES.INVALID_PARAM, '缺少简介内容')

  try {
    const content = await callHunyuanText(AI_POLISH_PROMPT, `活动标题：${titleZh}\n活动简介：${descZh.slice(0, 500)}`)
    const json = extractDraftJson(content)
    if (!json || !json.descZh) {
      console.error('[activityAdmin] 润色返回格式异常:', String(content || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    return ok({ descZh: String(json.descZh), desc: String(json.desc || '') })
  } catch (e) {
    console.error('[activityAdmin] 润色调用失败:', e.message)
    return fail(ERROR_CODES.ACTION_FAILED, `AI 润色失败：${e.message}`)
  }
}

// ========== AI 生成活动文案：一句话需求 → 活动介绍（中英双语） ==========
const AI_COPY_PROMPT = `你是校园活动文案助手。用户给出一句活动需求描述（可能很简短，如"帮我生成一份芯片学院讲座的活动介绍"），请据此写一份完整、有吸引力的活动介绍文案，并给出对应英文翻译。只输出一个 JSON 对象（不要使用 markdown 代码块）：{"descZh": "100字以内的中文活动介绍", "desc": "两句话以内的英文介绍"}。需求里没有提供的事实（时间/地点/主讲人）不要编造，用概括性描述代替。`

async function aiGenerateActivityCopy(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权使用 AI 录入')
  const brief = String((payload && payload.brief) || '').trim()
  if (!brief) return fail(ERROR_CODES.INVALID_PARAM, '缺少活动需求描述')
  const publisherKey = String((payload && payload.publisherKey) || '').trim()

  try {
    const context = publisherKey ? `活动方：${publisherKey}\n` : ''
    const content = await callHunyuanText(AI_COPY_PROMPT, context + '需求：' + brief.slice(0, 500))
    const json = extractDraftJson(content)
    if (!json || !json.descZh) {
      console.error('[activityAdmin] 生成文案返回格式异常:', String(content || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    return ok({ descZh: String(json.descZh), desc: String(json.desc || '') })
  } catch (e) {
    console.error('[activityAdmin] 生成文案调用失败:', e.message)
    return fail(ERROR_CODES.ACTION_FAILED, `AI 生成文案失败：${e.message}`)
  }
}

async function warnUser(account, payload) {  const userId = payload.userId
  const reason = String(payload.reason || '').trim()
  if (!userId) return fail(ERROR_CODES.INVALID_PARAM, '缺少用户 ID')
  try {
    await withRetry(() =>
      moderationActions.add({
        data: {
          id: `mod-${Date.now()}`,
          targetUserId: userId,
          action: 'warn',
          reason,
          reportId: payload.reportId || '',
          adminUser: account.username,
          createdAt: db.serverDate()
        }
      })
    )
    try {
      const u = await withRetry(() => usersCol.where({ xipooId: userId }).limit(1).get())
      if (u.data && u.data.length) {
        await withRetry(() => usersCol.doc(u.data[0]._id).update({ data: { status: 'warned' } }))
      }
    } catch (e) { /* ignore */ }
    return ok({ userId, action: 'warn' })
  } catch (e) { return fail(ERROR_CODES.ACTION_FAILED, e.message || '操作失败') }
}

async function banUser(account, payload) {
  const userId = payload.userId
  const reason = String(payload.reason || '').trim()
  if (!userId) return fail(ERROR_CODES.INVALID_PARAM, '缺少用户 ID')
  try {
    await withRetry(() =>
      moderationActions.add({
        data: {
          id: `mod-${Date.now()}`,
          targetUserId: userId,
          action: 'ban',
          reason,
          reportId: payload.reportId || '',
          adminUser: account.username,
          createdAt: db.serverDate()
        }
      })
    )
    try {
      const u = await withRetry(() => usersCol.where({ xipooId: userId }).limit(1).get())
      if (u.data && u.data.length) {
        await withRetry(() => usersCol.doc(u.data[0]._id).update({ data: { status: 'banned' } }))
      }
    } catch (e) { /* ignore */ }
    return ok({ userId, action: 'ban' })
  } catch (e) { return fail(ERROR_CODES.ACTION_FAILED, e.message || '操作失败') }
}

async function getUserStatus(payload) {
  const userId = payload.userId
  if (!userId) return fail(ERROR_CODES.INVALID_PARAM, '缺少用户 ID')
  try {
    const result = { userId, status: 'active', reportCount: 0, warnings: [], bans: [] }
    try {
      const u = await withRetry(() => usersCol.where({ xipooId: userId }).limit(1).get())
      if (u.data && u.data.length) {
        result.status = u.data[0].status || 'active'
        result.userName = u.data[0].name || userId
      }
    } catch (e) { /* ignore */ }
    try {
      result.reportCount = (await withRetry(() => userReports.where({ reportedUserId: userId }).count())).total || 0
    } catch (e) { /* ignore */ }
    try {
      const acts = await withRetry(() =>
        moderationActions.where({ targetUserId: userId }).orderBy('createdAt', 'desc').limit(100).get()
      )
      for (const a of (acts.data || [])) {
        if (a.action === 'warn') result.warnings.push({ reason: a.reason, adminUser: a.adminUser, createdAt: a.createdAt })
        if (a.action === 'ban') result.bans.push({ reason: a.reason, adminUser: a.adminUser, createdAt: a.createdAt })
      }
    } catch (e) { /* ignore */ }
    return ok(result)
  } catch (e) { return fail(ERROR_CODES.QUERY_FAILED, e.message || '查询失败') }
}

/**
 * 后台数据接口只返回最小必要字段。活动方管理员只能读取自己名下的报名数据与汇总，
 * 全站用户规模和用户目录只对总管理员开放。
 */
async function getRegistrationOverview(account, payload = {}) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '仅总管理员或活动方管理员可查看报名数据')
  const publisherKeys = managedPublisherKeys(account)
  const scope = publisherScopeQuery(publisherKeys)
  try {
    const [allRegistrations, allActivities] = await Promise.all([
      fetchAll(activityRegistrations, scope),
      fetchAll(activities, scope)
    ])
    const registrations = allRegistrations.filter(item => inCreatedRange(item.createdAt, payload.dateFrom, payload.dateTo))
    const uniqueUsers = new Set(registrations.map(item => item.userId).filter(Boolean))
    const activeRegistrations = registrations.filter(item => item.status !== 'cancelled')
    const publisherMap = {}
    registrations.forEach(item => {
      const key = item.publisherKey || 'unknown'
      if (!publisherMap[key]) publisherMap[key] = { publisherKey: key, registrations: 0, uniqueUsers: new Set(), activeRegistrations: 0 }
      publisherMap[key].registrations += 1
      if (item.userId) publisherMap[key].uniqueUsers.add(item.userId)
      if (item.status !== 'cancelled') publisherMap[key].activeRegistrations += 1
    })

    const trendDays = buildRecentDays(14)
    const trendMap = trendDays.reduce((map, date) => {
      map[date] = 0
      return map
    }, {})
    registrations.forEach(item => {
      const date = dateKey(item.createdAt)
      if (trendMap[date] !== undefined) trendMap[date] += 1
    })

    const totals = {
      activities: allActivities.length,
      registrations: registrations.length,
      activeRegistrations: activeRegistrations.length,
      uniqueRegisteredUsers: uniqueUsers.size
    }
    // 活动方不应获得全站用户规模及用户活跃度等跨活动方数据。
    if (isSuperAdmin(account)) {
      const users = await fetchAll(usersCol)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      totals.registeredUsers = users.length
      totals.newUsersLast7Days = users.filter(user => toTimestamp(user.createdAt) >= sevenDaysAgo).length
      totals.activeUsersLast7Days = users.filter(user => toTimestamp(user.lastActiveAt) >= sevenDaysAgo).length
    }

    return ok({
      scope: buildDataScope(account, publisherKeys),
      filters: { dateFrom: payload.dateFrom || '', dateTo: payload.dateTo || '' },
      totals,
      registrationTrend: trendDays.map(date => ({ date, registrations: trendMap[date] })),
      publisherBreakdown: Object.values(publisherMap)
        .map(item => ({
          publisherKey: item.publisherKey,
          registrations: item.registrations,
          activeRegistrations: item.activeRegistrations,
          uniqueUsers: item.uniqueUsers.size
        }))
        .sort((a, b) => b.registrations - a.registrations)
    })
  } catch (e) {
    return fail(ERROR_CODES.QUERY_FAILED, e.message || '读取报名总览失败')
  }
}

async function listUsers(account, payload = {}) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅总管理员可查看注册用户')
  try {
    const { page, pageSize } = normalizePage(payload)
    const keyword = String(payload.keyword || '').trim().toLowerCase()
    const status = String(payload.status || '').trim()
    const users = (await fetchAll(usersCol))
      .map(sanitizeAdminUser)
      .filter(user => !status || user.status === status)
      .filter(user => !keyword || `${user.xipooId} ${user.name}`.toLowerCase().includes(keyword))
    const start = (page - 1) * pageSize
    return ok({
      list: users.slice(start, start + pageSize),
      pagination: buildPagination(users.length, page, pageSize),
      fieldsNotice: '列表不包含 openid、手机号、微信号、地址或其他敏感资料'
    })
  } catch (e) {
    return fail(ERROR_CODES.QUERY_FAILED, e.message || '读取用户列表失败')
  }
}

async function listActivityRegistrations(account, payload = {}) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '仅总管理员或活动方管理员可查看报名数据')
  const publisherKeys = managedPublisherKeys(account)
  const requestedPublisher = String(payload.publisherKey || '').trim()
  if (requestedPublisher && !canAccessPublisher(account, requestedPublisher)) {
    return fail(ERROR_CODES.FORBIDDEN, '无权查看该活动方的报名数据')
  }
  try {
    const { page, pageSize } = normalizePage(payload)
    const scope = requestedPublisher ? { publisherKey: requestedPublisher } : publisherScopeQuery(publisherKeys)
    let registrations = await fetchAll(activityRegistrations, scope)
    const activityId = String(payload.activityId || '').trim()
    const status = String(payload.status || '').trim()
    registrations = registrations.filter(item => !activityId || item.activityId === activityId)
      .filter(item => !status || item.status === status)
      .filter(item => inActivityDateRange(item.date, payload.dateFrom, payload.dateTo))

    const userMap = await loadUserSummaries(registrations.map(item => item.userId).filter(Boolean))
    const start = (page - 1) * pageSize
    const list = registrations.slice(start, start + pageSize).map(item => ({
      id: item.id || item._id || '',
      activityId: item.activityId || '',
      publisherKey: item.publisherKey || '',
      title: item.title || '',
      titleEn: item.titleEn || '',
      date: item.date || '',
      time: item.time || '',
      place: item.place || '',
      placeEn: item.placeEn || '',
      status: item.status || 'registered',
      createdAt: dateValue(item.createdAt),
      user: userMap[item.userId] || { xipooId: item.userId || '', name: '', avatarUrl: '', status: 'unknown' }
    }))
    return ok({
      scope: buildDataScope(account, publisherKeys),
      list,
      pagination: buildPagination(registrations.length, page, pageSize)
    })
  } catch (e) {
    return fail(ERROR_CODES.QUERY_FAILED, e.message || '读取活动报名列表失败')
  }
}

async function exportPublishers(account, payload) {
  try {
    const res = await withRetry(() => activityPublishers.orderBy('sortWeight', 'desc').limit(100).get())
    const list = (res.data || []).map(p => ({
      key: p.key,
      nameZh: p.nameZh || p.key,
      nameEn: p.name || '',
      enabled: p.enabled !== false ? '启用' : '禁用',
      quotaFlash: p.quotaFlash || 3,
      quotaRecommend: p.quotaRecommend || 6,
      sortWeight: p.sortWeight || 50,
      pinned: p.pinned ? '是' : '否',
      visibility: p.visibility || 'all',
      createdAt: p.createdAt || ''
    }))
    return ok(list)
  } catch (e) {
    return ok([])
  }
}

async function setupDemoData(account, payload) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可初始化演示数据')
  try {
    const publisherData = {
      key: 'pai_space',
      nameZh: 'PAI空间',
      name: 'PAI Space',
      logoUrl: '/assets/publishers/paispace-logo.png',
      coverUrl: '/assets/publishers/paispace-cover.jpg',
      description: 'AI workshops, hackathons, paper reading sessions and frontier tech salons',
      descriptionZh: 'AI工作坊、黑客松、论文共读与前沿技术沙龙',
      color: '#8b5cf6',
      accent: '#a78bfa',
      icon: '🤖',
      enabled: true,
      verified: false,
      tagline: 'Ride the AI wave — turn every spark of an idea into something real',
      taglineZh: '在 AI 的浪潮里，把每一个奇思妙想变成看得见的作品',
      location: 'PAI Space, Library Building, Suzhou Campus',
      locationZh: 'PAI空间 · 苏州校区图书馆大楼',
      foundedLabel: 'AI innovation community',
      foundedLabelZh: '人工智能创新社区',
      storyTitle: 'Bringing AI from the classroom to every spark of inspiration',
      storyTitleZh: '让 AI 从课堂走进每一个灵感现场',
      story: 'PAI Space is an AI innovation community open to the whole campus: machine-learning workshops, AI hackathons, paper reading sessions and frontier tech salons. We believe AI is not the privilege of a few majors, but a new tool everyone can pick up. Here, an idea often travels from whiteboard to demo in a single evening.',
      storyZh: 'PAI空间是面向全校师生的人工智能创新社区：机器学习工作坊、AI 应用黑客松、论文共读会与前沿技术沙龙……我们相信，AI 不只是少数人的专业，而是每个人都能上手的新工具。在这里，一个想法从白板到 Demo，往往只需要一个晚上。',
      contentTags: ['AI Workshops', 'Hackathon', 'Paper Reading', 'Tech Salon'],
      contentTagsZh: ['AI工作坊', '黑客松', '论文共读', '技术沙龙'],
      contactLabel: 'Contact PAI Space',
      contactLabelZh: '联系 PAI空间小助手',
      contactValue: 'pai-space@xjtlu.edu.cn',
      galleryUrls: ['/assets/demo-activities/pingpong.jpg', '/assets/demo-activities/poster-exhibition.jpg', '/assets/demo-activities/salon-optimized.jpg'],
      discoveryTags: ['immersion', 'college'],
      quotaFlash: 5,
      quotaRecommend: 10,
      sortWeight: 60,
      pinned: false,
      presetTags: ['AI', 'workshop', 'innovation'],
      visibility: 'all',
      createdBy: account.username,
      updatedBy: account.username,
      updatedAt: db.serverDate()
    }

    const exist = await withRetry(() => activityPublishers.where({ key: 'pai_space' }).count())
    if (exist.total > 0) {
      await withRetry(() => activityPublishers.where({ key: 'pai_space' }).update({ data: publisherData }))
    } else {
      publisherData.createdAt = db.serverDate()
      await withRetry(() => activityPublishers.add({ data: publisherData }))
    }

    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7
    const thursday = new Date(today)
    thursday.setDate(today.getDate() + daysUntilThursday)
    const dateStr = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`

    const activityData = {
      id: `activity-pai-workshop-${Date.now()}`,
      publisherKey: 'pai_space',
      category: 'college',
      typeZh: '工作坊',
      typeEn: 'Workshop',
      title: 'AI Workshop: Introduction to Machine Learning',
      titleZh: 'AI工作坊：机器学习入门',
      coverUrl: '/assets/demo-activities/salon-optimized.jpg',
      time: `${dateStr} 15:00-17:00`,
      date: dateStr,
      start: '15:00',
      end: '17:00',
      place: 'PAI Space, Library Building',
      placeZh: 'PAI空间，图书馆大楼',
      host: 'PAI Space',
      hostZh: 'PAI空间',
      desc: 'An introductory workshop on machine learning concepts and hands-on practice.',
      descZh: '机器学习概念介绍与实践入门工作坊。',
      tags: ['AI', 'Machine Learning', 'Workshop', 'Technology'],
      tagsZh: ['人工智能', '机器学习', '工作坊', '技术'],
      scheduleTag: `${dateStr} 15:00-17:00 AI工作坊：机器学习入门`,
      pinned: false,
      polished: true,
      shareCount: 0,
      likeCount: 0,
      joinCount: 0,
      comments: [],
      updatedBy: account.username,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    await withRetry(() => activities.doc(activityData.id).set({ data: activityData }))

    return ok({
      publisherCreated: exist.total === 0,
      activityCreated: true,
      date: dateStr,
      message: `PAI空间活动方和${dateStr}下午3点的workshop活动已创建成功`
    })
  } catch (e) {
    return fail(ERROR_CODES.ACTION_FAILED, e.message || '演示数据创建失败')
  }
}

// ========== Main Entry ==========

// ========== 噗噗推广位（companion_ads，仅超管） ==========

const AD_SCENE_TAGS = ['free-gap', 'day-done', 'class-soon', 'weekend', 'lunch', 'dinner']
const AD_STATUS = ['draft', 'active', 'paused', 'ended']

const AI_AD_COPY_PROMPT = [
  '你是校园小程序 Xipoo 里 AI 小章鱼助手「噗噗」的推广文案撰写助手。根据运营给的卖点写 3 条候选文案。',
  '要求：',
  '1. 噗噗口吻：贴心、活泼、有一点俏皮但不过火；',
  '2. 每条中文不超过 45 字，另附一句英文（不超过 90 字符）；',
  '3. 每条文案必须直接点出卖点里的核心信息（具体地点、具体优惠内容、时间），不允许泛化成「专属优惠」「惊喜福利」这类空话；',
  '4. 不用「最」「第一」等夸大词，不含联系方式，不堆砌感叹号；',
  '5. 只输出 JSON：{"candidates":[{"copy":"...","copyEn":"..."},{"copy":"...","copyEn":"..."},{"copy":"...","copyEn":"..."}]}'
].join('\n')

async function listAds(account) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可管理推广位')
  const res = await withRetry(() => companionAds.limit(100).get())
  const list = (res.data || [])
    .map(stripInternal)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return ok({ list })
}

async function saveAd(account, payload) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可管理推广位')
  const input = (payload && payload.ad) || {}
  const title = String(input.title || '').trim()
  const copy = String(input.copy || '').trim()
  if (!title) return fail(ERROR_CODES.INVALID_PARAM, '内部名称必填')
  if (!copy) return fail(ERROR_CODES.INVALID_PARAM, '投放文案必填')

  const isNew = !input.id
  const id = isNew ? `ad-${Date.now()}` : String(input.id)
  let existing = null
  if (!isNew) {
    try {
      const res = await withRetry(() => companionAds.doc(id).get())
      existing = res.data || null
    } catch (e) { existing = null }
  }

  const record = {
    id,
    title,
    copy: copy.slice(0, 120),
    copyEn: String(input.copyEn != null ? input.copyEn : (existing && existing.copyEn) || '').slice(0, 200),
    icon: String(input.icon || (existing && existing.icon) || '🐙').slice(0, 8),
    imageUrl: input.imageUrl != null ? String(input.imageUrl) : (existing && existing.imageUrl) || '',
    action: input.action && input.action.url
      ? { kind: String(input.action.kind || 'navigate').slice(0, 20), url: String(input.action.url).slice(0, 300) }
      : null,
    sceneTags: toStringArray(input.sceneTags).filter((tag) => AD_SCENE_TAGS.includes(tag)),
    publisherKey: String(input.publisherKey != null ? input.publisherKey : (existing && existing.publisherKey) || ''),
    startAt: String(input.startAt != null ? input.startAt : (existing && existing.startAt) || ''),
    endAt: String(input.endAt != null ? input.endAt : (existing && existing.endAt) || ''),
    dailyCapPerUser: Math.max(1, Math.min(5, Number(input.dailyCapPerUser) || 1)),
    priority: 20, // 固定低于所有有机建议
    status: AD_STATUS.includes(input.status) ? input.status : ((existing && existing.status) || 'draft'),
    stats: existing && existing.stats ? existing.stats : { impressions: 0, clicks: 0 },
    updatedBy: account.username,
    updatedAt: db.serverDate()
  }
  if (isNew) record.createdAt = db.serverDate()
  else if (existing && existing.createdAt) record.createdAt = existing.createdAt

  await withRetry(() => companionAds.doc(id).set({ data: record }))
  console.log(`[activityAdmin] 推广卡片${isNew ? '创建' : '更新'}: ${id} by ${account.username}`)
  return ok({ id, isNew })
}

async function deleteAd(account, payload) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可管理推广位')
  const id = payload && payload.id
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少推广 id')
  try {
    await withRetry(() => companionAds.doc(id).remove())
    return ok({ id })
  } catch (e) {
    return fail(ERROR_CODES.DELETE_FAILED, e.message || '删除失败')
  }
}

async function setAdStatus(account, payload) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可管理推广位')
  const id = payload && payload.id
  const status = payload && payload.status
  if (!id || !AD_STATUS.includes(status)) return fail(ERROR_CODES.INVALID_PARAM, '参数不完整或状态非法')
  try {
    await withRetry(() => companionAds.doc(id).update({
      data: { status, updatedBy: account.username, updatedAt: db.serverDate() }
    }))
    return ok({ id, status })
  } catch (e) {
    return fail(ERROR_CODES.UPDATE_FAILED, e.message || '状态更新失败')
  }
}

// 近 14 天曝光/点击明细按「卡片 × 天」聚合，供后台看板
async function getAdStats(account) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可查看推广数据')
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
  const res = await withRetry(() => companionAdEvents
    .where({ createdAt: _.gte(since) })
    .limit(1000)
    .get())
  const daily = {}
  ;(res.data || []).forEach((event) => {
    const day = String(event.createdAt || '').slice(0, 10)
    const key = `${event.adId}|${day}`
    if (!daily[key]) daily[key] = { adId: event.adId, date: day, impressions: 0, clicks: 0, closes: 0 }
    if (event.type === 'impression') daily[key].impressions += 1
    else if (event.type === 'click') daily[key].clicks += 1
    else if (event.type === 'close') daily[key].closes += 1
  })
  return ok({ since, daily: Object.values(daily) })
}

// ===== 活动点击统计（模块 2） =====

// 拉取点击明细（内存聚合，量小；按日期字符串 YYYY-MM-DD 过滤）
async function fetchClicksInRange({ activityId, startDate, endDate, cap }) {
  const rows = []
  const batchSize = 100
  const maxRows = cap || 5000
  let offset = 0
  while (rows.length < maxRows) {
    const condition = {}
    if (activityId) condition.activityId = activityId
    if (startDate) condition.date = _.gte(startDate)
    if (startDate && endDate) condition.date = _.and(_.gte(startDate), _.lte(endDate))
    else if (endDate) condition.date = _.lte(endDate)
    const res = await withRetry(() => activityClicks.where(condition)
      .orderBy('createdAt', 'desc')
      .skip(offset)
      .limit(batchSize)
      .get())
    const batch = res.data || []
    rows.push(...batch)
    if (batch.length < batchSize) break
    offset += batchSize
  }
  return rows.slice(0, maxRows)
}

// 点击量总览：每个活动的累计点击（activities.clickCount）+ 日期范围内点击数
async function getActivityClickStats(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权查看点击数据')
  const startDate = String((payload && payload.startDate) || '').trim()
  const endDate = String((payload && payload.endDate) || '').trim()
  const activityId = String((payload && payload.activityId) || '').trim()

  const actRes = await withRetry(() => activities.limit(500).get())
  const scopeKeys = managedPublisherKeys(account)
  const acts = (actRes.data || [])
    .filter((item) => scopeKeys === null || scopeKeys.includes(item.publisherKey))
    .map((item) => ({
      id: item.id,
      titleZh: item.titleZh || item.title || '',
      publisherKey: item.publisherKey || '',
      jumpType: item.jumpType || 'none',
      totalClicks: Number(item.clickCount || 0)
    }))
  if (activityId && !acts.some((item) => item.id === activityId)) {
    return fail(ERROR_CODES.FORBIDDEN, '无权查看该活动的点击数据')
  }

  const clicks = await fetchClicksInRange({ activityId, startDate, endDate, cap: 5000 })
  const scopeIds = new Set(acts.map((item) => item.id))
  const rangeCount = {}
  clicks.forEach((click) => {
    if (!scopeIds.has(click.activityId)) return
    rangeCount[click.activityId] = (rangeCount[click.activityId] || 0) + 1
  })
  acts.forEach((item) => { item.rangeClicks = rangeCount[item.id] || 0 })
  acts.sort((a, b) => b.totalClicks - a.totalClicks)
  return ok({ startDate, endDate, activities: acts })
}

// 点击明细（导出报表用）：活动名称、点击时间、用户匿名标识（openid 脱敏）
async function listActivityClicks(account, payload) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权查看点击数据')
  const activityId = String((payload && payload.activityId) || '').trim()
  const startDate = String((payload && payload.startDate) || '').trim()
  const endDate = String((payload && payload.endDate) || '').trim()

  const actRes = await withRetry(() => activities.limit(500).get())
  const scopeKeys = managedPublisherKeys(account)
  const titleMap = {}
  ;(actRes.data || []).forEach((item) => {
    if (scopeKeys === null || scopeKeys.includes(item.publisherKey)) {
      titleMap[item.id] = item.titleZh || item.title || ''
    }
  })
  if (activityId && !titleMap[activityId]) return fail(ERROR_CODES.FORBIDDEN, '无权查看该活动的点击数据')

  const rows = await fetchClicksInRange({ activityId, startDate, endDate, cap: 5000 })
  const list = rows
    .filter((click) => titleMap[click.activityId])
    .map((click) => ({
      activityId: click.activityId,
      activityTitle: titleMap[click.activityId] || '',
      // openid 脱敏：保留前 4 后 2
      userTag: click.openid && click.openid.length > 8
        ? `${click.openid.slice(0, 4)}***${click.openid.slice(-2)}`
        : (click.openid || 'anonymous'),
      jumpType: click.jumpType || '',
      date: click.date || '',
      createdAt: dateValue(click.createdAt)
    }))
  return ok({ total: list.length, list })
}

// ============ 自研预约数据（模块 3） ============

// 概览：每个开启自研预约的活动 → 总预约量、各时段预约数与占比、库存余量；按发布方权限过滤
async function getReservationOverview(account, payload = {}) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权查看预约数据')
  const activityId = String((payload && payload.activityId) || '').trim()

  const actRes = await withRetry(() => activities.limit(500).get())
  const scopeKeys = managedPublisherKeys(account)
  const acts = (actRes.data || [])
    .filter((item) => item.jumpType === 'nativeReservation')
    .filter((item) => scopeKeys === null || scopeKeys.includes(item.publisherKey))
  if (activityId && !acts.some((item) => item.id === activityId)) {
    return fail(ERROR_CODES.FORBIDDEN, '无权查看该活动的预约数据')
  }
  const targetActs = activityId ? acts.filter((item) => item.id === activityId) : acts

  let slots = []
  let orders = []
  try { slots = await fetchAll(reservationSlots) } catch (e) { /* 集合未创建 */ }
  try { orders = await fetchAll(reservationOrders, {}, 50) } catch (e) { /* 集合未创建 */ }

  const list = targetActs.map((activity) => {
    const actSlots = slots.filter((slot) => slot.activityId === activity.id)
    const actOrders = orders.filter((order) => order.activityId === activity.id && order.status === 'booked')
    const openSlots = actSlots.filter((slot) => !slot.closed)
    const slotRows = actSlots
      .map((slot) => {
        const booked = actOrders.filter((order) => order.slotId === slot._id).length
        return {
          slotId: slot._id,
          date: slot.date || '',
          start: slot.start || '',
          end: slot.end || '',
          capacity: Number(slot.capacity) || 0,
          remaining: Number(slot.remaining) || 0,
          booked,
          ratio: actOrders.length ? booked / actOrders.length : 0,
          closed: Boolean(slot.closed)
        }
      })
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
    return {
      activityId: activity.id,
      titleZh: activity.titleZh || activity.title || '',
      totalBooked: actOrders.length,
      totalCapacity: openSlots.reduce((sum, slot) => sum + (Number(slot.capacity) || 0), 0),
      totalRemaining: openSlots.reduce((sum, slot) => sum + (Number(slot.remaining) || 0), 0),
      slots: slotRows
    }
  })
  return ok({ activities: list })
}

// 订单明细（分页 + 导出）：联出活动名称与时段文本，openid 脱敏（前 4 后 2，同 listActivityClicks）
async function listReservationOrders(account, payload = {}) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权查看预约数据')
  const activityId = String((payload && payload.activityId) || '').trim()
  const status = String((payload && payload.status) || '').trim()
  const startDate = String((payload && payload.startDate) || '').trim()
  const endDate = String((payload && payload.endDate) || '').trim()
  const page = Math.max(1, Number.parseInt(payload.page, 10) || 1)
  const pageSize = Math.min(5000, Math.max(1, Number.parseInt(payload.pageSize, 10) || 20))

  const actRes = await withRetry(() => activities.limit(500).get())
  const scopeKeys = managedPublisherKeys(account)
  const titleMap = {}
  ;(actRes.data || []).forEach((item) => {
    if (scopeKeys === null || scopeKeys.includes(item.publisherKey)) {
      titleMap[item.id] = item.titleZh || item.title || ''
    }
  })
  if (activityId && !titleMap[activityId]) return fail(ERROR_CODES.FORBIDDEN, '无权查看该活动的预约数据')

  let orders = []
  let slots = []
  try { orders = await fetchAll(reservationOrders, activityId ? { activityId } : {}, 50) } catch (e) { /* 集合未创建 */ }
  try { slots = await fetchAll(reservationSlots, activityId ? { activityId } : {}) } catch (e) { /* 集合未创建 */ }
  const slotMap = {}
  slots.forEach((slot) => { slotMap[slot._id] = slot })

  const filtered = orders
    .filter((order) => titleMap[order.activityId])
    .filter((order) => !status || order.status === status)
    .filter((order) => inCreatedRange(order.createdAt, startDate, endDate))
    .map((order) => {
      const slot = slotMap[order.slotId]
      return {
        orderId: order._id,
        activityId: order.activityId,
        activityTitle: titleMap[order.activityId] || '',
        slotText: slot ? `${slot.date} ${slot.start}-${slot.end}` : '',
        userTag: order.openid && order.openid.length > 8
          ? `${order.openid.slice(0, 4)}***${order.openid.slice(-2)}`
          : (order.openid || 'anonymous'),
        status: order.status || '',
        verifyStatus: order.verifyStatus || 'unused',
        createdAt: dateValue(order.createdAt),
        cancelledAt: dateValue(order.cancelledAt)
      }
    })

  const total = filtered.length
  const start = (page - 1) * pageSize
  return ok({ total, list: filtered.slice(start, start + pageSize), page, pageSize })
}

// ============ 活动分类（模块 4） ============

// 任何登录账号可读（后台表单下拉也要用）
async function listCategories(account) {
  if (!canReadActivityData(account)) return fail(ERROR_CODES.FORBIDDEN, '无权查看分类')
  try {
    const res = await withRetry(() => activityCategories.limit(200).get())
    const list = (res.data || [])
      .map((item) => ({
        id: item._id,
        scope: item.scope || 'global',
        key: item.key || '',
        nameZh: item.nameZh || '',
        nameEn: item.nameEn || '',
        sort: Number(item.sort) || 0,
        enabled: item.enabled !== false
      }))
      .sort((a, b) => (a.scope === b.scope ? a.sort - b.sort : a.scope.localeCompare(b.scope)))
    return ok({ list })
  } catch (e) {
    return ok({ list: [] }) // 集合未创建时按空列表
  }
}

// 分类写权限：super_admin 管全部；publisher_admin 只能管 scope=paispace 且自己就是 pai_space
function canManageCategory(account, scope) {
  if (isSuperAdmin(account)) return true
  return Boolean(account && account.role === 'publisher_admin'
    && scope === 'paispace' && account.publisherKey === 'pai_space')
}

async function saveCategory(account, payload) {
  const input = (payload && payload.category) || {}
  const id = String(input.id || '').trim()
  const scope = String(input.scope || '').trim()
  const key = String(input.key || '').trim().toLowerCase()
  const nameZh = String(input.nameZh || '').trim()
  if (!CATEGORY_SCOPES.includes(scope)) return fail(ERROR_CODES.INVALID_PARAM, '一级分区必须是 paispace 或 global')
  if (!/^[a-z0-9_-]+$/.test(key)) return fail(ERROR_CODES.INVALID_PARAM, '分类 key 必须是小写字母/数字/中划线/下划线')
  if (!nameZh) return fail(ERROR_CODES.INVALID_PARAM, '分类中文名必填')
  if (!canManageCategory(account, scope)) return fail(ERROR_CODES.FORBIDDEN, '无权管理该分区的分类')

  // 同 scope 下 key 唯一（排除自身）
  const dupRes = await withRetry(() => activityCategories.where({ scope, key }).limit(5).get())
  const duplicated = (dupRes.data || []).some((item) => item._id !== id)
  if (duplicated) return fail(ERROR_CODES.DUPLICATE_KEY, '同一分区下分类 key 已存在')

  const data = {
    scope,
    key,
    nameZh,
    nameEn: String(input.nameEn || '').trim(),
    sort: Number(input.sort) || 0,
    enabled: input.enabled != null ? Boolean(input.enabled) : true,
    updatedAt: db.serverDate()
  }
  if (id) {
    try {
      await withRetry(() => activityCategories.doc(id).update({ data }))
      return ok({ id, isNew: false })
    } catch (e) {
      return fail(ERROR_CODES.NOT_FOUND, '分类不存在')
    }
  }
  const added = await withRetry(() => activityCategories.add({
    data: Object.assign({ createdAt: db.serverDate() }, data)
  }))
  return ok({ id: added._id, isNew: true })
}

async function deleteCategory(account, payload) {
  const id = String((payload && payload.id) || '').trim()
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少分类 id')
  try {
    const res = await withRetry(() => activityCategories.doc(id).get())
    const cat = res.data
    if (!cat) return fail(ERROR_CODES.NOT_FOUND, '分类不存在')
    if (!canManageCategory(account, cat.scope)) return fail(ERROR_CODES.FORBIDDEN, '无权删除该分区的分类')
    await withRetry(() => activityCategories.doc(id).remove())
    return ok({ id })
  } catch (e) {
    return fail(ERROR_CODES.DELETE_FAILED, e.message || '删除失败')
  }
}

// ============ π空间主理人（模块 4，仅 super_admin） ============

async function listManagers(account) {
  if (!canManagePaiManagers(account)) return fail(ERROR_CODES.FORBIDDEN, '仅 π空间管理员可管理主理人')
  try {
    const [res, activityRes] = await Promise.all([
      withRetry(() => spaceManagers.limit(100).get()),
      withRetry(() => activities.where({ publisherKey: 'pai_space' }).limit(500).get())
    ])
    const managerActivities = {}
    ;(activityRes.data || []).forEach((activity) => {
      const managerId = String(activity.managerId || '')
      if (!managerId) return
      ;(managerActivities[managerId] = managerActivities[managerId] || []).push(activity.id || activity._id)
    })
    // 不明文回传密码：编辑时留空表示不修改
    const list = (res.data || []).map((item) => ({
      id: item._id,
      username: item.username || '',
      displayName: item.displayName || '',
      publisherKey: item.publisherKey || 'pai_space',
      avatarUrl: item.avatarUrl || '',
      bio: item.bio || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      activityIds: managerActivities[item._id] || [],
      enabled: item.enabled !== false,
      createdAt: dateValue(item.createdAt)
    }))
    return ok({ list })
  } catch (e) {
    return ok({ list: [] })
  }
}

async function saveManager(account, payload) {
  if (!canManagePaiManagers(account)) return fail(ERROR_CODES.FORBIDDEN, '仅 π空间管理员可管理主理人')
  const input = (payload && payload.manager) || {}
  const id = String(input.id || '').trim()
  const username = String(input.username || '').trim()
  const password = String(input.password != null ? input.password : '')
  const displayName = String(input.displayName || '').trim()
  const publisherKey = 'pai_space'
  const activityIds = Array.isArray(input.activityIds) ? [...new Set(input.activityIds.map(String).filter(Boolean))] : []
  if (!displayName) return fail(ERROR_CODES.INVALID_PARAM, '主理人显示名必填')
  if (username && !/^[a-zA-Z0-9_-]{2,32}$/.test(username)) return fail(ERROR_CODES.INVALID_PARAM, '用户名需为 2-32 位字母/数字')
  if (username && !id && !password) return fail(ERROR_CODES.INVALID_PARAM, '填写后台用户名后必须设置密码')

  // username 唯一（硬编码账号表 + space_managers 排除自身）
  if (username && ACCOUNTS.some((a) => a.username === username)) {
    return fail(ERROR_CODES.DUPLICATE_KEY, '用户名与后台账号重复')
  }
  if (username) {
    const dupRes = await withRetry(() => spaceManagers.where({ username }).limit(5).get())
    if ((dupRes.data || []).some((item) => item._id !== id)) {
      return fail(ERROR_CODES.DUPLICATE_KEY, '用户名已存在')
    }
  }

  const data = {
    username,
    displayName,
    publisherKey,
    avatarUrl: String(input.avatarUrl || '').trim(),
    bio: String(input.bio || '').trim(),
    tags: toStringArray(input.tags),
    enabled: input.enabled != null ? Boolean(input.enabled) : true
  }
  // 密码留空 = 不修改（沿用明文 demo 约定，见 accounts.js 注释）
  if (password) data.password = password

  if (id) {
    try {
      await withRetry(() => spaceManagers.doc(id).update({ data }))
      await syncManagerActivities(id, activityIds)
      return ok({ id, isNew: false })
    } catch (e) {
      return fail(ERROR_CODES.NOT_FOUND, '主理人不存在')
    }
  }
  const added = await withRetry(() => spaceManagers.add({
    data: Object.assign({ createdAt: db.serverDate() }, data)
  }))
  await syncManagerActivities(added._id, activityIds)
  return ok({ id: added._id, isNew: true })
}

async function syncManagerActivities(managerId, activityIds) {
  const rows = await fetchAll(activities, { publisherKey: 'pai_space' })
  const selected = new Set(activityIds)
  for (const activity of rows) {
    const activityId = activity.id || activity._id
    const currentManagerId = String(activity.managerId || '')
    if (selected.has(activityId) && currentManagerId !== managerId) {
      await withRetry(() => activities.doc(activity._id).update({ data: { managerId } }))
    } else if (!selected.has(activityId) && currentManagerId === managerId) {
      await withRetry(() => activities.doc(activity._id).update({ data: { managerId: '' } }))
    }
  }
}

async function deleteManager(account, payload) {
  if (!canManagePaiManagers(account)) return fail(ERROR_CODES.FORBIDDEN, '仅 π空间管理员可管理主理人')
  const id = String((payload && payload.id) || '').trim()
  if (!id) return fail(ERROR_CODES.INVALID_PARAM, '缺少主理人 id')
  try {
    await withRetry(() => spaceManagers.doc(id).remove())
    await syncManagerActivities(id, [])
    return ok({ id })
  } catch (e) {
    return fail(ERROR_CODES.DELETE_FAILED, e.message || '删除失败')
  }
}

async function generateAdCopy(account, payload) {
  if (!isSuperAdmin(account)) return fail(ERROR_CODES.FORBIDDEN, '仅超级管理员可使用 AI 文案')
  const sellingPoints = String((payload && payload.sellingPoints) || '').trim().slice(0, 500)
  if (!sellingPoints) return fail(ERROR_CODES.INVALID_PARAM, '请先填写卖点')
  const scene = String((payload && payload.scene) || '').slice(0, 100)
  try {
    const content = await callHunyuanText(AI_AD_COPY_PROMPT, `卖点：${sellingPoints}\n投放场景：${scene || '通用'}`)
    const json = extractDraftJson(content)
    if (!json || !Array.isArray(json.candidates) || !json.candidates.length) {
      console.error('[activityAdmin] 广告文案返回格式异常:', String(content || '').slice(0, 300))
      return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回格式异常，请重试')
    }
    const candidates = json.candidates
      .slice(0, 3)
      .map((item) => ({
        copy: String((item && item.copy) || '').slice(0, 120),
        copyEn: String((item && item.copyEn) || '').slice(0, 200)
      }))
      .filter((item) => item.copy)
    if (!candidates.length) return fail(ERROR_CODES.ACTION_FAILED, 'AI 返回内容为空，请重试')
    return ok({ candidates })
  } catch (e) {
    console.error('[activityAdmin] 广告文案生成失败:', e.message)
    return fail(ERROR_CODES.ACTION_FAILED, `AI 文案生成失败：${e.message}`)
  }
}

exports.main = async (rawEvent = {}, context = {}) => {
  const startTime = Date.now()

  try {
    // HTTP 触发器兼容
    let event = rawEvent
    if (rawEvent.body && typeof rawEvent.body === 'string') {
      try {
        event = JSON.parse(rawEvent.body)
      } catch (parseErr) {
        console.error('[activityAdmin] JSON parse error:', parseErr.message)
        return fail(ERROR_CODES.INVALID_REQUEST, '请求体格式错误，需为有效 JSON')
      }
    }

    const { action, token, payload = {} } = event
    console.log('[activityAdmin] action:', action, 'token:', token ? '***' : null)

    // 健康检查
    if (action === 'ping') {
      return ok({
        time: Date.now(),
        env: cloud.DYNAMIC_CURRENT_ENV,
        version: CONFIG.VERSION,
        uptime: process.uptime()
      })
    }

    if (action === 'login') return await login(payload)

    // 认证
    const account = await verifyToken(token)
    if (!account) return fail(ERROR_CODES.NOT_LOGIN, '登录已过期，请重新登录')

    const elapsedMs = Date.now() - startTime
    if (elapsedMs > 100) {
      console.warn(`[activityAdmin] auth overhead ${elapsedMs}ms for action=${action}`)
    }

    switch (action) {
      case 'listActivities': return await listActivities()
      case 'getActivity': return await getActivity(payload)
      case 'saveActivity': return await saveActivity(account, payload)
      case 'uploadImage': return await uploadImage(account, payload)
      case 'setActivityFlags': return await setActivityFlags(account, payload)
      case 'deleteActivity': return await deleteActivity(account, payload)
      case 'listPublishers': return await listPublishersLegacy()
      case 'listActivitiesByPublisher': return await listActivitiesByPublisher(account, payload)
      case 'listPublishersFull': return await listPublishersFull(payload)
      case 'savePublisher': return await savePublisher(account, payload)
      case 'togglePublisher': return await togglePublisher(account, payload)
      case 'deletePublisher': return await deletePublisher(account, payload)
      case 'batchUpdatePublishers': return await batchUpdatePublishers(account, payload)
      case 'getPublisherStats': return await getPublisherStats()
      case 'getPublisherLogs': return await getPublisherLogs(payload)
      case 'exportPublishers': return await exportPublishers(account, payload)
      case 'setupDemoData': return await setupDemoData(account, payload)
      case 'listReports': return await listReports(payload)
      case 'getReportDetail': return await getReportDetail(payload)
      case 'resolveReport': return await resolveReport(account, payload)
      case 'listFeedbacks': return await listFeedbacks(payload)
      case 'resolveFeedback': return await resolveFeedback(account, payload)
      case 'aiImportActivity': return await aiImportActivity(account, payload)
      case 'aiParseActivityText': return await aiParseActivityText(account, payload)
      case 'aiReviseActivityDraft': return await aiReviseActivityDraft(account, payload)
      case 'aiPolishActivityDesc': return await aiPolishActivityDesc(account, payload)
      case 'aiGenerateActivityCopy': return await aiGenerateActivityCopy(account, payload)
      case 'warnUser': return await warnUser(account, payload)
      case 'banUser': return await banUser(account, payload)
      case 'getUserStatus': return await getUserStatus(payload)
      case 'getRegistrationOverview': return await getRegistrationOverview(account, payload)
      case 'listUsers': return await listUsers(account, payload)
      case 'listActivityRegistrations': return await listActivityRegistrations(account, payload)
      case 'listAds': return await listAds(account)
      case 'saveAd': return await saveAd(account, payload)
      case 'deleteAd': return await deleteAd(account, payload)
      case 'setAdStatus': return await setAdStatus(account, payload)
      case 'getAdStats': return await getAdStats(account)
      case 'generateAdCopy': return await generateAdCopy(account, payload)
      case 'getActivityClickStats': return await getActivityClickStats(account, payload)
      case 'listActivityClicks': return await listActivityClicks(account, payload)
      case 'getReservationOverview': return await getReservationOverview(account, payload)
      case 'listReservationOrders': return await listReservationOrders(account, payload)
      case 'listCategories': return await listCategories(account)
      case 'saveCategory': return await saveCategory(account, payload)
      case 'deleteCategory': return await deleteCategory(account, payload)
      case 'listManagers': return await listManagers(account)
      case 'saveManager': return await saveManager(account, payload)
      case 'deleteManager': return await deleteManager(account, payload)
      default:
        return fail(ERROR_CODES.UNKNOWN_ACTION, `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[activityAdmin] 未处理异常:', {
      message: err.message,
      stack: err.stack,
      elapsed: Date.now() - startTime
    })
    return fail(ERROR_CODES.INTERNAL_ERROR, err.message || '服务器内部错误')
  }
}

function isSuperAdmin(account) {
  return Boolean(account && account.role === 'super_admin')
}

function managedPublisherKeys(account) {
  if (isSuperAdmin(account)) return null
  const keys = Array.isArray(account && account.publisherKeys) ? account.publisherKeys.slice() : []
  if (account && account.publisherKey && !keys.includes(account.publisherKey)) keys.push(account.publisherKey)
  return keys.filter(Boolean)
}

function canAccessPublisher(account, publisherKey) {
  const keys = managedPublisherKeys(account)
  return keys === null || keys.includes(publisherKey)
}

function canReadActivityData(account) {
  return Boolean(account && (account.role === 'super_admin' || account.role === 'publisher_admin'))
}

function canManagePublisher(account, publisherKey) {
  return canReadActivityData(account) && canAccessPublisher(account, publisherKey)
}

function dateValue(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value.$date) return String(value.$date)
  return String(value)
}

function dateKey(value) {
  const raw = dateValue(value)
  return raw ? raw.slice(0, 10) : ''
}

function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value.$date) return new Date(value.$date).getTime() || 0
  return new Date(value).getTime() || 0
}

function normalizeDateInput(value) {
  const raw = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function inCreatedRange(value, from, to) {
  const date = dateKey(value)
  const start = normalizeDateInput(from)
  const end = normalizeDateInput(to)
  return (!start || date >= start) && (!end || date <= end)
}

function inActivityDateRange(value, from, to) {
  const date = String(value || '').slice(0, 10)
  const start = normalizeDateInput(from)
  const end = normalizeDateInput(to)
  return (!start || date >= start) && (!end || date <= end)
}

function buildRecentDays(count) {
  const days = []
  const current = new Date()
  current.setHours(0, 0, 0, 0)
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(current)
    date.setDate(date.getDate() - offset)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    days.push(`${year}-${month}-${day}`)
  }
  return days
}

function normalizePage(payload = {}) {
  const page = Math.max(1, Number.parseInt(payload.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(payload.pageSize, 10) || 20))
  return { page, pageSize }
}

function buildPagination(total, page, pageSize) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: page * pageSize < total
  }
}

function publisherScopeQuery(publisherKeys) {
  if (publisherKeys === null) return {}
  // command.in([]) 在云开发中会报参数错误；用不可用值表达没有授权范围。
  return publisherKeys.length ? { publisherKey: _.in(publisherKeys) } : { publisherKey: '__no_publisher_access__' }
}

function buildDataScope(account, publisherKeys) {
  return {
    role: account && account.role ? account.role : 'unknown',
    publisherKeys: publisherKeys === null ? [] : publisherKeys,
    allPublishers: publisherKeys === null
  }
}

async function loadUserSummaries(userIds) {
  const map = {}
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  for (let start = 0; start < uniqueIds.length; start += 20) {
    const ids = uniqueIds.slice(start, start + 20)
    const res = await withRetry(() => usersCol.where({ xipooId: _.in(ids) }).limit(20).get())
    ;(res.data || []).forEach(user => {
      const safe = sanitizeRegistrationUser(user)
      map[safe.xipooId] = safe
    })
  }
  return map
}

function sanitizeAdminUser(user) {
  return {
    xipooId: user.xipooId || user.id || '',
    name: user.name || user.nickname || '',
    avatarUrl: user.avatarUrl || user.avatar || '',
    status: user.status || 'active',
    createdAt: dateValue(user.createdAt),
    lastActiveAt: dateValue(user.lastActiveAt)
  }
}

function sanitizeRegistrationUser(user) {
  return {
    xipooId: user.xipooId || user.id || '',
    name: user.name || user.nickname || '',
    avatarUrl: user.avatarUrl || user.avatar || '',
    status: user.status || 'active'
  }
}

async function fetchAll(collection, queryData = {}, maxBatches = 20) {
  const result = []
  const batchSize = 100
  for (let batch = 0; batch < maxBatches; batch++) {
    const query = Object.keys(queryData).length ? collection.where(queryData) : collection
    const res = await withRetry(() => query.orderBy('createdAt', 'desc').skip(batch * batchSize).limit(batchSize).get())
    const list = res.data || []
    result.push(...list)
    if (list.length < batchSize) break
  }
  return result
}
