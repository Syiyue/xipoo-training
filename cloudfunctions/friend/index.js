const cloud = require('wx-server-sdk')
const secCheck = require('./secCheck')
const { groupFreeSlotsCore } = require('./groupAvailability')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const users = db.collection('users')
const friendRequests = db.collection('friend_requests')
const friendships = db.collection('friendships')
const schedules = db.collection('schedules')
const FRIEND_RUNTIME_VERSION = 'v4-weekly-30min-grid-0814'

// 不将 cloud:// fileID 直接交给 <image>。开发者工具会把它拼成 127.0.0.1 页面路径，
// 导致头像/照片墙持续报渲染层网络错误；云函数出口改为签发本次响应可用的 HTTPS 临时地址。

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0
}

async function resolvePublicImageUrls(values) {
  const fileIds = Array.from(new Set((values || []).filter(isCloudFileId)))
  if (!fileIds.length) return {}
  const urlMap = {}
  // getTempFileURL 一次最多传有限数量；分批避免资料页照片墙或联系人列表过多时失败。
  for (let index = 0; index < fileIds.length; index += 50) {
    try {
      const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) })
      ;(result.fileList || []).forEach((file) => {
        if (file && file.fileID && file.tempFileURL) urlMap[file.fileID] = file.tempFileURL
      })
    } catch (error) {
      console.warn('[friend] image URL resolve failed:', error && error.message)
    }
  }
  return urlMap
}

function publicImageUrl(value, urlMap) {
  if (!isCloudFileId(value)) return value || ''
  // 文件已被删除或无读取权限时用空值回退到昵称首字母，绝不返回会导致渲染报错的 cloud://。
  return (urlMap && urlMap[value]) || ''
}

// ==================== 日程共享权限模型 ====================
// 联系人关系（friendships 文档）与日程查看权限（share map）分离：
// share[userId] 表示 userId 授权对方查看自己日程的权限。
// 兼容旧布尔值：true → busy（旧好友默认仅忙闲），false → none
const PERMISSION_LEVELS = ['none', 'busy', 'title', 'detail']
const DEFAULT_PERMISSION = { level: 'busy', showLocation: false, allowFreeTimeCalc: true, startDate: '', endDate: '' }

function normalizeShareEntry(value) {
  if (value === true) return Object.assign({}, DEFAULT_PERMISSION)
  if (!value || value === false) return Object.assign({}, DEFAULT_PERMISSION, { level: 'none' })
  const level = PERMISSION_LEVELS.includes(value.level) ? value.level : 'none'
  return {
    level,
    showLocation: Boolean(value.showLocation),
    allowFreeTimeCalc: value.allowFreeTimeCalc !== false,
    startDate: value.startDate || '',
    endDate: value.endDate || ''
  }
}

function shareEntryOf(friendship, userId) {
  return normalizeShareEntry(friendship && friendship.share ? friendship.share[userId] : undefined)
}

// 按权限过滤课程字段；私密日程（private/shareable=false）任何级别都不返回
function filterCourseByPermission(course, permission) {
  if (!course || course.private === true || course.shareable === false) return null
  const base = { id: course.id, date: course.date || '', weekday: course.weekday, start: course.start, end: course.end, busy: true }
  if (permission.level === 'busy') return base
  base.title = course.title || ''
  base.courseCode = course.courseCode || ''
  if (permission.level === 'title') return base
  // detail：地点受 showLocation 开关控制
  base.place = permission.showLocation ? (course.place || '') : ''
  base.teacher = course.teacher || ''
  return base
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

async function friendSummary(user) {
  if (!user) return null
  const imageUrls = await resolvePublicImageUrls([user.avatarUrl])
  return {
    id: user.xipooId,
    name: user.name,
    avatar: user.avatar,
    avatarUrl: publicImageUrl(user.avatarUrl, imageUrls),
    signature: user.signature || ''
  }
}

async function myFriendships(meId) {
  const res = await friendships.where({ users: meId }).limit(500).get()
  return res.data || []
}

function friendshipBetween(list, meId, friendId) {
  return list.find((f) => Array.isArray(f.users) && f.users.includes(meId) && f.users.includes(friendId))
}

// ---- actions ----

async function searchUser(meId, payload) {
  const keyword = String(payload.xipooId || payload.keyword || '').trim().toUpperCase()
  if (!keyword) return ok([])
  const res = await users.where({ xipooId: keyword }).limit(10).get()
  const list = await Promise.all((res.data || [])
    .filter((u) => u.xipooId !== meId)
    .map((u) => friendSummary(u)))
  return ok(list)
}

async function listFriends(meId, includeHidden) {
  const list = await myFriendships(meId)
  const result = []
  const hiddenList = []
  for (const f of list) {
    const friendId = f.users.find((id) => id !== meId)
    const friend = await findUser(friendId)
    const summary = await friendSummary(friend)
    const hidden = Array.isArray(f.hidden) && f.hidden.includes(meId)
    const myPermission = shareEntryOf(f, meId)
    const friendPermission = shareEntryOf(f, friendId)
    const item = {
      id: f.id,
      friend: summary,
      myPermission,
      friendPermission,
      // 兼容旧前端：布尔视角（非 none 即视为有共享）
      myShare: myPermission.level !== 'none',
      friendShare: friendPermission.level !== 'none',
      // 同时满足「我共享给对方」和「对方共享给我」才标记为双向共享
      mutuallyShared: myPermission.level !== 'none' && friendPermission.level !== 'none',
      hidden
    }
    if (hidden && !includeHidden) {
      hiddenList.push(item)
    } else {
      result.push(item)
    }
  }
  return ok({ friends: result, hidden: hiddenList })
}

async function listRequests(meId) {
  const res = await friendRequests.where({ to: meId, status: 'pending' }).limit(200).get()
  const result = []
  for (const r of res.data || []) {
    const fromUser = await findUser(r.from)
    const summary = await friendSummary(fromUser)
    result.push(Object.assign({}, stripInternal(r), { fromUser: summary }))
  }
  return ok(result)
}

function stripInternal(doc) {
  const copy = Object.assign({}, doc)
  delete copy._id
  delete copy._openid
  return copy
}

async function sendRequest(meId, payload) {
  // 日程共享邀请：仅支持通过完整 Xipoo ID 或微信邀请连接现实中认识的同学
  const to = String(payload.toUserId || payload.friendId || '').trim().toUpperCase()
  if (!to) return fail('INVALID_PARAM', '缺少目标用户')
  if (to === meId) return fail('CANNOT_ADD_SELF', '不能添加自己')
  const sourceType = ['wechat_share', 'qr_code', 'share_code', 'xipoo_id'].includes(payload.sourceType)
    ? payload.sourceType
    : 'xipoo_id'

  const target = await findUser(to)
  if (!target) return fail('USER_NOT_FOUND', '用户不存在')

  const both = await friendships.where({ users: _.all([meId, to]) }).limit(1).get()
  if (both.data && both.data[0]) return fail('ALREADY_FRIENDS', '你们已经是日程联系人')

  const dup = await friendRequests.where({ from: meId, to, status: 'pending' }).limit(1).get()
  if (dup.data && dup.data[0]) return fail('DUPLICATE_REQUEST', '共享邀请已发送')

  await friendRequests.add({
    data: {
      id: `request-${Date.now()}`,
      from: meId,
      to,
      status: 'pending',
      sourceType,
      message: payload.message || '',
      createdAt: db.serverDate()
    }
  })
  return ok(true)
}

// 微信邀请卡片直达：接受方确认后直接建立联系人关系
async function acceptInvite(meId, payload) {
  const inviterId = String(payload.inviterId || payload.fromUserId || '').trim().toUpperCase()
  if (!inviterId) return fail('INVALID_PARAM', '缺少邀请人')
  if (inviterId === meId) return fail('CANNOT_ADD_SELF', '不能添加自己')
  const inviter = await findUser(inviterId)
  if (!inviter) return fail('USER_NOT_FOUND', '邀请人不存在')

  const both = await friendships.where({ users: _.all([meId, inviterId]) }).limit(1).get()
  if (both.data && both.data[0]) return fail('ALREADY_FRIENDS', '你们已经是日程联系人')

  const grantLevel = PERMISSION_LEVELS.includes(payload.grantLevel) ? payload.grantLevel : 'busy'
  const share = {}
  share[meId] = Object.assign({}, DEFAULT_PERMISSION, { level: grantLevel })
  share[inviterId] = Object.assign({}, DEFAULT_PERMISSION)
  await friendships.add({
    data: {
      id: `friendship-${Date.now()}`,
      users: [inviterId, meId],
      share,
      sourceType: 'wechat_share',
      createdAt: db.serverDate()
    }
  })
  // 清理双方之间可能存在的待处理邀请
  try {
    const pending = await friendRequests.where({ from: inviterId, to: meId, status: 'pending' }).limit(10).get()
    for (const req of pending.data || []) {
      await friendRequests.doc(req._id).update({ data: { status: 'accepted', resolvedAt: db.serverDate() } })
    }
  } catch (e) { /* 非关键 */ }
  return ok(true)
}

async function reviewRequest(meId, payload) {
  const requestId = payload.requestId
  const act = payload.action
  const found = await friendRequests.where({ id: requestId, to: meId }).limit(1).get()
  const request = found.data && found.data[0]
  if (!request || request.status !== 'pending') return fail('FRIEND_REQUEST_NOT_FOUND', '共享邀请不存在')

  if (act === 'accept') {
    await friendRequests.doc(request._id).update({ data: { status: 'accepted' } })
    const both = await friendships.where({ users: _.all([request.from, request.to]) }).limit(1).get()
    if (!(both.data && both.data[0])) {
      // 接受方可在接受时设置自己授予对方的权限（默认仅忙闲），邀请方默认同样仅忙闲
      const grantLevel = PERMISSION_LEVELS.includes(payload.grantLevel) ? payload.grantLevel : 'busy'
      const share = {}
      share[request.to] = Object.assign({}, DEFAULT_PERMISSION, {
        level: grantLevel,
        startDate: String(payload.startDate || ''),
        endDate: String(payload.endDate || '')
      })
      share[request.from] = Object.assign({}, DEFAULT_PERMISSION)
      await friendships.add({
        data: {
          id: `friendship-${Date.now()}`,
          users: [request.from, request.to],
          share,
          sourceType: request.sourceType || 'xipoo_id',
          createdAt: db.serverDate()
        }
      })
    }
    return ok(true)
  }

  if (act === 'reject') {
    await friendRequests.doc(request._id).update({ data: { status: 'rejected', resolvedAt: db.serverDate() } })
    return ok(true)
  }

  return fail('INVALID_PARAM', '未知操作')
}

async function deleteFriend(meId, payload) {
  const friendId = String(payload.friendUserId || payload.friendId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  await friendships.doc(f._id).remove()
  return ok(true)
}

async function setSchedulePermission(meId, payload) {
  // 旧版开关接口（兼容）：开启映射为 busy，关闭映射为 none
  const friendId = String(payload.friendUserId || payload.friendId || '').trim().toUpperCase()
  const enabled = payload.visible !== undefined ? Boolean(payload.visible) : Boolean(payload.enabled)
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  const next = Object.assign(shareEntryOf(f, meId), { level: enabled ? 'busy' : 'none' })
  await friendships.doc(f._id).update({ data: { ['share.' + meId]: next } })
  return ok(next)
}

// 新版：设置“对方可以查看我的内容”的权限等级与附加开关
async function setSharePermission(meId, payload) {
  const friendId = String(payload.friendUserId || payload.friendId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  const current = shareEntryOf(f, meId)
  const next = {
    level: PERMISSION_LEVELS.includes(payload.level) ? payload.level : current.level,
    showLocation: payload.showLocation === undefined ? current.showLocation : Boolean(payload.showLocation),
    allowFreeTimeCalc: payload.allowFreeTimeCalc === undefined ? current.allowFreeTimeCalc : Boolean(payload.allowFreeTimeCalc),
    startDate: payload.startDate === undefined ? current.startDate : String(payload.startDate || ''),
    endDate: payload.endDate === undefined ? current.endDate : String(payload.endDate || '')
  }
  await friendships.doc(f._id).update({ data: { ['share.' + meId]: next, updatedAt: db.serverDate() } })
  return ok(next)
}

async function toggleShare(meId, payload) {
  // 旧版翻转接口（兼容）：none ↔ busy 之间切换
  const friendId = String(payload.friendId || payload.friendUserId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  const current = shareEntryOf(f, meId)
  const next = Object.assign({}, current, { level: current.level === 'none' ? 'busy' : 'none' })
  await friendships.doc(f._id).update({ data: { ['share.' + meId]: next } })
  return ok(next.level !== 'none')
}

async function getFriendProfile(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('PERMISSION_DENIED', '只有建立日程联系人关系后才能查看共享设置')
  const friend = await findUser(friendId)
  if (!friend) return fail('USER_NOT_FOUND', '用户不存在')

  const visibility = Object.assign(
    { gender: true, degree: true, major: true, school: true, tags: true, bio: true },
    friend.profileVisibility || {}
  )
  const share = f.share || {}
  // 从 friendships 文档中读取备注：从 note map 中以当前用户视角获取对好友的备注
  const noteMap = f.note || {}
  const note = noteMap[meId] || ''
  const myPermission = shareEntryOf(f, meId)
  const friendPermission = shareEntryOf(f, friendId)
  const showcaseImages = Array.isArray(friend.showcaseImages) ? friend.showcaseImages : []
  const imageUrls = await resolvePublicImageUrls([
    friend.avatarUrl,
    friend.coverUrl,
    ...showcaseImages
  ])
  return ok({
    id: friend.xipooId,
    name: friend.name,
    avatar: friend.avatar,
    avatarUrl: publicImageUrl(friend.avatarUrl, imageUrls),
    signature: friend.signature || '',
    profileTheme: friend.profileTheme || 'mint',
    coverUrl: publicImageUrl(friend.coverUrl, imageUrls),
    gender: friend.gender || '',
    degree: friend.degree || '',
    major: friend.major || '',
    school: friend.school || '',
    featureTags: visibility.tags ? (friend.featureTags || []) : [],
    bio: visibility.bio ? (friend.bio || '') : '',
    tags: Array.isArray(friend.tags) ? friend.tags : [],
    showcaseImages: showcaseImages.map((value) => publicImageUrl(value, imageUrls)).filter(Boolean),
    visibility,
    myPermission,
    friendPermission,
    myScheduleShared: myPermission.level !== 'none',
    friendScheduleShared: friendPermission.level !== 'none',
    note
  })
}

// 多人共同空闲属于日程联系人授权的一部分。使用精简的 friend 云函数执行，
// 不依赖体积较大的 match 社交模块，三人及以上也只校验“我 ↔ 每位参与者”。
async function calculateAvailability(meId, payload) {
  const rawIds = payload && (payload.friendIds || payload.participantUserIds)
  const friendIds = Array.from(new Set((Array.isArray(rawIds) ? rawIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && id !== meId)))
  const startDate = payload && payload.startDate
  const endDate = payload && payload.endDate
  const range = (payload && (payload.range || payload.timeRange)) || {}
  if (!friendIds.length) return fail('INVALID_PARAM', '请至少选择一位日程联系人')
  if (friendIds.length > 8) return fail('INVALID_PARAM', '一次最多选择 8 位联系人')
  if (!startDate || !endDate || startDate > endDate) return fail('INVALID_PARAM', '请选择正确的日期范围')

  const relations = await myFriendships(meId)
  const relationByFriendId = {}
  relations.forEach((relation) => {
    if (!Array.isArray(relation.users)) return
    const id = relation.users.find((value) => value !== meId)
    if (id) relationByFriendId[id] = relation
  })

  const ids = [meId].concat(friendIds)
  const people = await Promise.all(ids.map((id) => findUser(id)))
  const peopleById = {}
  people.forEach((person) => { if (person) peopleById[person.xipooId] = person })
  for (const friendId of friendIds) {
    const relation = relationByFriendId[friendId]
    const name = (peopleById[friendId] && peopleById[friendId].name) || friendId
    if (!relation) return fail('GROUP_PERMISSION_DENIED', `你与 ${name} 尚未建立日程联系人关系`)
    const mine = shareEntryOf(relation, meId)
    const theirs = shareEntryOf(relation, friendId)
    if (mine.level === 'none' || theirs.level === 'none') return fail('GROUP_PERMISSION_DENIED', `你与 ${name} 尚未完成双向日程共享`)
    if (!mine.allowFreeTimeCalc || !theirs.allowFreeTimeCalc) return fail('GROUP_PERMISSION_DENIED', `${name} 未允许参与共同空闲计算`)
  }

  const schedulesByUser = {}
  await Promise.all(ids.map(async (id) => {
    const result = await schedules.where({ userId: id }).limit(500).get()
    schedulesByUser[id] = result.data || []
  }))
  const participants = ids.map((id) => {
    const person = peopleById[id] || {}
    return { id, name: person.name || id, avatar: person.avatar || '?' }
  })
  console.log('[friend.calculateAvailability]', { participantCount: participants.length, startDate, endDate })
  return ok(groupFreeSlotsCore(participants, schedulesByUser, startDate, endDate, range))
}

async function setFriendNote(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  const note = String(payload.note || '').trim()
  await friendships.doc(f._id).update({ data: { ['note.' + meId]: note } })
  return ok({ note })
}

async function getFriendSchedule(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('PERMISSION_DENIED', '只有建立日程联系人关系后才能查看日程')
  // 联系人关系不等于日程查看权限：必须单独检查对方授权给我的 permission
  const permission = shareEntryOf(f, friendId)
  if (permission.level === 'none') return fail('PERMISSION_DENIED', '对方尚未向你开放日程')
  const res = await schedules.where({ userId: friendId }).limit(200).get()
  return ok((res.data || [])
    .filter((doc) => {
      // 共享有效期范围过滤
      if (permission.startDate && doc.date && doc.date < permission.startDate) return false
      if (permission.endDate && doc.date && doc.date > permission.endDate) return false
      return true
    })
    .map((doc) => filterCourseByPermission(doc, permission))
    .filter(Boolean))
}

async function hideFriend(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  if (!friendId) return fail('INVALID_PARAM', '缺少联系人 ID')
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  // 将当前用户 ID 添加到 hidden 数组
  await friendships.doc(f._id).update({ data: { hidden: _.addToSet(meId) } })
  return ok({ hidden: true, friendId })
}

async function unhideFriend(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  if (!friendId) return fail('INVALID_PARAM', '缺少联系人 ID')
  const list = await myFriendships(meId)
  const f = friendshipBetween(list, meId, friendId)
  if (!f) return fail('FRIENDSHIP_NOT_FOUND', '联系人关系不存在')
  // 从 hidden 数组中移除当前用户 ID
  await friendships.doc(f._id).update({ data: { hidden: _.pull(meId) } })
  return ok({ hidden: false, friendId })
}

async function listHiddenFriends(meId) {
  const list = await myFriendships(meId)
  const result = []
  for (const f of list) {
    if (!Array.isArray(f.hidden) || !f.hidden.includes(meId)) continue
    const friendId = f.users.find((id) => id !== meId)
    const friend = await findUser(friendId)
    const share = f.share || {}
    const summary = await friendSummary(friend)
    result.push({
      id: f.id,
      friend: summary,
      myShare: Boolean(share[meId]),
      friendShare: Boolean(share[friendId]),
      hidden: true
    })
  }
  return ok(result)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const { action, payload = {} } = event || {}

    if (action === 'ping') {
      return ok({
        openid,
        env: wxContext.ENV,
        time: Date.now(),
        version: FRIEND_RUNTIME_VERSION,
        groupAvailability: true,
        imageUrls: 'https-temp-url'
      })
    }
    if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')

    const meId = await currentUserId(openid)
    if (!meId) return fail('USER_NOT_FOUND', '用户不存在，请重新登录')

    switch (action) {
      case 'searchUser': return await searchUser(meId, payload)
      case 'listFriends': return await listFriends(meId)
      case 'listRequests': return await listRequests(meId)
      case 'sendRequest': {
        // 内容安全：好友申请附言检测（scene=2 评论/留言）
        if (await secCheck.isTextRisky(openid, [payload && payload.message], 2)) {
          return secCheck.contentRisky()
        }
        return await sendRequest(meId, payload)
      }
      case 'reviewRequest': return await reviewRequest(meId, payload)
      case 'deleteFriend': return await deleteFriend(meId, payload)
      case 'setSchedulePermission': return await setSchedulePermission(meId, payload)
      case 'setSharePermission': return await setSharePermission(meId, payload)
      case 'acceptInvite': return await acceptInvite(meId, payload)
      case 'toggleShare': return await toggleShare(meId, payload)
      case 'getFriendProfile': return await getFriendProfile(meId, payload)
      case 'getFriendSchedule': return await getFriendSchedule(meId, payload)
      case 'calculateAvailability': return await calculateAvailability(meId, payload)
      case 'setFriendNote': {
        // 内容安全：好友备注检测（scene=1 资料）
        if (await secCheck.isTextRisky(openid, [payload && payload.note], 1)) {
          return secCheck.contentRisky()
        }
        return await setFriendNote(meId, payload)
      }
      case 'hideFriend': return await hideFriend(meId, payload)
      case 'unhideFriend': return await unhideFriend(meId, payload)
      case 'listHiddenFriends': return await listHiddenFriends(meId)
      default: return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[friend cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
