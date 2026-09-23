const cloud = require('wx-server-sdk')
const secCheck = require('./secCheck')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 集合引用
const users = db.collection('users')
const activities = db.collection('activities')
const activityPublishers = db.collection('activity_publishers')
const activitySubscriptions = db.collection('activity_subscriptions')
const activityRegistrations = db.collection('activity_registrations')
const activityComments = db.collection('activity_comments')
const activityInteractions = db.collection('activity_interactions')
const activitySchedules = db.collection('activity_schedules')
const activityClicks = db.collection('activity_clicks')
const activityCategories = db.collection('activity_categories')
const spaceManagers = db.collection('space_managers')

function todayKey() {
  const d = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 点击上报（模块 2）：写明细 + 累计计数；游客也可上报，用 openid 作匿名标识
async function trackClick(openid, payload) {
  const activityId = String((payload && payload.activityId) || '').trim()
  if (!activityId) return fail('INVALID_PARAM', '缺少 activityId')
  try {
    await activityClicks.add({
      data: {
        activityId,
        openid: openid || 'anonymous',
        jumpType: String((payload && payload.jumpType) || ''),
        createdAt: db.serverDate(),
        date: todayKey()
      }
    })
  } catch (e) {
    console.error('[activity] trackClick insert failed', e.message)
  }
  // 累计计数冗余在 activities 文档上，后台列表直接读，失败不影响明细
  try {
    await activities.doc(activityId).update({ data: { clickCount: _.inc(1) } })
  } catch (e) { /* 活动可能不存在或计数失败，忽略 */ }
  return ok({ tracked: true })
}

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

async function currentUserId(openid) {
  const found = await users.where({ openid }).limit(1).get()
  const record = found.data && found.data[0]
  return record ? record.xipooId : null
}

async function findUser(xipooId) {
  const res = await users.where({ xipooId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// ---- 工具函数 ----

function stripInternal(doc) {
  if (!doc) return doc
  const copy = Object.assign({}, doc)
  delete copy._id
  delete copy._openid
  return copy
}

function ensureActivityInteraction(activity) {
  if (!activity) return activity
  return Object.assign({}, activity, {
    pinned: Boolean(activity.pinned),
    polished: Boolean(activity.polished),
    joined: Boolean(activity.joined),
    liked: Boolean(activity.liked),
    saved: Boolean(activity.saved),
    shareCount: Number(activity.shareCount || 0),
    likeCount: Number(activity.likeCount || 0),
    joinCount: Number(activity.joinCount || 0)
  })
}

function activityDisplayTitle(activity) {
  return activity.titleZh || activity.title || ''
}

// 云存储桶为「仅创建者可读写」：后台/云函数上传的封面与 Logo 对小程序端用户不可见，
// 客户端 wx.cloud.getTempFileURL 拿不到临时链接，图片在手机上加载失败。
// 因此在云函数出口统一把 cloud:// fileID 换成本次响应可用的 HTTPS 临时地址
// （云函数具备管理员权限，可换取任意文件的临时链接，绕开私有桶读取限制）。
function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0
}

// 批量换取 cloud:// fileID 的 HTTPS 临时链接，返回 fileID -> URL 映射（换不到的条目不写入）
async function resolveCloudFileUrls(values) {
  const fileIds = Array.from(new Set((values || []).filter(isCloudFileId)))
  const urlMap = {}
  if (!fileIds.length) return urlMap
  // getTempFileURL 单次传有限数量，分批避免列表过大时失败
  for (let index = 0; index < fileIds.length; index += 50) {
    try {
      const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) })
      ;(result.fileList || []).forEach((file) => {
        if (file && file.fileID && file.tempFileURL) urlMap[file.fileID] = file.tempFileURL
      })
    } catch (error) {
      console.warn('[activity] image URL resolve failed:', error && error.message)
    }
  }
  return urlMap
}

// 把 records 里 fields 字段的 cloud:// 值替换为 HTTPS 临时地址；
// 无法换取时清空该字段，绝不把 cloud:// 原样交给 <image>（会被当成相对路径导致渲染报错）。
async function resolveImagesOn(records, fields) {
  if (!Array.isArray(records) || !records.length) return records
  const fieldList = Array.isArray(fields) ? fields : [fields]
  const values = []
  records.forEach((record) => {
    if (!record || typeof record !== 'object') return
    fieldList.forEach((field) => {
      if (record[field]) values.push(record[field])
    })
  })
  const urlMap = await resolveCloudFileUrls(values)
  return records.map((record) => {
    if (!record || typeof record !== 'object') return record
    const copy = Object.assign({}, record)
    fieldList.forEach((field) => {
      const value = record[field]
      if (isCloudFileId(value)) copy[field] = urlMap[value] || ''
    })
    return copy
  })
}

// ---- 查询当前用户订阅的发布方 ----

async function getUserSubscriptions(userId) {
  try {
    const res = await activitySubscriptions.where({ userId }).limit(1).get()
    const record = res.data && res.data[0]
    if (record && Array.isArray(record.publisherKeys)) {
      return record.publisherKeys
    }
  } catch (e) {
    // 集合不存在或查询失败，忽略
  }
  try {
    const user = await findUser(userId)
    return (user && Array.isArray(user.subscriptions)) ? user.subscriptions : []
  } catch (e) {
    return []
  }
}

// ---- Actions ----

async function loadPublisherMap() {
  try {
    const res = await activityPublishers.limit(200).get()
    const map = {}
    for (const p of (res.data || [])) {
      map[p.key] = {
        key: p.key,
        nameZh: p.nameZh || p.key,
        name: p.name || p.key,
        icon: p.icon || '📌',
        color: p.color || '#6366f1',
        logoUrl: p.logoUrl || '',
        description: p.description || '',
        enabled: p.enabled !== false,
        quotaFlash: Number(p.quotaFlash) || 3,
        quotaRecommend: Number(p.quotaRecommend) || 6,
        sortWeight: Number(p.sortWeight) || 50,
        pinned: Boolean(p.pinned),
        presetTags: Array.isArray(p.presetTags) ? p.presetTags : []
      }
    }
    // 发布方 Logo 也可能是 cloud:// fileID，统一换临时链接（私有桶下客户端换不到）
    const keys = Object.keys(map)
    const logoUrlMap = await resolveCloudFileUrls(keys.map((key) => map[key].logoUrl))
    keys.forEach((key) => {
      const url = map[key].logoUrl
      if (isCloudFileId(url)) map[key].logoUrl = logoUrlMap[url] || ''
    })
    return map
  } catch (e) {
    return {}
  }
}

async function listActivities(meId, payload = {}) {
  const subscriptions = await getUserSubscriptions(meId)
  const publisherMap = await loadPublisherMap()

  // 分页参数
  const page = Math.max(1, Number(payload.page) || 1)
  const pageSize = Math.min(200, Math.max(10, Number(payload.pageSize) || 100))

  // 全量获取已注册/已加入日程的活动 ID（轻量查询）
  let registeredIds = []
  try {
    const regRes = await activityRegistrations.where({ userId: meId }).limit(500).get()
    registeredIds = (regRes.data || []).filter(r => r.status === 'registered').map(r => r.activityId)
  } catch (e) { /* ignore */ }

  let scheduledIds = []
  try {
    const schedRes = await activitySchedules.where({ userId: meId }).limit(500).get()
    scheduledIds = (schedRes.data || []).map(r => r.activityId)
  } catch (e) { /* ignore */ }

  // 全量读取（CloudBase 集合查询不支持服务端分页，采用内存分页）
  // 注意：云函数单次 get 最多返回 100 条，limit(500) 实际也只能拿到 100 条，
  // 必须 skip+limit 分批拉取，否则超过 100 条的活动永远翻不到
  const allDocs = []
  const BATCH_SIZE = 100
  const MAX_BATCHES = 50 // 安全上限 5000 条，防止异常死循环
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const res = await activities.skip(batch * BATCH_SIZE).limit(BATCH_SIZE).get()
    const docs = res.data || []
    allDocs.push(...docs)
    if (docs.length < BATCH_SIZE) break
  }
  const allList = allDocs
    .filter(a => {
      if (!subscriptions.includes(a.publisherKey)) return false
      const pub = publisherMap[a.publisherKey]
      return pub ? pub.enabled : true
    })
    .map(a => {
      const clean = stripInternal(a)
      // 历史活动可能只有数据库 _id，没有业务 id。详情页必须拿到稳定
      // 的可查询 ID，否则列表点击会跳转到“活动不存在”。
      if (!clean.id && a._id) clean.id = a._id
      clean.registered = registeredIds.includes(a.id || a._id)
      clean.scheduled = scheduledIds.includes(a.id || a._id)
      clean.publisherMeta = publisherMap[a.publisherKey] || null
      return ensureActivityInteraction(clean)
    })
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      const aw = (a.publisherMeta && a.publisherMeta.sortWeight) || 50
      const bw = (b.publisherMeta && b.publisherMeta.sortWeight) || 50
      if (aw !== bw) return bw - aw
      return String(a.date || '').localeCompare(String(b.date || ''))
    })

  const total = allList.length
  const totalPages = Math.ceil(total / pageSize)
  const startIndex = (page - 1) * pageSize
  const pageList = allList.slice(startIndex, startIndex + pageSize)

  // 封面 cloud:// → HTTPS 临时链接（私有桶下客户端换不到，改由云函数出口签发）
  const resolvedList = await resolveImagesOn(pageList, 'coverUrl')

  return ok({
    list: resolvedList,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages
    }
  })
}

async function getActivityDetail(meId, payload) {
  const activityId = payload.id || payload.activityId
  if (!activityId) return fail('INVALID_PARAM', '缺少活动 ID')

  let activity = null
  try {
    const res = await activities.doc(activityId).get()
    activity = res.data || null
  } catch (e) { /* 旧数据可能使用随机 _id */ }
  if (!activity) {
    try {
      const res = await activities.where({ id: activityId }).limit(1).get()
      activity = res.data && res.data[0]
    } catch (e) { /* ignore */ }
  }
  if (!activity) return fail('NOT_FOUND', '活动不存在')

  const subscriptions = await getUserSubscriptions(meId)
  const clean = stripInternal(activity)

  let registered = false
  try {
    const regRes = await activityRegistrations.where({ userId: meId, activityId, status: 'registered' }).limit(1).get()
    registered = (regRes.data && regRes.data.length > 0)
  } catch (e) { /* ignore */ }

  clean.registered = registered
  clean.subscribed = subscriptions.includes(activity.publisherKey)

  const resolved = await resolveImagesOn([ensureActivityInteraction(clean)], 'coverUrl')
  return ok(resolved[0])
}

async function registerActivity(meId, payload) {
  const activityId = payload.id || payload.activityId
  if (!activityId) return fail('INVALID_PARAM', '缺少活动 ID')

  let activity
  try {
    const res = await activities.doc(activityId).get()
    activity = res.data
  } catch (e) {
    return fail('NOT_FOUND', '活动不存在')
  }
  if (!activity) return fail('NOT_FOUND', '活动不存在')

  const existing = await activityRegistrations.where({ userId: meId, activityId, status: 'registered' }).limit(1).get()
  if (existing.data && existing.data.length > 0) {
    const allRes = await activityRegistrations.where({ userId: meId }).limit(500).get()
    return ok((allRes.data || []).map(stripInternal))
  }

  const registration = {
    id: `registration-${Date.now()}`,
    userId: meId,
    activityId,
    title: activity.titleZh || activity.title,
    titleEn: activity.title || activity.titleZh,
    date: activity.date || '',
    time: activity.time || '',
    place: activity.placeZh || activity.place || '',
    placeEn: activity.place || activity.placeZh || '',
    publisherKey: activity.publisherKey,
    status: 'registered',
    createdAt: db.serverDate()
  }
  await activityRegistrations.add({ data: registration })

  const allRes = await activityRegistrations.where({ userId: meId }).limit(500).get()
  return ok((allRes.data || []).map(stripInternal))
}

async function cancelRegistration(meId, payload) {
  const activityId = payload.id || payload.activityId
  if (!activityId) return fail('INVALID_PARAM', '缺少活动 ID')

  const existing = await activityRegistrations.where({ userId: meId, activityId }).limit(500).get()
  for (const doc of existing.data || []) {
    await activityRegistrations.doc(doc._id).remove()
  }

  const allRes = await activityRegistrations.where({ userId: meId }).limit(500).get()
  return ok((allRes.data || []).map(stripInternal))
}

async function getRegistrations(meId) {
  const res = await activityRegistrations.where({ userId: meId }).limit(500).get()
  return ok((res.data || []).map(stripInternal))
}

async function addToSchedule(meId, payload) {
  const activityId = payload.id || payload.activityId
  if (!activityId) return fail('INVALID_PARAM', '缺少活动 ID')

  let activity
  let activityDocId = activityId
  try {
    const res = await activities.doc(activityId).get()
    activity = res.data || null
  } catch (e) {
    activity = null
  }
  if (!activity) {
    try {
      const res = await activities.where({ id: activityId }).limit(1).get()
      activity = res.data && res.data[0]
      activityDocId = activity && activity._id
    } catch (e) { /* ignore */ }
  }
  if (!activity) return fail('NOT_FOUND', '活动不存在')

  const existing = await activitySchedules.where({ userId: meId, activityId: activityId }).limit(1).get()
  if (existing.data && existing.data.length === 0) {
    const entry = {
      id: `activity-schedule-${Date.now()}`,
      userId: meId,
      activityId: activityId || activityDocId,
      title: activity.titleZh || activity.title,
      date: activity.date || '',
      start: activity.start || '',
      end: activity.end || '',
      place: activity.placeZh || activity.place || '',
      tag: activity.scheduleTag || activity.time || '',
      createdAt: db.serverDate()
    }
    await activitySchedules.add({ data: entry })
  }

  const allRes = await activitySchedules.where({ userId: meId }).limit(500).get()
  return ok((allRes.data || []).map(stripInternal))
}

async function toggleInteraction(meId, payload) {
  const activityId = payload.id || payload.activityId
  const field = payload.field
  if (!activityId || !field) return fail('INVALID_PARAM', '缺少参数')

  let activity
  try {
    const res = await activities.doc(activityId).get()
    activity = res.data
  } catch (e) {
    return fail('NOT_FOUND', '活动不存在')
  }
  if (!activity) return fail('NOT_FOUND', '活动不存在')

  const countFields = ['liked', 'joined', 'shared']
  const toggleFields = ['pinned', 'polished', 'saved', 'liked', 'joined']

  if (field === 'shared') {
    await activities.doc(activityId).update({
      data: { shareCount: _.inc(1) }
    })
    const updated = await activities.doc(activityId).get()
    return ok(ensureActivityInteraction(stripInternal(updated.data)))
  }

  if (toggleFields.includes(field)) {
    const interactionRes = await activityInteractions.where({ userId: meId, activityId, field }).limit(1).get()
    const existingInteraction = interactionRes.data && interactionRes.data[0]
    const currentState = Boolean(existingInteraction && existingInteraction.active)

    if (currentState) {
      if (existingInteraction) {
        await activityInteractions.doc(existingInteraction._id).update({ data: { active: false, updatedAt: db.serverDate() } })
      }
      if (countFields.includes(field)) {
        const fieldName = field === 'liked' ? 'likeCount' : (field === 'joined' ? 'joinCount' : field + 'Count')
        await activities.doc(activityId).update({ data: { [fieldName]: _.inc(-1) } })
      }
    } else {
      if (existingInteraction) {
        await activityInteractions.doc(existingInteraction._id).update({ data: { active: true, updatedAt: db.serverDate() } })
      } else {
        await activityInteractions.add({
          data: { userId: meId, activityId, field, active: true, createdAt: db.serverDate(), updatedAt: db.serverDate() }
        })
      }
      if (countFields.includes(field)) {
        const fieldName = field === 'liked' ? 'likeCount' : (field === 'joined' ? 'joinCount' : field + 'Count')
        await activities.doc(activityId).update({ data: { [fieldName]: _.inc(1) } })
      }
    }

    const updated = await activities.doc(activityId).get()
    return ok(ensureActivityInteraction(stripInternal(updated.data)))
  }

  return fail('INVALID_PARAM', `不支持的交互字段: ${field}`)
}

async function commentActivity(meId, payload) {
  const activityId = payload.id || payload.activityId
  const text = payload.text
  if (!activityId || !text) return fail('INVALID_PARAM', '缺少参数')

  try {
    await activities.doc(activityId).get()
  } catch (e) {
    return fail('NOT_FOUND', '活动不存在')
  }

  const user = await findUser(meId)

  const comment = {
    id: `comment-${Date.now()}`,
    userId: meId,
    name: user ? user.name : 'Unknown',
    text,
    createdAt: db.serverDate()
  }
  await activityComments.add({ data: Object.assign({}, comment, { activityId }) })

  const commentsRes = await activityComments.where({ activityId }).limit(200).get()
  return ok((commentsRes.data || []).map(stripInternal))
}

async function getSubscriptions(meId) {
  const subscriptions = await getUserSubscriptions(meId)

  const pubRes = await activityPublishers.limit(100).get()
  const publishers = (pubRes.data || [])
    .map(stripInternal)
    .filter(p => p.enabled !== false) // 仅展示启用的活动方
    .sort((a, b) => {
      // 置顶优先 → 权重降序
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return (Number(b.sortWeight) || 50) - (Number(a.sortWeight) || 50)
    })

  const allActivities = await activities.limit(500).get()
  const activitiesList = allActivities.data || []

  const result = publishers.map(p => {
    const publisherActivities = activitiesList.filter(a => a.publisherKey === p.key)
    const latestActivity = publisherActivities.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
    return Object.assign({}, p, {
      subscribed: subscriptions.includes(p.key),
      activityCount: publisherActivities.length,
      latestActivityTitle: latestActivity ? activityDisplayTitle(latestActivity) : '',
      latestActivityDate: latestActivity ? latestActivity.date : ''
    })
  })

  const resolved = await resolveImagesOn(result, 'logoUrl')
  return ok(resolved)
}

async function getPublisherProfile(meId, payload) {
  const key = payload.key
  if (!key) return fail('INVALID_PARAM', '缺少活动方 key')

  const pubRes = await activityPublishers.where({ key }).limit(1).get()
  const publisher = pubRes.data && pubRes.data[0]
  if (!publisher) return fail('NOT_FOUND', '活动方不存在')

  const [subscriptions, activityRes] = await Promise.all([
    getUserSubscriptions(meId),
    activities.where({ publisherKey: key }).limit(200).get()
  ])
  const list = (activityRes.data || [])
    .map((item) => ensureActivityInteraction(stripInternal(item)))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  const resolvedActivities = await resolveImagesOn(list, 'coverUrl')
  const resolvedPublisher = await resolveImagesOn([Object.assign({}, stripInternal(publisher), {
    subscribed: subscriptions.includes(key),
    activityCount: list.length
  })], ['logoUrl', 'coverUrl'])
  return ok({
    publisher: resolvedPublisher[0],
    activities: resolvedActivities
  })
}

async function toggleSubscription(meId, payload) {
  const key = payload.key
  if (!key) return fail('INVALID_PARAM', '缺少发布方 key')

  let subRecord
  try {
    const subRes = await activitySubscriptions.where({ userId: meId }).limit(1).get()
    subRecord = subRes.data && subRes.data[0]
  } catch (e) {
    subRecord = null
  }

  let publisherKeys = subRecord ? (subRecord.publisherKeys || []) : (await getUserSubscriptions(meId))

  if (publisherKeys.includes(key)) {
    publisherKeys = publisherKeys.filter(k => k !== key)
  } else {
    publisherKeys.push(key)
  }

  if (subRecord) {
    await activitySubscriptions.doc(subRecord._id).update({ data: { publisherKeys, updatedAt: db.serverDate() } })
  } else {
    await activitySubscriptions.add({
      data: { userId: meId, publisherKeys, createdAt: db.serverDate(), updatedAt: db.serverDate() }
    })
  }

  return await getSubscriptions(meId)
}

async function subscribeAll(meId) {
  const pubRes = await activityPublishers.limit(100).get()
  const allKeys = (pubRes.data || []).map(p => p.key)

  let subRecord
  try {
    const subRes = await activitySubscriptions.where({ userId: meId }).limit(1).get()
    subRecord = subRes.data && subRes.data[0]
  } catch (e) {
    subRecord = null
  }

  if (subRecord) {
    await activitySubscriptions.doc(subRecord._id).update({ data: { publisherKeys: allKeys, updatedAt: db.serverDate() } })
  } else {
    await activitySubscriptions.add({
      data: { userId: meId, publisherKeys: allKeys, createdAt: db.serverDate(), updatedAt: db.serverDate() }
    })
  }

  return await getSubscriptions(meId)
}

async function resetSubscriptions(meId) {
  let subRecord
  try {
    const subRes = await activitySubscriptions.where({ userId: meId }).limit(1).get()
    subRecord = subRes.data && subRes.data[0]
  } catch (e) {
    subRecord = null
  }

  const defaultKeys = ['chips']

  if (subRecord) {
    await activitySubscriptions.doc(subRecord._id).update({ data: { publisherKeys: defaultKeys, updatedAt: db.serverDate() } })
  } else {
    await activitySubscriptions.add({
      data: { userId: meId, publisherKeys: defaultKeys, createdAt: db.serverDate(), updatedAt: db.serverDate() }
    })
  }

  return await getSubscriptions(meId)
}

// 活动分类（模块 4）：游客可看，只返回启用项，按 sort 升序；scope 可选过滤
async function listCategories(payload) {
  const scope = String((payload && payload.scope) || '').trim()
  try {
    const res = await activityCategories.limit(200).get()
    const list = (res.data || [])
      .filter((item) => item.enabled !== false)
      .filter((item) => !scope || item.scope === scope)
      .map((item) => ({
        scope: item.scope || 'global',
        key: item.key || '',
        nameZh: item.nameZh || '',
        nameEn: item.nameEn || '',
        sort: Number(item.sort) || 0
      }))
      .sort((a, b) => a.sort - b.sort)
    return ok({ list })
  } catch (e) {
    return ok({ list: [] }) // 集合未创建时按空列表
  }
}

// π空间公开主理人：只返回展示资料和已绑定活动，不暴露后台登录字段。
async function listPaiManagers() {
  try {
    const [managerRes, activityRes] = await Promise.all([
      spaceManagers.where({ publisherKey: 'pai_space' }).limit(100).get(),
      activities.where({ publisherKey: 'pai_space' }).limit(500).get()
    ])
    const activityMap = {}
    ;(activityRes.data || []).forEach((activity) => {
      const managerId = String(activity.managerId || '')
      if (!managerId) return
      ;(activityMap[managerId] = activityMap[managerId] || []).push(ensureActivityInteraction(stripInternal(activity)))
    })
    const managers = (managerRes.data || [])
      .filter((item) => item.enabled !== false)
      .map((item) => ({
        id: item._id,
        displayName: item.displayName || '',
        avatarUrl: item.avatarUrl || '',
        bio: item.bio || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        activities: (activityMap[item._id] || []).sort((a, b) => `${a.date || ''} ${a.start || ''}`.localeCompare(`${b.date || ''} ${b.start || ''}`))
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
    const avatarMap = await resolveCloudFileUrls(managers.map((item) => item.avatarUrl))
    managers.forEach((item) => {
      if (isCloudFileId(item.avatarUrl)) item.avatarUrl = avatarMap[item.avatarUrl] || ''
    })
    return ok({ list: managers })
  } catch (e) {
    return ok({ list: [] })
  }
}

// ---- Main entry ----

// 热门轮播上限（与小程序端 HOT_FLASH_LIMIT 保持一致）
const HOT_FLASH_LIMIT = 5

// 发现页运营位：后台勾选 isHot / isRecommended 的活动，独立拉取，
// 不受用户订阅关系和分页影响，保证与后台配置完全一致
async function getCuratedActivities(meId) {
  const publisherMap = await loadPublisherMap()
  const isEnabled = (key) => {
    const pub = publisherMap[key]
    return pub ? pub.enabled : true
  }

  let registeredIds = []
  try {
    const regRes = await activityRegistrations.where({ userId: meId }).limit(500).get()
    registeredIds = (regRes.data || []).filter(r => r.status === 'registered').map(r => r.activityId)
  } catch (e) { /* ignore */ }
  let scheduledIds = []
  try {
    const schedRes = await activitySchedules.where({ userId: meId }).limit(500).get()
    scheduledIds = (schedRes.data || []).map(r => r.activityId)
  } catch (e) { /* ignore */ }

  // 与 listActivities 相同的分批拉取（单次 get 最多 100 条）
  const allDocs = []
  const BATCH_SIZE = 100
  const MAX_BATCHES = 50
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const res = await activities.skip(batch * BATCH_SIZE).limit(BATCH_SIZE).get()
    const docs = res.data || []
    allDocs.push(...docs)
    if (docs.length < BATCH_SIZE) break
  }

  const decorate = (a) => {
    const clean = stripInternal(a)
    clean.registered = registeredIds.includes(a.id || a._id)
    clean.scheduled = scheduledIds.includes(a.id || a._id)
    return ensureActivityInteraction(clean)
  }
  const byDateDesc = (x, y) => String(y.date || '').localeCompare(String(x.date || ''))
  const flagged = allDocs.filter(a => (a.isHot || a.isRecommended) && isEnabled(a.publisherKey))
  const hot = flagged.filter(a => a.isHot).sort(byDateDesc).slice(0, HOT_FLASH_LIMIT).map(decorate)
  const recommended = flagged.filter(a => a.isRecommended).sort(byDateDesc).map(decorate)
  const resolvedHot = await resolveImagesOn(hot, 'coverUrl')
  const resolvedRecommended = await resolveImagesOn(recommended, 'coverUrl')
  return ok({ hot: resolvedHot, recommended: resolvedRecommended, hotLimit: HOT_FLASH_LIMIT })
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const { action, payload = {} } = event || {}

    if (action === 'ping') {
      return ok({ openid, env: wxContext.ENV, time: Date.now() })
    }

    // 点击上报不强制登录态用户档案：游客（无 users 记录）也以 openid 匿名上报
    if (action === 'trackClick') {
      if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')
      return await trackClick(openid, payload)
    }

    // 活动分类（模块 4）：游客可看
    if (action === 'listCategories') {
      return await listCategories(payload)
    }

    // 活动详情允许游客查看；报名、收藏、点赞等写操作仍需登录。
    if (action === 'getActivityDetail') {
      const meId = openid ? await currentUserId(openid) : null
      return await getActivityDetail(meId, payload)
    }

    if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')

    const meId = await currentUserId(openid)
    if (!meId) return fail('USER_NOT_FOUND', '用户不存在，请重新登录')

    switch (action) {
      case 'listActivities':
        return await listActivities(meId, payload)
      case 'getCuratedActivities':
        return await getCuratedActivities(meId)
      case 'registerActivity':
        return await registerActivity(meId, payload)
      case 'cancelRegistration':
        return await cancelRegistration(meId, payload)
      case 'getRegistrations':
        return await getRegistrations(meId)
      case 'addToSchedule':
        return await addToSchedule(meId, payload)
      case 'toggleInteraction':
        return await toggleInteraction(meId, payload)
      case 'commentActivity': {
        // 内容安全：评论文本检测（scene=2 评论）
        if (await secCheck.isTextRisky(openid, [payload && payload.text], 2)) {
          return secCheck.contentRisky()
        }
        return await commentActivity(meId, payload)
      }
      case 'getSubscriptions':
        return await getSubscriptions(meId)
      case 'getPublisherProfile':
        return await getPublisherProfile(meId, payload)
      case 'listPaiManagers':
        return await listPaiManagers()
      case 'toggleSubscription':
        return await toggleSubscription(meId, payload)
      case 'subscribeAll':
        return await subscribeAll(meId)
      case 'resetSubscriptions':
        return await resetSubscriptions(meId)
      default:
        return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[activity cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
