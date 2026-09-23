const cloud = require('wx-server-sdk')
const lib = require('./lib')
const secCheck = require('./secCheck')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 内容安全：各写入 action 需要检测的文本字段与场景（1=资料 2=评论/留言 3=论坛/帖子）
const SEC_TEXT_RULES = {
  createBuddyPost: { scene: 3, fields: ['title', 'description'] },
  createCourseTeam: { scene: 3, fields: ['title', 'goal', 'requirements'] },
  applyBuddyPost: { scene: 2, fields: ['message'] },
  applyCourseTeam: { scene: 2, fields: ['message'] },
  createBuddyMatchRequest: { scene: 2, fields: ['message'] },
  setCourseBuddyOptIn: { scene: 1, fields: ['bio', 'buddyWechatId'] },
  setBuddyOptIn: { scene: 1, fields: ['bio', 'buddyWechatId'] },
  submitFeedback: { scene: 2, fields: ['content', 'contact'] },
  reportUser: { scene: 2, fields: ['reason', 'detail'] }
}

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}
function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

// 内存镜像 key -> 云集合名
const PERSIST = {
  buddyOptIns: 'course_buddy_profiles',
  buddyMatchRequests: 'buddy_match_requests',
  courseTeams: 'course_groups',
  courseTeamMembers: 'course_group_members',
  courseTeamApplications: 'course_group_applications',
  buddyPosts: 'buddy_posts',
  buddyMembers: 'buddy_members',
  buddyApplications: 'buddy_applications',
  userBlocks: 'user_blocks',
  userReports: 'user_reports',
  riskEvents: 'risk_events'
}

// 拉取一个集合的全部文档（分页，封顶 5000）
async function fetchAll(collName) {
  const col = db.collection(collName)
  const out = []
  const BATCH = 100
  for (let skip = 0; skip < 5000; skip += BATCH) {
    let res
    try {
      res = await col.skip(skip).limit(BATCH).get()
    } catch (e) {
      // 集合不存在时返回空
      return out
    }
    const rows = res.data || []
    out.push(...rows)
    if (rows.length < BATCH) break
  }
  return out
}

async function currentUserId(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const record = res.data && res.data[0]
  return record ? record.xipooId : null
}

// 加载内存 db（mock 形状）
async function loadDb() {
  const [
    users, schedulesFlat,
    buddyOptIns, buddyMatchRequests,
    courseTeams, courseTeamMembers, courseTeamApplications,
    buddyPosts, buddyMembers, buddyApplications,
    userBlocks, userReports, riskEvents
  ] = await Promise.all([
    fetchAll('users'),
    fetchAll('schedules'),
    fetchAll('course_buddy_profiles'),
    fetchAll('buddy_match_requests'),
    fetchAll('course_groups'),
    fetchAll('course_group_members'),
    fetchAll('course_group_applications'),
    fetchAll('buddy_posts'),
    fetchAll('buddy_members'),
    fetchAll('buddy_applications'),
    fetchAll('user_blocks'),
    fetchAll('user_reports'),
    fetchAll('risk_events')
  ])

  // users: mock 用 user.id 作为主键 => 映射 xipooId 到 id
  const memUsers = users.map((u) => Object.assign({}, u, { id: u.xipooId }))
  // schedules: 扁平 -> { [userId]: [course] }
  const schedules = {}
  schedulesFlat.forEach((c) => {
    const uid = c.userId
    if (!uid) return
    schedules[uid] = schedules[uid] || []
    schedules[uid].push(c)
  })

  return {
    users: memUsers,
    schedules,
    buddyOptIns, buddyMatchRequests,
    courseTeams, courseTeamMembers, courseTeamApplications,
    buddyPosts, buddyMembers, buddyApplications,
    userBlocks, userReports, riskEvents,
    buddyLocationTags: lib.DEFAULT_LOCATION_TAGS.slice()
  }
}

// 快照：按逻辑 id -> JSON
function snapshot(memDb) {
  const snap = {}
  Object.keys(PERSIST).forEach((key) => {
    const map = {}
    ;(memDb[key] || []).forEach((r) => { if (r && r.id) map[r.id] = JSON.stringify(r) })
    snap[key] = map
  })
  return snap
}

function stripId(record) {
  const copy = Object.assign({}, record)
  delete copy._id
  return copy
}

// 回写变更
async function persist(memDb, snap, meId, originalUser) {
  const tasks = []
  if (memDb._removedBlockIds && memDb._removedBlockIds.length > 0) {
    const currentBlocks = await fetchAll('userBlocks')
    for (const rbid of memDb._removedBlockIds) {
      const found = currentBlocks.find((b) => b.id === rbid)
      if (found && found._id) {
        tasks.push(db.collection('user_blocks').doc(found._id).remove())
      }
    }
  }
  Object.keys(PERSIST).forEach((key) => {
    const collName = PERSIST[key]
    const col = db.collection(collName)
    ;(memDb[key] || []).forEach((record) => {
      if (!record || !record.id) return
      if (!record._id) {
        // 新增
        tasks.push(col.add({ data: stripId(record) }))
      } else if (snap[key][record.id] !== JSON.stringify(record)) {
        // 变更
        tasks.push(col.doc(record._id).update({ data: stripId(record) }))
      }
    })
  })

  // 用户资料的 buddyWechatId / bio 可能被搭子 opt-in 改动
  const memMe = memDb.users.find((u) => u.id === meId)
  if (memMe && originalUser) {
    const patch = {}
    if (memMe.buddyWechatId !== originalUser.buddyWechatId) patch.buddyWechatId = memMe.buddyWechatId
    if (memMe.bio !== originalUser.bio) patch.bio = memMe.bio
    if (Object.keys(patch).length && memMe._id) {
      tasks.push(db.collection('users').doc(memMe._id).update({ data: patch }))
    }
  }

  await Promise.all(tasks)
}

// 深度剥离云端内部字段
function deepStrip(value) {
  if (Array.isArray(value)) return value.map(deepStrip)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value).forEach((k) => {
      if (k === '_id' || k === '_openid') return
      out[k] = deepStrip(value[k])
    })
    return out
  }
  return value
}

// action 分发
function run(action, memDb, meId, payload) {
  const data = payload.data || payload
  switch (action) {
    // 课程搭子
    case 'getCourseBuddyStatus': return lib.getCourseBuddyStatus(memDb, meId, payload.courseId || payload.eventId)
    case 'setCourseBuddyOptIn': return lib.setCourseBuddyOptIn(memDb, meId, payload.courseId || payload.eventId, data)
    case 'removeCourseBuddyOptIn': return lib.removeCourseBuddyOptIn(memDb, meId, payload.courseId || payload.eventId)
    case 'getCourseBuddyCandidates': return lib.getCourseBuddyCandidates(memDb, meId, payload.courseId || payload.eventId)
    // scope 搭子
    case 'getBuddyScopeTerms': return lib.getBuddyScopeTerms(memDb)
    case 'getBuddyScopes': return lib.getBuddyScopes(memDb, payload.term)
    case 'getBuddyOptIn': return lib.getBuddyOptIn(memDb, meId, payload.scopeKey)
    case 'setBuddyOptIn': return lib.setBuddyOptIn(memDb, meId, payload.scopeKey, data)
    case 'removeBuddyOptIn': return lib.removeBuddyOptIn(memDb, meId, payload.scopeKey)
    case 'getBuddyCandidates': return lib.getBuddyCandidates(memDb, meId, payload.scopeKey)
    case 'createBuddyMatchRequest': return lib.createBuddyMatchRequest(memDb, meId, data)
    case 'getBuddyMatchRequests': return lib.getBuddyMatchRequests(memDb, meId)
    case 'acceptBuddyMatchRequest': return lib.resolveBuddyMatchRequest(memDb, meId, payload.requestId || payload.id, 'accepted')
    case 'rejectBuddyMatchRequest': return lib.resolveBuddyMatchRequest(memDb, meId, payload.requestId || payload.id, 'rejected')
    // 课程组队
    case 'createCourseTeam': return lib.createCourseTeam(memDb, meId, data)
    case 'getCourseTeams': return lib.getCourseTeams(memDb, meId, payload.courseId || payload.eventId)
    case 'getCourseTeam': return lib.getCourseTeam(memDb, meId, payload.teamId)
    case 'applyCourseTeam': return lib.applyCourseTeam(memDb, meId, payload.teamId, data)
    case 'acceptCourseTeamApplication': return lib.resolveCourseTeamApplication(memDb, meId, payload.applicationId || payload.id, 'accepted')
    case 'rejectCourseTeamApplication': return lib.resolveCourseTeamApplication(memDb, meId, payload.applicationId || payload.id, 'rejected')
    case 'withdrawCourseTeamApplication': return lib.withdrawCourseTeamApplication(memDb, meId, payload.applicationId || payload.id)
    case 'deleteCourseTeam': return lib.deleteCourseTeam(memDb, meId, payload.teamId)
    case 'leaveCourseTeam': return lib.leaveCourseTeam(memDb, meId, payload.teamId)
    // 通用搭子帖
    case 'getBuddyCenter': return lib.getBuddyCenter(memDb, meId)
    case 'createBuddyPost': return lib.createBuddyPost(memDb, meId, data)
    case 'getBuddyPosts': return lib.getBuddyPosts(memDb, meId, payload.filters || data || {})
    case 'getBuddyPost': return lib.getBuddyPost(memDb, meId, payload.postId)
    case 'applyBuddyPost': return lib.applyBuddyPost(memDb, meId, payload.postId, data)
    case 'acceptBuddyApplication': return lib.resolveBuddyApplication(memDb, meId, payload.applicationId || payload.id, 'accepted')
    case 'rejectBuddyApplication': return lib.resolveBuddyApplication(memDb, meId, payload.applicationId || payload.id, 'rejected')
    case 'deleteBuddyPost': return lib.deleteBuddyPost(memDb, meId, payload.postId)
    case 'leaveBuddyPost': return lib.leaveBuddyPost(memDb, meId, payload.postId)
    case 'blockUser': return lib.blockUser(memDb, meId, payload.userId || payload.targetUserId)
    case 'unblockUser': return lib.unblockUser(memDb, meId, payload.userId || payload.targetUserId)
    case 'getBlockedUsers': return lib.getBlockedUsers(memDb, meId)
    case 'reportUser': return lib.reportUser(memDb, meId, payload.userId || payload.targetUserId, data)
    case 'submitFeedback': return lib.submitFeedback(memDb, meId, data)
    default: return undefined
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const { action, payload = {} } = event || {}

    if (action === 'ping') return ok({ openid, env: wxContext.ENV, time: Date.now() })
    if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')

    const meId = await currentUserId(openid)
    if (!meId) return fail('USER_NOT_FOUND', '用户不存在，请重新登录')

    // 内容安全：写入前文本检测（命中规则时）
    const secRule = SEC_TEXT_RULES[action]
    const secData = payload.data || payload
    if (secRule) {
      const parts = secRule.fields.map((field) => secData[field])
      if (await secCheck.isTextRisky(openid, parts, secRule.scene)) {
        return secCheck.contentRisky()
      }
    }

    // 反馈中心（带分类/图片）走独立集合并做图片检测
    if (action === 'submitFeedback' && (secData.type || (Array.isArray(secData.images) && secData.images.length > 0))) {
      const images = Array.isArray(secData.images) ? secData.images.slice(0, 9) : []
      for (const fileID of images) {
        if (await secCheck.isImageRisky(fileID)) {
          return secCheck.contentRisky()
        }
      }
      const content = String(secData.content || '').trim()
      if (!content) return fail('BIZ_ERROR', '反馈内容不能为空')
      await db.collection('feedbacks').add({
        data: {
          userId: meId,
          type: String(secData.type || '其他'),
          content,
          images,
          contact: String(secData.contact || '').trim(),
          status: 'pending',
          createdAt: new Date().toISOString()
        }
      })
      return ok(true)
    }

    // 反馈中心：查询当前用户的反馈记录与处理状态。
    // 来源一：反馈中心表单写入的 feedbacks 集合（userId = xipooId）；
    // 来源二：旧路径 lib.submitFeedback 写入的 user_reports(type=feedback, reporterUserId = xipooId)。
    if (action === 'listMyFeedbacks') {
      const LIMIT = 50
      const list = []
      try {
        const res = await db.collection('feedbacks')
          .where({ userId: meId })
          .orderBy('createdAt', 'desc')
          .limit(LIMIT)
          .get()
        ;(res.data || []).forEach((r) => {
          list.push({
            id: r._id,
            source: 'feedbacks',
            type: r.type || '其他',
            content: r.content || '',
            images: Array.isArray(r.images) ? r.images : [],
            contact: r.contact || '',
            status: r.status || 'pending',
            adminNote: r.adminNote || '',
            createdAt: r.createdAt || '',
            resolvedAt: r.resolvedAt || ''
          })
        })
      } catch (e) { /* 集合不存在时忽略 */ }

      try {
        const res = await db.collection('user_reports')
          .where({ type: 'feedback', reporterUserId: meId })
          .orderBy('createdAt', 'desc')
          .limit(LIMIT)
          .get()
        ;(res.data || []).forEach((r) => {
          list.push({
            id: r._id,
            source: 'user_reports',
            type: '用户反馈',
            content: r.detail || '',
            images: [],
            contact: r.contact || '',
            status: r.status || 'pending',
            adminNote: r.adminNote || '',
            createdAt: r.createdAt || '',
            resolvedAt: r.resolvedAt || ''
          })
        })
      } catch (e) { /* 集合不存在时忽略 */ }

      list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      return ok(list.slice(0, LIMIT))
    }

    const memDb = await loadDb()
    const originalUser = JSON.parse(JSON.stringify(memDb.users.find((u) => u.id === meId) || {}))
    const snap = snapshot(memDb)

    let result
    try {
      result = run(action, memDb, meId, payload)
    } catch (bizErr) {
      // 业务校验类错误（如"请先开启匹配"）直接回传给前端提示
      return fail('BIZ_ERROR', bizErr.message || '操作失败')
    }
    // 所有合法 action 均返回非 undefined；undefined 即未匹配到
    if (typeof result === 'undefined') return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)

    await persist(memDb, snap, meId, originalUser)

    // 写入通知到 notifications 集合（blocked_joined + applicant accepted）
    const notifs = []
    if (result && result._blockedJoinedNotifs && result._blockedJoinedNotifs.length > 0) {
      notifs.push(...result._blockedJoinedNotifs)
    }
    if (result && result._applicantNotif) {
      notifs.push(result._applicantNotif)
    }
    if (notifs.length > 0) {
      const notifCol = db.collection('notifications')
      for (const n of notifs) {
        try {
          await notifCol.add({ data: {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: n.userId,
            type: n.type,
            fromUserId: n.fromUserId,
            fromUserName: n.fromUserName,
            postId: n.postId,
            postTitle: n.postTitle,
            read: false,
            createdAt: new Date().toISOString()
          }})
        } catch (e) { /* 非关键 */ }
      }
    }
    if (result && result._blockedJoinedNotifs) delete result._blockedJoinedNotifs
    if (result && result._applicantNotif) delete result._applicantNotif

    return ok(deepStrip(result))
  } catch (err) {
    console.error('[buddy cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
