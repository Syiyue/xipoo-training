const cloud = require('wx-server-sdk')
const lib = require('./lib')
const matchLib = require('./matchLib')
const secCheck = require('./secCheck')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const users = db.collection('users')
const friendships = db.collection('friendships')
const schedules = db.collection('schedules')
const scheduleMatches = db.collection('schedule_matches')
const matchPoolCol = db.collection('match_pool')
const matchRequestsCol = db.collection('match_requests')
const matchedPairsCol = db.collection('matched_pairs')
const userBlocksCol = db.collection('user_blocks')
const postsCol = db.collection('posts')
const notificationsCol = db.collection('notifications')

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000
// 用控制台 ping 的 version 核验 $LATEST 确实运行了包含多人修复的代码。
const MATCH_RUNTIME_VERSION = 'v6-safe-presence-owner-links-0814'

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

function stripId(record) {
  const copy = Object.assign({}, record)
  delete copy._id
  return copy
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

async function getUserSchedules(userId) {
  const res = await schedules.where({ userId }).limit(500).get()
  return res.data || []
}

// 一次查询参与者的所有课表，避免三人以上时多次数据库往返与连接争抢。
// 查询异常时再降级为逐人读取，保证旧数据与异常用户不会拖垮整个计算。
async function loadSchedulesFor(participants) {
  const map = {}
  const ids = (participants || []).map((p) => p.id).filter(Boolean)
  ids.forEach((id) => { map[id] = [] })
  try {
    const res = await schedules.where({ userId: db.command.in(ids) }).limit(500).get()
    ;(res.data || []).forEach((course) => {
      if (map[course.userId]) map[course.userId].push(course)
    })
    return map
  } catch (batchError) {
    console.error('[loadSchedulesFor] 批量拉取课表失败，转逐人读取', batchError && batchError.message)
  }
  const entries = await Promise.all(ids.map(async (id) => {
    try { return [id, await getUserSchedules(id)] }
    catch (error) {
      console.error('[loadSchedulesFor] 拉取课表失败 id=' + id, error && error.message)
      return [id, []]
    }
  }))
  entries.forEach(([id, list]) => { map[id] = list })
  return map
}

async function myFriendships(meId) {
  const res = await friendships.where({ users: meId }).limit(500).get()
  return res.data || []
}

// 日程共享权限（与 friend 云函数一致）：兼容旧布尔值 true→busy / false→none
function shareEntryOf(friendship, userId) {
  const value = friendship && friendship.share ? friendship.share[userId] : undefined
  if (value === true) return { level: 'busy', allowFreeTimeCalc: true }
  if (!value || value === false) return { level: 'none', allowFreeTimeCalc: true }
  return {
    level: ['none', 'busy', 'title', 'detail'].includes(value.level) ? value.level : 'none',
    allowFreeTimeCalc: value.allowFreeTimeCalc !== false
  }
}

async function validateGroup(meId, friendIds) {
  // 页面传来的 ID 可能带有空格或重复项；标准化后避免把自己当作被邀请联系人，
  // 也避免三人场景重复查询同一份关系。
  const uniqueFriendIds = Array.from(new Set((friendIds || [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && id !== meId)))
  if (uniqueFriendIds.length < 1) throw new Error('请至少选择一位日程联系人')
  if (uniqueFriendIds.length > 8) throw new Error('一次最多选择 8 位联系人')
  const participantIds = [meId].concat(uniqueFriendIds)

  // 一次拉取当前用户全部联系人关系，避免 3 人及以上时逐对查询请求量线性放大导致超时
  const myList = await myFriendships(meId)
  const friendshipMap = new Map()
  for (const f of myList) {
    if (!Array.isArray(f.users)) continue
    for (const uid of f.users) {
      friendshipMap.set([meId, uid].sort().join('|'), f)
    }
  }

  // 批量查询参与者资料，避免串行 findUser 累积延迟
  const _ = db.command
  const userRes = await users.where({ xipooId: _.in(participantIds) }).limit(30).get()
  const userMap = {}
  ;(userRes.data || []).forEach((u) => { userMap[u.xipooId] = u })
  const nameOf = (id) => (userMap[id] && userMap[id].name) || id

  console.log('[validateGroup] participants=' + JSON.stringify(participantIds))
  for (const friendId of uniqueFriendIds) {
    const fs = friendshipMap.get([meId, friendId].sort().join('|'))
    if (!fs) {
      throw new Error(nameOf(meId) + ' 与 ' + nameOf(friendId) + ' 之间缺少日程联系人关系，请确认对方已接受你的共享邀请')
    }
    const permA = shareEntryOf(fs, meId)
    const permB = shareEntryOf(fs, friendId)
    if (permA.level === 'none' || permB.level === 'none') {
      throw new Error(nameOf(meId) + ' 与 ' + nameOf(friendId) + ' 尚未完成双向日程共享，请每人都向对方授予完整课程信息权限')
    }
    if (!permA.allowFreeTimeCalc || !permB.allowFreeTimeCalc) {
      const who = permA.allowFreeTimeCalc ? friendId : meId
      throw new Error(nameOf(who) + ' 未允许参与共同空闲计算')
    }
  }

  return participantIds.map((id) => ({
    id,
    name: nameOf(id),
    avatar: (userMap[id] && userMap[id].avatar) || '?'
  }))
}

async function friendScheduleFor(meId, friendId) {
  const list = await myFriendships(meId)
  const f = list.find((x) => Array.isArray(x.users) && x.users.includes(friendId))
  if (!f || shareEntryOf(f, friendId).level === 'none') throw new Error('对方尚未向你开放日程')
  return await getUserSchedules(friendId)
}

// ---- 内存 DB 操作（供 matchLib 使用） ----

async function fetchAll(collName, maxCount) {
  const max = maxCount || 5000
  const col = db.collection(collName)
  const out = []
  const BATCH = 100
  for (let skip = 0; skip < max; skip += BATCH) {
    let res
    try { res = await col.skip(skip).limit(BATCH).get() }
    catch (e) { return out }
    const rows = res.data || []
    out.push(...rows)
    if (rows.length < BATCH) break
  }
  return out
}

async function loadMemDb() {
  const [allUsers, allSchedules, poolData, requestsData, pairsData, blocksData] = await Promise.all([
    fetchAll('users'),
    fetchAll('schedules'),
    fetchAll('match_pool'),
    fetchAll('match_requests'),
    fetchAll('matched_pairs'),
    fetchAll('user_blocks')
  ])
  const memUsers = allUsers.map((u) => Object.assign({}, u, { id: u.xipooId }))
  return {
    users: memUsers,
    schedulesFlat: allSchedules,
    matchPool: poolData,
    matchRequests: requestsData,
    matchedPairs: pairsData,
    userBlocks: blocksData
  }
}

async function persistMatchChanges(memDb) {
  const tasks = []
  const origPool = await fetchAll('match_pool')
  ;(memDb.matchPool || []).forEach((record) => {
    if (!record.userId) return
    const orig = origPool.find((o) => o.userId === record.userId)
    if (!orig) { tasks.push(matchPoolCol.add({ data: stripId(record) })) }
    else if (JSON.stringify(stripId(orig)) !== JSON.stringify(record)) { tasks.push(matchPoolCol.doc(orig._id).update({ data: stripId(record) })) }
  })
  const origReq = await fetchAll('match_requests')
  ;(memDb.matchRequests || []).forEach((record) => {
    if (!record.id) return
    const orig = origReq.find((o) => o.id === record.id)
    if (!orig) { tasks.push(matchRequestsCol.add({ data: stripId(record) })) }
    else if (JSON.stringify(stripId(orig)) !== JSON.stringify(record)) { tasks.push(matchRequestsCol.doc(orig._id).update({ data: stripId(record) })) }
  })
  const origPairs = await fetchAll('matched_pairs')
  // 删除被移除的 pair（如屏蔽导致的解除匹配）
  if (memDb._removedPairIds && memDb._removedPairIds.length > 0) {
    for (var r = 0; r < memDb._removedPairIds.length; r++) {
      var rpid = memDb._removedPairIds[r]
      for (var o = 0; o < origPairs.length; o++) {
        if (origPairs[o].id === rpid && origPairs[o]._id) {
          tasks.push(matchedPairsCol.doc(origPairs[o]._id).remove())
          break
        }
      }
    }
  }
  ;(memDb.matchedPairs || []).forEach((record) => {
    if (!record.id) return
    const orig = origPairs.find((o) => o.id === record.id)
    if (!orig) { tasks.push(matchedPairsCol.add({ data: stripId(record) })) }
    else if (JSON.stringify(stripId(orig)) !== JSON.stringify(record)) { tasks.push(matchedPairsCol.doc(orig._id).update({ data: stripId(record) })) }
  })
  const origBlocks = await fetchAll('user_blocks')
  if (memDb._removedBlockIds && memDb._removedBlockIds.length > 0) {
    for (var rb = 0; rb < memDb._removedBlockIds.length; rb++) {
      var rbid = memDb._removedBlockIds[rb]
      for (var ob = 0; ob < origBlocks.length; ob++) {
        if (origBlocks[ob].id === rbid && origBlocks[ob]._id) {
          tasks.push(userBlocksCol.doc(origBlocks[ob]._id).remove())
          break
        }
      }
    }
  }
  ;(memDb.userBlocks || []).forEach((record) => {
    if (!record.id) return
    const orig = origBlocks.find((o) => o.id === record.id)
    if (!orig) { tasks.push(userBlocksCol.add({ data: stripId(record) })) }
    else if (JSON.stringify(stripId(orig)) !== JSON.stringify(record)) { tasks.push(userBlocksCol.doc(orig._id).update({ data: stripId(record) })) }
  })
  ;(memDb.users || []).forEach((u) => {
    if (!u._id || !u._updated) return
    const patch = {}
    if (u.freeTimeBitmap !== undefined) patch.freeTimeBitmap = u.freeTimeBitmap
    if (u.selectedTags !== undefined) patch.selectedTags = u.selectedTags
    if (u.lastActiveAt !== undefined) patch.lastActiveAt = u.lastActiveAt
    if (Object.keys(patch).length) { patch.updatedAt = db.serverDate(); tasks.push(users.doc(u._id).update({ data: patch })) }
  })
  await Promise.all(tasks)
}

function isMatchAction(action) {
  return typeof action === 'string' && action.startsWith('match:')
}

async function touchLastActive(openid) {
  try {
    const record = await users.where({ openid }).limit(1).get()
    if (record.data && record.data[0]) {
      await users.doc(record.data[0]._id).update({ data: { lastActiveAt: new Date().toISOString() } })
    }
  } catch (e) { /* 非关键 */ }
}

// ---- schedule match actions (lib) ----

async function matchWithFriend(meId, payload) {
  const friendId = String(payload.friendId || '').trim().toUpperCase()
  const date = payload.date
  const range = payload.range || {}
  if (!friendId || !date) return fail('INVALID_PARAM', '缺少好友或日期')

  const mineAll = await getUserSchedules(meId)
  const theirsAll = await friendScheduleFor(meId, friendId)
  const mine = mineAll.filter((c) => c.date === date)
  const theirs = theirsAll.filter((c) => c.date === date)
  return ok(lib.matchWithFriendCore(mine, theirs, date, range))
}

async function calculateAvailability(meId, payload) {
  const friendIds = payload.friendIds || payload.participantUserIds || []
  const startDate = payload.startDate
  const endDate = payload.endDate
  const range = payload.range || payload.timeRange || {}

  // 入参校验：缺失必填项直接返回友好错误，不让底层抛异常暴露 -501000
  if (!Array.isArray(friendIds) || friendIds.length === 0) {
    return fail('INVALID_PARAM', '请至少选择一位日程联系人')
  }
  if (!startDate || !endDate) {
    return fail('INVALID_PARAM', '请选择开始和结束日期')
  }
  if (startDate > endDate) {
    return fail('INVALID_PARAM', '开始日期不能晚于结束日期')
  }

  try {
    console.log('[match.calculate] request', {
      friendCount: friendIds.length,
      startDate,
      endDate
    })
    const participants = await validateGroup(meId, friendIds)
    console.log('[match.calculate] validated', {
      participantCount: participants.length
    })
    const schedulesByUser = await loadSchedulesFor(participants)
    const result = lib.groupFreeSlotsCore(participants, schedulesByUser, startDate, endDate, range)
    console.log('[match.calculate] complete', {
      participantCount: participants.length,
      dayCount: result.days.length
    })
    return ok(result)
  } catch (error) {
    // 业务校验（缺少好友关系/未双向共享）已在 validateGroup 抛出友好 message，
    // 这里统一包装为业务错误码返回，绝不裸抛导致 SDK -501000。
    return fail('GROUP_CALC_FAILED', error && error.message ? error.message : '共同空闲计算失败')
  }
}

async function createScheduleMatch(meId, payload) {
  const friendIds = payload.friendIds || []
  const participants = await validateGroup(meId, friendIds)
  const schedulesByUser = await loadSchedulesFor(participants)
  const result = lib.groupFreeSlotsCore(participants, schedulesByUser, payload.startDate, payload.endDate, payload.range || {})

  const now = Date.now()
  const record = {
    id: `schedule-match-${now}`,
    creatorUserId: meId,
    participantIds: participants.map((p) => p.id),
    createdAt: db.serverDate(),
    expiresAt: new Date(now + NINETY_DAYS),
    result
  }
  const added = await scheduleMatches.add({ data: record })
  return ok(Object.assign({ _id: added._id }, record, { createdAt: new Date(now).toISOString(), expiresAt: new Date(now + NINETY_DAYS).toISOString() }))
}

async function getMatchResult(meId, payload) {
  const matchId = payload.matchResultId || payload.matchId || payload.id
  if (!matchId) return fail('INVALID_PARAM', '缺少匹配 ID')
  const res = await scheduleMatches.where({ id: matchId }).limit(1).get()
  const record = res.data && res.data[0]
  if (!record) return fail('MATCH_NOT_FOUND', '匹配结果不存在')
  const expireTs = record.expiresAt instanceof Date ? record.expiresAt.getTime() : new Date(record.expiresAt).getTime()
  if (expireTs <= Date.now()) return fail('MATCH_NOT_FOUND', '匹配结果已过期')
  if (!record.participantIds.includes(meId)) return fail('MATCH_PERMISSION_DENIED', '只有参与者可以查看该结果')
  const copy = Object.assign({}, record)
  delete copy._id
  delete copy._openid
  return ok(copy)
}

// ---- 帖子 CRUD ----

function isPostExpired(post) {
  if (!post.deadline) return false
  var d = post.deadline
  // 兼容 Date 对象（数据库可能返回 Date 类型）
  if (typeof d === 'object' && d.getTime) return d.getTime() <= Date.now()
  d = String(d).trim()
  if (!d) return false
  // 旧格式：只有日期（YYYY-MM-DD，10 个字符），按当天 23:59:59 北京时间处理
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    var parts = d.split('-')
    var deadlineMs = Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 15, 59, 59) // 23:59:59 CST = 15:59:59 UTC
    console.log('[isPostExpired] date-only:', d, 'deadline:', new Date(deadlineMs).toISOString(), 'now:', new Date().toISOString())
    return deadlineMs <= Date.now()
  }
  // 空格分隔 → ISO 格式，然后显式加北京时间后缀避免服务器 UTC 时区导致 8 小时偏差
  if (d.indexOf('T') < 0 && d.indexOf(' ') >= 0) d = d.replace(' ', 'T')
  // 无时区后缀则假定为北京时间
  if (d.indexOf('+') < 0 && d.indexOf('Z') < 0 && d.indexOf('T') >= 0) d = d + '+08:00'
  console.log('[isPostExpired] deadline:', d, 'parsed:', new Date(d).toISOString(), 'now:', new Date().toISOString())
  return new Date(d).getTime() <= Date.now()
}

function normalizeDeadline(deadline) {
  var d = String(deadline || '').trim()
  if (!d) return ''
  if (d.indexOf('T') < 0 && d.indexOf(' ') >= 0) d = d.replace(' ', 'T')
  if (d.indexOf('+') < 0 && d.indexOf('Z') < 0 && d.indexOf('T') >= 0) d = d + '+08:00'
  return d
}

async function closeExpiredPost(post) {
  if (!post._id || !isPostExpired(post)) return
  if (post.status !== 'active') return // 已关闭则跳过，避免重复通知
  try {
    await postsCol.doc(post._id).update({ data: { status: 'closed', closeReason: 'expired', updatedAt: db.serverDate() } })
  } catch (e) { /* 非关键 */ }
  // 通知发起人和所有成员
  notifyPostStatusChange(post, 'post_expired')
}

// 向帖子的发起人和所有成员发送状态变更通知
function notifyPostStatusChange(post, type) {
  const memberIds = post.memberIds || []
  const creatorId = post.creatorUserId
  const recipients = new Set([creatorId, ...memberIds].filter(Boolean))
  const postTitle = post.title || ''
  const postId = post.id || ''
  recipients.forEach(function(uid) {
    writeNotification(uid, { type, postId, postTitle })
  })
}


async function listPosts(meId, payload) {
  const postType = payload.type || payload.postType || 'general'
  const courseId = payload.courseId || ''
  const memberId = payload.memberId || ''
  const parts = courseId.split('_')
  const courseCode = parts[0] || ''
  let query = { type: postType, status: 'active' }
  if (courseId) query.courseId = courseId
  try {
    let res = await postsCol.where(query).orderBy('createdAt', 'desc').limit(100).get()
    // 精确 courseId 没匹配到，宽松匹配：先按 courseCode 前缀，再检查帖子关联的课表
    if (courseCode && (!res.data || res.data.length === 0) && courseId) {
      delete query.courseId
      const allRes = await postsCol.where(query).orderBy('createdAt', 'desc').limit(200).get()
      const allPosts = allRes.data || []
      res = { data: allPosts.filter((p) => {
        const pcid = p.courseId || ''
        return pcid.startsWith(courseCode + '_') || pcid.toUpperCase().includes(courseCode.toUpperCase())
      }) }
    }
    const raw = res.data || []
    // 过滤已过期的帖子，并异步关闭
    const expiredPosts = raw.filter((p) => isPostExpired(p))
    expiredPosts.forEach((p) => { closeExpiredPost(p); p.status = 'closed' })
    const activePosts = raw.filter((p) => !isPostExpired(p))

    // memberId 模式：额外拉取已关闭/过期的帖子（仅此用户为成员或发起人的）
    let memberClosedPosts = []
    if (memberId) {
      try {
        const closedRes = await postsCol.where({ type: postType, status: 'closed' })
          .orderBy('updatedAt', 'desc').limit(100).get()
        memberClosedPosts = (closedRes.data || []).filter((p) => {
          const members = p.memberIds || []
          return p.creatorUserId === memberId || members.includes(memberId)
        })
        // 合并 activePosts 中该用户也是成员的过期帖
        const expiredForMember = expiredPosts.filter((p) => {
          const members = p.memberIds || []
          return p.creatorUserId === memberId || members.includes(memberId)
        })
        // 合并所有（active + 已关闭的成员帖），去重
        const seen = new Set(activePosts.map((p) => p.id))
        expiredForMember.forEach((p) => {
          if (!seen.has(p.id)) { seen.add(p.id); activePosts.push(p) }
        })
        memberClosedPosts.forEach((p) => {
          if (!seen.has(p.id)) { seen.add(p.id); activePosts.push(p) }
        })
      } catch (e) { /* 拉取已关闭帖子失败不影响主流程 */ }
    }

    const allPosts = activePosts.filter(function(p) {
      var removed = p.removedMemberIds || []
      return removed.indexOf(meId) === -1
    })
    const creatorIds = [...new Set(allPosts.map((p) => p.creatorUserId).filter(Boolean))]
    const creatorMap = {}
    if (creatorIds.length > 0) {
      const _ = db.command
      const userRes = await users.where({ xipooId: _.in(creatorIds) }).field({ xipooId: true, name: true, avatar: true, avatarUrl: true, signature: true, grade: true, gender: true }).limit(200).get()
      ;(userRes.data || []).forEach((u) => { creatorMap[u.xipooId] = u })
    }
    return ok(allPosts.map((p) => {
      const copy = Object.assign({}, p)
      delete copy._openid
      const c = creatorMap[copy.creatorUserId]
      if (c) copy.creator = { id: c.xipooId, name: c.name, nickname: c.name, avatar: c.avatarUrl || c.avatar || '', signature: c.signature || '', grade: c.grade || '', gender: c.gender || '' }
      return copy
    }))
  } catch (err) {
    return ok([])
  }
}

async function createPost(meId, payload) {
  const title = String(payload.title || '').trim()
  const description = String(payload.description || '').trim()
  if (!title || !description) return fail('INVALID_PARAM', '标题和描述不能为空')
  const postType = payload.type || payload.postType || 'general'
  const courseId = postType === 'course' ? (payload.courseId || '') : ''

  // 防重复提交：5 秒内同用户同标题同课程不重复创建
  const FIVE_SEC = 5000
  const recentThreshold = new Date(Date.now() - FIVE_SEC)
  try {
    const dupRes = await postsCol.where({
      creatorUserId: meId,
      title,
      courseId,
      status: 'active',
      createdAt: db.command.gte(recentThreshold)
    }).limit(1).get()
    if (dupRes.data && dupRes.data.length > 0) {
      const existing = dupRes.data[0]
      const copy = Object.assign({}, existing)
      delete copy._openid
      return ok(Object.assign({ _id: existing._id }, copy, { _dedup: true }))
    }
  } catch (e) { /* 去重检查失败不影响主流程 */ }

  const now = Date.now()
  const post = {
    id: `post-${now}`,
    type: postType,
    courseId,
    courseName: postType === 'course' ? (payload.courseName || '') : '',
    title,
    description,
    maxMembers: payload.maxMembers || 4,
    genderFilter: payload.genderFilter || 'any',
    deadline: normalizeDeadline(payload.deadline || ''),
    place: payload.place || '',
    creatorUserId: meId,
    memberIds: [meId],
    confirmedMemberIds: [meId],
    removedMemberIds: [],
    status: 'active',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  try {
    const added = await postsCol.add({ data: post })
    return ok(Object.assign({ _id: added._id }, post, { createdAt: new Date(now).toISOString() }))
  } catch (err) {
    return fail('CREATE_POST_FAILED', err.message || '发布失败')
  }
}

async function getPost(meId, payload) {
  const postId = payload.postId || payload.id
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  // 检查截止时间，过期自动关闭
  if (post.status === 'active' && isPostExpired(post)) {
    closeExpiredPost(post)
    post.status = 'closed'
    post.closeReason = 'expired'
  }
  // 已关闭/过期的帖子，仅成员和发起人可见
  if (post.status === 'closed') {
    const memberIds = post.memberIds || []
    if (post.creatorUserId !== meId && !memberIds.includes(meId)) {
      return fail('POST_CLOSED', '帖子已关闭')
    }
  }
  const copy = Object.assign({}, post)
  delete copy._openid

  // 查询所有成员的用户信息
  const memberIds = copy.memberIds || []
  const allMemberIds = [...new Set([copy.creatorUserId, ...memberIds].filter(Boolean))]
  try {
    if (allMemberIds.length > 0) {
      const _ = db.command
      const userRes = await users.where({ xipooId: _.in(allMemberIds) }).field({ xipooId: true, name: true, avatar: true, avatarUrl: true, signature: true, grade: true, gender: true, buddyWechatId: true }).limit(50).get()
      const userMap = {}
      ;(userRes.data || []).forEach(function(u) {
        userMap[u.xipooId] = {
          id: u.xipooId,
          nickname: u.name || u.xipooId,
          name: u.name || '',
          avatar: u.avatarUrl || u.avatar || '',
          signature: u.signature || '',
          grade: u.grade || '',
          gender: u.gender || '',
          buddyWechatId: u.buddyWechatId || ''
        }
      })
      const isViewerMember = copy.creatorUserId === meId || memberIds.includes(meId)
      copy.members = allMemberIds.map(function(id) {
        var info = userMap[id] || { id: id, nickname: id, name: '', avatar: '', signature: '', grade: '', gender: '', buddyWechatId: '' }
        info.isCreator = id === copy.creatorUserId
        // 非成员看不到联系方式
        if (!isViewerMember && id !== meId) {
          info.buddyWechatId = ''
        }
        return info
      })

      // 保持 creator 字段兼容（非成员不返回联系方式）
      const creatorInfo = userMap[copy.creatorUserId]
      if (creatorInfo) {
        copy.creator = Object.assign({}, creatorInfo)
        if (!isViewerMember && copy.creatorUserId !== meId) {
          copy.creator.buddyWechatId = ''
        }
      }
    }
  } catch (e) { /* 非关键 */ }

  return ok(copy)
}

async function closePost(meId, payload) {
  const postId = payload.postId || payload.id
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId, creatorUserId: meId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在或无权操作')
  await postsCol.doc(post._id).update({ data: { status: 'closed', closeReason: 'manual', updatedAt: db.serverDate() } })
  return ok({ closed: true })
}

async function myJoinedGroups(meId) {
  try {
    const _ = db.command
    // 获取所有帖子（覆盖所有课程），在内存中筛选
    const res = await postsCol.orderBy('createdAt', 'desc').limit(200).get()
    const allPosts = res.data || []

    // 收集相关的帖子：我在 memberIds 中，或者我申请过
    const related = []
    const creatorIds = new Set()
    allPosts.forEach(function(p) {
      var archivedBy = p.archivedBy || []
      if (archivedBy.includes(meId)) return
      var removedMemberIds = p.removedMemberIds || []
      if (removedMemberIds.includes(meId)) return
      var memberIds = p.memberIds || []
      var applications = p.applications || []
      var isMember = memberIds.includes(meId)
      var myApp = applications.find(function(a) { return a.userId === meId })

      var isCreator = p.creatorUserId === meId

      if (isMember || isCreator) {
        // 招募中 → recruiting；手动关闭/已过期 → ended；已满员 → joined
        creatorIds.add(p.creatorUserId)
        var memberStatus
        if (p.status === 'active') {
          memberStatus = 'recruiting'
        } else if (p.closeReason === 'manual' || p.closeReason === 'expired') {
          memberStatus = 'ended'
        } else {
          memberStatus = 'joined'
        }
        related.push({
          id: p.id, title: p.title,
          courseId: p.courseId || '', courseName: p.courseName || '',
          memberIds: memberIds, maxMembers: p.maxMembers || 4,
          status: p.status, creatorUserId: p.creatorUserId,
          _myStatus: memberStatus
        })
      } else if (myApp && myApp.status === 'pending') {
        // 申请中 → 招募中（帖子active）或已结束（帖子closed）
        creatorIds.add(p.creatorUserId)
        related.push({
          id: p.id, title: p.title,
          courseId: p.courseId || '', courseName: p.courseName || '',
          memberIds: memberIds, maxMembers: p.maxMembers || 4,
          status: p.status, creatorUserId: p.creatorUserId,
          _myStatus: p.status === 'active' ? 'recruiting' : 'ended'
        })
      } else if (myApp && myApp.status === 'rejected') {
        // 被拒 → 已结束
        creatorIds.add(p.creatorUserId)
        related.push({
          id: p.id, title: p.title,
          courseId: p.courseId || '', courseName: p.courseName || '',
          memberIds: memberIds, maxMembers: p.maxMembers || 4,
          status: p.status, creatorUserId: p.creatorUserId,
          _myStatus: 'ended'
        })
      }
    })

    // 批量查询发起人信息
    const creatorIdsArr = Array.from(creatorIds).filter(Boolean)
    const creatorMap = {}
    if (creatorIdsArr.length > 0) {
      const userRes = await users.where({ xipooId: _.in(creatorIdsArr) }).field({ xipooId: true, name: true, avatar: true, avatarUrl: true, grade: true }).limit(50).get()
      ;(userRes.data || []).forEach(function(u) {
        creatorMap[u.xipooId] = { id: u.xipooId, nickname: u.name || u.xipooId, avatar: u.avatarUrl || u.avatar || '', grade: u.grade || '' }
      })
    }

    const list = related.map(function(item) {
      return {
        id: item.id,
        title: item.title,
        courseId: item.courseId,
        courseName: item.courseName,
        memberIds: item.memberIds,
        maxMembers: item.maxMembers,
        status: item.status,
        _myStatus: item._myStatus,
        creator: creatorMap[item.creatorUserId] || { id: item.creatorUserId, nickname: item.creatorUserId, avatar: '', grade: '' }
      }
    })

    return ok(list)
  } catch (err) {
    return ok([])
  }
}

async function myApplications(meId) {
  try {
    const res = await postsCol.orderBy('createdAt', 'desc').limit(200).get()
    const allPosts = res.data || []
    const apps = []
    allPosts.forEach(function(p) {
      var applications = p.applications || []
      var myApp = applications.find(function(a) { return a.userId === meId && a.status === 'pending' })
      if (myApp) {
        apps.push({
          id: myApp.id,
          postId: p.id,
          postTitle: p.title || '',
          message: myApp.message || '',
          status: myApp.status,
          createdAt: myApp.createdAt || '',
          creatorUserId: p.creatorUserId,
          creatorName: p.creatorUserId
        })
      }
    })
    // 批量查创建者名字
    const creatorIds = [...new Set(apps.map(function(a) { return a.creatorUserId }).filter(Boolean))]
    if (creatorIds.length > 0) {
      const userRes = await users.where({ xipooId: db.command.in(creatorIds) }).field({ xipooId: true, name: true }).limit(50).get()
      const nameMap = {}
      ;(userRes.data || []).forEach(function(u) { nameMap[u.xipooId] = u.name || u.xipooId })
      apps.forEach(function(a) { a.creatorName = nameMap[a.creatorUserId] || a.creatorUserId })
    }
    return ok(apps)
  } catch (err) {
    return ok([])
  }
}

async function archivePostRecord(meId, payload) {
  const postId = payload.postId || payload.id
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  const archivedBy = post.archivedBy || []
  if (!archivedBy.includes(meId)) {
    archivedBy.push(meId)
    await postsCol.doc(post._id).update({ data: { archivedBy: archivedBy } })
  }
  return ok({ archived: true })
}

async function joinPost(meId, payload) {
  const postId = payload.postId || payload.id
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  if (post.status === 'active' && isPostExpired(post)) {
    closeExpiredPost(post)
    post.status = 'closed'
    post.closeReason = 'expired'
  }
  if (post.status === 'closed') return fail('POST_CLOSED', '帖子已关闭')
  const memberIds = post.memberIds || []
  if (memberIds.includes(meId)) return fail('ALREADY_MEMBER', '你已是该帖子的成员')

  // 检查是否已申请
  const applications = post.applications || []
  if (applications.some(a => a.userId === meId && a.status === 'pending')) {
    return fail('ALREADY_APPLIED', '你已申请，等待发起人审核')
  }

  // 检查现有成员中是否有申请人拉黑的用户
  const force = payload.force === true
  if (!force) {
    try {
      const blocksRes = await userBlocksCol.where({ blockerUserId: meId }).limit(200).get()
      const blockedIds = new Set((blocksRes.data || []).map(b => b.blockedUserId))
      // memberIds 不含创建者，补齐以确保创建者被屏蔽时也能检测到
      const allMemberIds = [...new Set([post.creatorUserId, ...memberIds])].filter(id => id !== meId)
      const blockedMembers = allMemberIds.filter(id => blockedIds.has(id))
      console.log('[joinPost] meId=' + meId + ' blockedIds=' + JSON.stringify([...blockedIds]) + ' allMemberIds=' + JSON.stringify(allMemberIds) + ' blockedMembers=' + JSON.stringify(blockedMembers))
      if (blockedMembers.length > 0) {
        const memberUsersRes = await users.where({ xipooId: db.command.in(blockedMembers) }).field({ xipooId: true, name: true }).limit(50).get()
        const memberMap = {}
        ;(memberUsersRes.data || []).forEach(u => { memberMap[u.xipooId] = u.name || u.xipooId })
        const blockedUsers = blockedMembers.map(id => ({ id, name: memberMap[id] || id }))
        console.log('[joinPost] needConfirm=true blockedUsers=' + JSON.stringify(blockedUsers))
        return ok({ needConfirm: true, blockedUsers })
      }
    } catch (e) { console.error('[joinPost] blocked check failed:', e) }
  }

  const message = (payload.message || '').trim()
  const appId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  applications.push({
    id: appId,
    userId: meId,
    message: message || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  })
  await postsCol.doc(post._id).update({ data: { applications, updatedAt: db.serverDate() } })

  // 向发起人发送申请通知
  try {
    const me = await findUser(meId)
    await writeNotification(post.creatorUserId, {
      type: 'post_applied',
      fromUserId: meId,
      fromUserName: me ? me.name : meId,
      postId,
      postTitle: post.title || ''
    })
  } catch (e) { /* 通知写入失败不影响主流程 */ }

  return ok({ applied: true, applicationId: appId })
}

async function acceptApplication(meId, payload) {
  const postId = payload.postId || payload.id
  const applicationId = payload.applicationId || payload.appId
  if (!postId || !applicationId) return fail('INVALID_PARAM', '缺少参数')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  if (post.creatorUserId !== meId) return fail('PERMISSION_DENIED', '只有发起人可以审核申请')

  const applications = post.applications || []
  const app = applications.find(a => a.id === applicationId)
  if (!app) return fail('APP_NOT_FOUND', '申请不存在')
  if (app.status !== 'pending') return fail('APP_ALREADY_HANDLED', '该申请已处理')

  const memberIds = post.memberIds || []
  if (memberIds.length >= (post.maxMembers || 99)) return fail('FULL', '帖子人数已满')
  if (memberIds.includes(app.userId)) return fail('ALREADY_MEMBER', '该用户已是成员')

  app.status = 'accepted'
  app.resolvedAt = new Date().toISOString()
  memberIds.push(app.userId)

  const confirmedMemberIds = post.confirmedMemberIds || []
  if (!confirmedMemberIds.includes(app.userId)) {
    confirmedMemberIds.push(app.userId)
  }

  const isFull = memberIds.length >= (post.maxMembers || 99)
  const updateData = { applications, memberIds, confirmedMemberIds, updatedAt: db.serverDate() }
  if (isFull) {
    updateData.status = 'closed'
    updateData.closeReason = 'full'
  }
  await postsCol.doc(post._id).update({ data: updateData })

  // 通知申请人
  try {
    await writeNotification(app.userId, {
      type: 'post_accepted',
      fromUserId: meId,
      postId,
      postTitle: post.title || ''
    })
  } catch (e) { /* 非关键 */ }

  // 满员时通知发起人和所有成员
  if (isFull) {
    const fullPost = Object.assign({}, post, { memberIds, status: 'closed' })
    notifyPostStatusChange(fullPost, 'post_full')
  }

  // 检查新成员是否被现有成员拉黑，若是则通知
  try {
    const newMemberId = app.userId
    const existingMembers = memberIds.filter(id => id !== newMemberId)
    if (existingMembers.length > 0) {
      const blocksRes = await userBlocksCol.where({
        blockerUserId: db.command.in(existingMembers),
        blockedUserId: newMemberId
      }).limit(50).get()
      const blockerIds = [...new Set((blocksRes.data || []).map(b => b.blockerUserId))]
      if (blockerIds.length > 0) {
        const newMember = await findUser(newMemberId)
        for (const blockerId of blockerIds) {
          await writeNotification(blockerId, {
            type: 'post_blocked_joined',
            fromUserId: newMemberId,
            fromUserName: newMember ? (newMember.name || newMemberId) : newMemberId,
            postId,
            postTitle: post.title || ''
          })
        }
      }
    }
  } catch (e) { /* 非关键 */ }

  return ok({ accepted: true, memberIds, confirmedMemberIds, closed: isFull })
}

async function rejectApplication(meId, payload) {
  const postId = payload.postId || payload.id
  const applicationId = payload.applicationId || payload.appId
  if (!postId || !applicationId) return fail('INVALID_PARAM', '缺少参数')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  if (post.creatorUserId !== meId) return fail('PERMISSION_DENIED', '只有发起人可以审核申请')

  const applications = post.applications || []
  const app = applications.find(a => a.id === applicationId)
  if (!app) return fail('APP_NOT_FOUND', '申请不存在')
  if (app.status !== 'pending') return fail('APP_ALREADY_HANDLED', '该申请已处理')

  app.status = 'rejected'
  app.resolvedAt = new Date().toISOString()
  await postsCol.doc(post._id).update({ data: { applications, updatedAt: db.serverDate() } })

  // 通知申请人
  try {
    await writeNotification(app.userId, {
      type: 'post_rejected',
      fromUserId: meId,
      postId,
      postTitle: post.title || ''
    })
  } catch (e) { /* 非关键 */ }

  return ok({ rejected: true })
}

async function cancelApplication(meId, payload) {
  const postId = payload.postId || payload.id
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) return fail('POST_NOT_FOUND', '帖子不存在')
  const applications = post.applications || []
  const app = applications.find(function(a) { return a.userId === meId && a.status === 'pending' })
  if (!app) return fail('APP_NOT_FOUND', '未找到待审核的申请')
  // 移除申请
  const newApps = applications.filter(function(a) { return a.id !== app.id })
  await postsCol.doc(post._id).update({ data: { applications: newApps, updatedAt: db.serverDate() } })
  return ok({ cancelled: true })
}

async function leavePost(meId, payload) {
  const postId = payload.postId || payload.id
  console.log('[leavePost] 开始, meId:', meId, 'postId:', postId)
  if (!postId) return fail('INVALID_PARAM', '缺少帖子 ID')
  const res = await postsCol.where({ id: postId }).limit(1).get()
  const post = res.data && res.data[0]
  if (!post) { console.log('[leavePost] 帖子不存在'); return fail('POST_NOT_FOUND', '帖子不存在') }
  console.log('[leavePost] 帖子当前状态:', post.status, 'closeReason:', post.closeReason, 'deadline:', post.deadline, 'memberIds:', JSON.stringify(post.memberIds), 'maxMembers:', post.maxMembers)
  if (post.creatorUserId === meId) return fail('CREATOR_CANT_LEAVE', '发起人不能退出，请关闭帖子')

  const memberIds = (post.memberIds || []).filter(id => id !== meId)
  if (memberIds.length === post.memberIds.length) return fail('NOT_MEMBER', '你不是该帖子的成员')

  const confirmedMemberIds = (post.confirmedMemberIds || []).filter(id => id !== meId)
  const removedMemberIds = [...new Set([...(post.removedMemberIds || []), meId])]

  // 若帖子因满员关闭且退出后不再满员，重新开启为招募中（除非已过期）
  let newStatus = post.status
  let newCloseReason = post.closeReason || ''
  console.log('[leavePost] 检查重开条件: closeReason===full?', post.closeReason === 'full', 'status===closed?', post.status === 'closed')
  if (post.closeReason === 'full' && post.status === 'closed') {
    const expired = isPostExpired(post)
    console.log('[leavePost] isPostExpired:', expired)
    if (expired) {
      newCloseReason = 'expired'
    } else {
      newStatus = 'active'
      newCloseReason = ''
    }
  }
  console.log('[leavePost] 最终更新: status:', newStatus, 'closeReason:', newCloseReason)

  await postsCol.doc(post._id).update({ data: { memberIds, confirmedMemberIds, removedMemberIds, status: newStatus, closeReason: newCloseReason, updatedAt: db.serverDate() } })
  console.log('[leavePost] 更新完成')

  try {
    await writeNotification(post.creatorUserId, {
      type: 'post_left',
      fromUserId: meId,
      postId,
      postTitle: post.title || ''
    })
  } catch (e) { /* 非关键 */ }

  return ok({ left: true })
}



// ---- getCourseRecommendations（含 hasPost 标识） ----

// ---- 通知系统 ----

async function writeNotification(userId, data) {
  try {
    const doc = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      type: data.type,
      fromUserId: data.fromUserId || '',
      fromUserName: data.fromUserName || '',
      buddyType: data.buddyType || '',
      postId: data.postId || '',
      postTitle: data.postTitle || '',
      read: false,
      createdAt: db.serverDate()
    }
    console.log('[writeNotification] 准备写入通知:', JSON.stringify(doc))
    const addRes = await notificationsCol.add({ data: doc })
    console.log('[writeNotification] 写入成功:', addRes._id)
  } catch (e) {
    console.error('[writeNotification] 写入失败:', e.message || e.errMsg || e)
  }
}

async function listNotifications(meId, payload) {
  try {
    console.log('[listNotifications] 查询通知, userId:', meId)
    const res = await notificationsCol.where({ userId: meId }).orderBy('createdAt', 'desc').limit(100).get()
    console.log('[listNotifications] 查询结果:', res.data ? res.data.length : 0, '条')
    const raw = (res.data || []).map((n) => { const c = Object.assign({}, n); delete c._openid; return c })
    return ok(raw)
  } catch (err) {
    console.error('[listNotifications] 查询失败:', err.message || err.errMsg || err)
    return ok([])
  }
}

async function markNotificationsRead(meId, payload) {
  try {
    const ids = (payload && payload.ids) || null
    const _ = db.command
    let query = { userId: meId, read: false }
    if (ids && ids.length > 0) {
      query.id = _.in(ids)
    }
    const unread = await notificationsCol.where(query).limit(200).get()
    const tasks = (unread.data || []).map((n) => notificationsCol.doc(n._id).update({ data: { read: true } }))
    await Promise.all(tasks)
  } catch (e) { /* 非关键 */ }
  return ok({ marked: true })
}

// ---- match:* 动作后的通知写入 ----

async function handleMatchNotifications(meId, action, result) {
  const data = result || {}
  const fromUserName = '' // 由具体场景补充

  if (action === 'match:acceptInterest') {
    // 通知发出请求的人："XX 接受了你的搭子请求"
    if (data.partner && data.partner.nickname) {
      const partnerId = data.partner.id
      await writeNotification(partnerId, {
        type: 'interest_accepted',
        fromUserId: meId,
        fromUserName: data.partner.nickname, // partner 是接受方的搭子
        buddyType: data.pair ? data.pair.buddyType : ''
      })
    }
  }

  if (action === 'match:ignoreInterest') {
    // 通知请求发起人（弱提醒）
    // matchLib 的 ignoreInterest 不返回 fromUserId，需要从请求记录推断
    // 此处简化处理：从 payload 取 requestId
  }

  if (action === 'match:unmatch') {
    // 通知对方："XX 已解除搭子关系"
  }
}

async function setCoursePool(meId, payload) {
  const courseId = payload.courseId
  const config = payload.config || {}
  if (!courseId) return fail('INVALID_PARAM', '缺少课程 ID')
  const memDb = await loadMemDb()
  const result = matchLib.setCoursePool(memDb, meId, courseId, config)
  console.log('[DEBUG-SAVE] persist done for setCoursePool, pool after=', JSON.stringify((memDb.matchPool || []).find(p => p.userId === meId)))
  await persistMatchChanges(memDb)
  return ok(result)
}

async function getCourseRecommendationsWithHasPost(meId, payload) {
  const courseId = payload.courseId || payload.id
  if (!courseId) return fail('INVALID_PARAM', '缺少课程 ID')

  try {
    console.log('[DEBUG-IDX] courseId=', courseId, 'meId=', meId)
    const memDb = await loadMemDb()
    console.log('[DEBUG-IDX] users=', (memDb.users || []).length, 'schedules=', (memDb.schedulesFlat || []).length, 'matchPool=', (memDb.matchPool || []).length)
    const result = matchLib.getCourseRecommendations(memDb, meId, courseId)
    console.log('[DEBUG-IDX] result total=', result.total)

    // 查询这些推荐用户在当前课程下的活跃招募帖
    const userIds = (result.recommendations || []).map((r) => r.userId)
    if (userIds.length > 0) {
      const _ = db.command
      const posts = await postsCol.where({
        type: 'course',
        courseId,
        creatorUserId: _.in(userIds),
        status: 'active'
      }).field({ creatorUserId: true, id: true, title: true }).limit(100).get()
      const postMap = {}
      ;(posts.data || []).forEach((p) => {
        if (!postMap[p.creatorUserId]) postMap[p.creatorUserId] = []
        postMap[p.creatorUserId].push({ id: p.id, title: p.title })
      })
      result.recommendations = result.recommendations.map((r) => ({
        ...r,
        hasPost: !!postMap[r.userId],
        posts: postMap[r.userId] || []
      }))
    }
    return ok(result)
  } catch (err) {
    return fail('COURSE_RECOMMEND_FAILED', err.message || '获取课程推荐失败')
  }
}

// ---- getMatchRecommendations ----

async function getMatchRecommendations(meId, payload) {
  const buddyType = payload.buddyType || payload.type || 'course'
  try {
    const memDb = await loadMemDb()
    const result = matchLib.getRecommendations(memDb, meId, buddyType)
    return ok(result)
  } catch (err) {
    return fail('MATCH_RECOMMEND_FAILED', err.message || '获取推荐失败')
  }
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
        version: MATCH_RUNTIME_VERSION,
        groupValidation: 'initiator-to-each-participant',
        scheduleLoading: 'batch'
      })
    }
    if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')

    const meId = await currentUserId(openid)
    if (!meId) return fail('USER_NOT_FOUND', '用户不存在，请重新登录')

    // 内容安全：写入前文本检测（1=资料 2=评论/留言 3=论坛/帖子）
    const SEC_TEXT_RULES = {
      createPost: { scene: 3, fields: ['title', 'description', 'place', 'courseName'] },
      joinPost: { scene: 2, fields: ['message'] }
    }
    const secRule = SEC_TEXT_RULES[action]
    if (secRule) {
      const parts = secRule.fields.map((field) => payload[field])
      if (await secCheck.isTextRisky(openid, parts, secRule.scene)) {
        return secCheck.contentRisky()
      }
    }

    // 在线状态不是共同空闲计算的关键路径。后台写入必须自行兜底：
    // 不能让一次非关键的 DB 超时变成未捕获 rejection，进而中断多人计算。
    touchLastActive(openid).catch((error) => {
      console.warn('[match] touchLastActive skipped:', error && error.message)
    })

    // match:* 动作 — 通过 matchLib 内存 DB 处理
    if (isMatchAction(action)) {
      if (action === 'match:getSystemTags') return ok(matchLib.getSystemTags())
      const memDb = await loadMemDb()
      let result
      try { result = matchLib.runMatchAction(action, memDb, meId, payload) }
      catch (bizErr) { return fail('BIZ_ERROR', bizErr.message || '操作失败') }
      if (typeof result === 'undefined') return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
      console.log('[DEBUG-ACTION] action=', action, 'result keys=', result ? Object.keys(result).join(',') : 'null')
      await persistMatchChanges(memDb)
      console.log('[DEBUG-ACTION] persist done. Current pairs=', ((memDb.matchedPairs || []).filter(p => p.status === 'active')).length)

      // 拉黑时双向清理招募帖成员关系 + 检测共享第三方帖子
      if (action === 'match:blockUser') {
        const targetUserId = payload.userId || payload.targetUserId
        if (targetUserId && targetUserId !== meId) {
          try {
            // 查询双方创建的帖子，清理成员
            const allPostsRes = await postsCol.where({
              creatorUserId: db.command.in([meId, targetUserId])
            }).limit(200).get()
            const allPosts = allPostsRes.data || []
            for (const post of allPosts) {
              const removeUserId = post.creatorUserId === meId ? targetUserId : meId
              const memberIds = post.memberIds || []
              if (memberIds.includes(removeUserId)) {
                const newMemberIds = memberIds.filter((id) => id !== removeUserId)
                const newConfirmed = (post.confirmedMemberIds || []).filter((id) => id !== removeUserId)
                await postsCol.doc(post._id).update({
                  data: { memberIds: newMemberIds, confirmedMemberIds: newConfirmed, updatedAt: db.serverDate() }
                })
                try {
                  await writeNotification(post.creatorUserId, {
                    type: 'post_left',
                    fromUserId: removeUserId,
                    postId: post.id,
                    postTitle: post.title || ''
                  })
                } catch (e) { /* 非关键 */ }
              }
            }

            // 检测双方在第三方帖子中的共同成员关系
            try {
              const thirdPostsRes = await postsCol.where({
                creatorUserId: db.command.nin([meId, targetUserId])
              }).limit(200).get()
              const thirdPosts = thirdPostsRes.data || []
              const shared = thirdPosts.filter((p) => {
                const members = p.memberIds || []
                return members.includes(meId) && members.includes(targetUserId)
              }).map((p) => ({ id: p.id, title: p.title || '' }))
              if (shared.length > 0) result = Object.assign({}, result, { sharedPosts: shared })
            } catch (e) { /* 非关键 */ }
          } catch (e) { /* 非关键 */ }
        }
      }

      const me = (memDb.users || []).find((u) => u.id === meId)
      const myName = me ? (me.name || meId) : meId
      try {
        if (action === 'match:acceptInterest' && result.partner && result.partner.id) {
          if (!matchLib.isBlocked(memDb, result.partner.id, meId)) {
            await writeNotification(result.partner.id, {
              type: 'interest_accepted',
              fromUserId: meId,
              fromUserName: myName,
              buddyType: result.pair ? result.pair.buddyType || '' : ''
            })
          }
        }
        if (action === 'match:sendInterest') {
          const toUserId = payload.toUserId || payload.targetUserId || ''
          console.log('[DEBUG-NOTIF] sendInterest result.autoMatched=', result.autoMatched, 'toUserId=', toUserId)
          if (result.autoMatched && result.partner && result.partner.id) {
            if (!matchLib.isBlocked(memDb, result.partner.id, meId)) {
              await writeNotification(result.partner.id, {
                type: 'interest_matched',
                fromUserId: meId,
                fromUserName: myName,
                buddyType: payload.buddyType || payload.type || ''
              })
              console.log('[DEBUG-NOTIF] wrote interest_matched to', result.partner.id)
            }
          } else if (toUserId) {
            if (!matchLib.isBlocked(memDb, toUserId, meId)) {
              await writeNotification(toUserId, {
                type: 'interest_received',
                fromUserId: meId,
                fromUserName: myName,
                buddyType: payload.buddyType || payload.type || ''
              })
              console.log('[DEBUG-NOTIF] wrote interest_received to', toUserId)
            }
          }
        }
      } catch (e) { /* 通知写入失败不影响主流程 */ }

      return ok(result)
    }

    // schedule match actions (lib)
    switch (action) {
      case 'matchWithFriend': return await matchWithFriend(meId, payload)
      case 'calculateAvailability': return await calculateAvailability(meId, payload)
      case 'createScheduleMatch': return await createScheduleMatch(meId, payload)
      case 'getMatchResult': return await getMatchResult(meId, payload)
      case 'getMatchRecommendations': return await getMatchRecommendations(meId, payload)
      case 'getCourseRecommendations': return await getCourseRecommendationsWithHasPost(meId, payload)
      case 'listPosts': return await listPosts(meId, payload)
      case 'listMySchedules': {
        const schedRes = await schedules.where({ userId: meId }).limit(200).get()
        const list = (schedRes.data || []).map((s) => { const c = Object.assign({}, s); delete c._openid; return c })
        console.log('[listMySchedules] meId=' + meId + ' count=' + list.length + ' ids=' + JSON.stringify(list.map(function(x) { return x.id || (x.courseCode + '_' + x.section) })))
        return ok(list)
      }
      case 'createPost': return await createPost(meId, payload)
      case 'getPost': return await getPost(meId, payload)
      case 'closePost': return await closePost(meId, payload)
      case 'myJoinedGroups': return await myJoinedGroups(meId)
      case 'myApplications': return await myApplications(meId)
      case 'archivePostRecord': return await archivePostRecord(meId, payload)
      case 'joinPost': return await joinPost(meId, payload)
      case 'acceptApplication': return await acceptApplication(meId, payload)
      case 'rejectApplication': return await rejectApplication(meId, payload)
      case 'cancelApplication': return await cancelApplication(meId, payload)
      case 'leavePost': return await leavePost(meId, payload)
      case 'listNotifications': return await listNotifications(meId, payload)
      case 'markNotificationsRead': return await markNotificationsRead(meId, payload)
      default: return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[match cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
