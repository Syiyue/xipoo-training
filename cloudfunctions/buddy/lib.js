/**
 * 搭子子系统全部业务逻辑（逐行端口自前端 utils/mockBackend.js）。
 *
 * 与 mock 的差异：
 * - 不再依赖 getCurrentUserId()/ensureDb()/saveDb()，改为显式传入 (db, userId)。
 * - db 是内存镜像对象，形如 mock 的 db：
 *   { users:[], schedules:{[userId]:[course]}, buddyOptIns:[], buddyMatchRequests:[],
 *     courseTeams:[], courseTeamMembers:[], courseTeamApplications:[],
 *     buddyPosts:[], buddyMembers:[], buddyApplications:[],
 *     userBlocks:[], userReports:[], riskEvents:[], buddyLocationTags:[] }
 * - 函数直接修改 db 数组（push/改状态），持久化由 index.js 负责。
 * - 用户主键沿用 xipooId（存于 user.id）。
 */

let idSequence = 0
function uniqueId(prefix) {
  idSequence += 1
  return `${prefix}-${Date.now()}-${idSequence}`
}
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
function minutes(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return hour * 60 + minute
}
function normalizeCourseCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/\s+/g, '')
  const match = normalized.match(/[A-Z]{2,}\d{3}[A-Z]*/)
  return match ? match[0] : ''
}
function findCourse(db, userId, courseId) {
  return (db.schedules[userId] || []).find((item) => item.id === courseId)
}
function courseIdentity(user, course) {
  return {
    school: String(user.school || '').trim().toUpperCase(),
    term: String(course.term || '2025-26-S2').trim().toUpperCase(),
    courseCode: normalizeCourseCode(course.courseCode || course.title),
    section: String(course.section || '').trim().toUpperCase(),
    weekday: Number(course.weekday),
    start: course.start,
    end: course.end
  }
}
function identityKey(identity) {
  return [identity.school, identity.term, identity.courseCode, identity.weekday, identity.start, identity.end, identity.section || '*'].join('|')
}
function sameCourseIdentity(left, right) {
  if (!left || !right) return false
  const baseMatches = left.school === right.school &&
    left.term === right.term &&
    left.courseCode === right.courseCode &&
    Number(left.weekday) === Number(right.weekday) &&
    left.start === right.start &&
    left.end === right.end
  if (!baseMatches) return false
  return !(left.section && right.section && left.section !== right.section)
}
function assertConfirmedCourse(db, userId, courseId) {
  const user = db.users.find((item) => item.id === userId)
  const course = findCourse(db, userId, courseId)
  if (!user || !course) throw new Error('课程不存在或不属于当前用户')
  if (course.confirmed === false) throw new Error('AI 导入的低置信课程需要先确认')
  if (course.termEndDate && new Date(`${course.termEndDate}T23:59:59`).getTime() <= Date.now()) throw new Error('该课程或学期已结束')
  const identity = courseIdentity(user, course)
  if (!identity.courseCode) throw new Error('请先补充标准课程代码，例如 CCT007')
  return { user, course, identity }
}

function activeOptIn(db, userId, courseId) {
  return db.buddyOptIns.find((item) => item.userId === userId && item.courseId === courseId && item.enabled)
}
function optInForIdentity(db, userId, identity) {
  return db.buddyOptIns.find((item) => {
    if (item.userId !== userId || !item.enabled) return false
    if (item.identity) return sameCourseIdentity(item.identity, identity)
    const user = db.users.find((entry) => entry.id === userId)
    const course = findCourse(db, userId, item.courseId)
    return Boolean(user && course && sameCourseIdentity(courseIdentity(user, course), identity))
  })
}
function assertActiveOptIn(db, userId, courseId) {
  const context = assertConfirmedCourse(db, userId, courseId)
  const optIn = activeOptIn(db, userId, courseId)
  if (!optIn) throw new Error('请先开启该课程的课搭子匹配')
  return Object.assign(context, { optIn })
}
function isBlocked(db, firstUserId, secondUserId) {
  return db.userBlocks.some((item) =>
    item.blockerUserId === firstUserId && item.blockedUserId === secondUserId
  )
}
function buddyProfile(user, optIn) {
  return {
    id: user.id,
    avatar: user.avatar || (user.name || 'X').substring(0, 1),
    name: user.name || 'Xipoo User',
    major: user.major || '未填写',
    degree: user.degree || '未填写',
    tags: clone(optIn.tags || []),
    availabilityStart: optIn.availabilityStart,
    availabilityEnd: optIn.availabilityEnd,
    bio: optIn.bio || user.bio || '',
    buddyWechatId: optIn.buddyWechatId
  }
}
function overlapRatio(left, right) {
  const start = Math.max(minutes(left.availabilityStart), minutes(right.availabilityStart))
  const end = Math.min(minutes(left.availabilityEnd), minutes(right.availabilityEnd))
  if (end <= start) return 0
  const unionStart = Math.min(minutes(left.availabilityStart), minutes(right.availabilityStart))
  const unionEnd = Math.max(minutes(left.availabilityEnd), minutes(right.availabilityEnd))
  return (end - start) / Math.max(1, unionEnd - unionStart)
}
function candidateScore(user, mine, theirs) {
  const myTags = mine.tags || []
  const theirTags = theirs.tags || []
  const overlapCount = myTags.filter((tag) => theirTags.includes(tag)).length
  const tagRatio = overlapCount / Math.max(1, new Set(myTags.concat(theirTags)).size)
  const fields = [user.avatar, user.name, user.major, user.degree, theirs.bio, theirs.buddyWechatId]
  const completeness = fields.filter(Boolean).length / fields.length
  return Math.round((tagRatio * 60 + overlapRatio(mine, theirs) * 30 + completeness * 10) * 10) / 10
}

const SCOPE_DEPTH = { campus: 0, course_family: 1, course_code: 2, course_session: 3 }
function courseFamily(courseCode) {
  const match = String(courseCode || '').toUpperCase().match(/^[A-Z]+/)
  return match ? match[0] : ''
}
function buddyScopeKey(scope) {
  const parts = [scope.scopeType, scope.school, scope.term, scope.courseFamily || '', scope.courseCode || '', scope.section || '', scope.weekday || '', scope.startTime || '', scope.endTime || '']
  return parts.map((item) => String(item || '').trim().toUpperCase()).join('::')
}
function scopeLabel(scope) {
  if (scope.scopeType === 'campus') return `全西浦 · ${scope.term}`
  if (scope.scopeType === 'course_family') return `${scope.courseFamily} 课程大类 · ${scope.term}`
  if (scope.scopeType === 'course_code') return `${scope.courseCode} · ${scope.term}`
  return `${scope.courseCode} ${scope.section || '未分班'} · 周${scope.weekday} ${scope.startTime}-${scope.endTime}`
}
function normalizeBuddyScope(scope) {
  const normalized = {
    scopeType: scope.scopeType,
    school: String(scope.school || 'XJTLU').trim().toUpperCase(),
    term: String(scope.term || '').trim().toUpperCase(),
    courseFamily: String(scope.courseFamily || '').trim().toUpperCase(),
    courseCode: normalizeCourseCode(scope.courseCode || ''),
    section: String(scope.section || '').trim().toUpperCase(),
    weekday: scope.weekday ? Number(scope.weekday) : 0,
    startTime: scope.startTime || '',
    endTime: scope.endTime || ''
  }
  normalized.scopeKey = buddyScopeKey(normalized)
  normalized.label = scopeLabel(normalized)
  normalized.depth = SCOPE_DEPTH[normalized.scopeType]
  return normalized
}
function sessionScopeFromCourse(user, course) {
  const identity = courseIdentity(user, course)
  return normalizeBuddyScope({
    scopeType: 'course_session',
    school: identity.school,
    term: identity.term,
    courseFamily: courseFamily(identity.courseCode),
    courseCode: identity.courseCode,
    section: identity.section,
    weekday: identity.weekday,
    startTime: identity.start,
    endTime: identity.end
  })
}
function buildBuddyScopes(db) {
  const map = new Map()
  Object.keys(db.schedules || {}).forEach((userId) => {
    const user = db.users.find((item) => item.id === userId)
    if (!user) return
    ;(db.schedules[userId] || []).forEach((course) => {
      const code = normalizeCourseCode(course.courseCode || course.title)
      if (!code) return
      const term = String(course.term || '2025-26-S2').trim().toUpperCase()
      const school = String(user.school || 'XJTLU').trim().toUpperCase()
      const family = courseFamily(code)
      const scopes = [
        normalizeBuddyScope({ scopeType: 'campus', school, term }),
        normalizeBuddyScope({ scopeType: 'course_family', school, term, courseFamily: family }),
        normalizeBuddyScope({ scopeType: 'course_code', school, term, courseFamily: family, courseCode: code }),
        sessionScopeFromCourse(user, course)
      ]
      scopes.forEach((scope) => map.set(scope.scopeKey, scope))
    })
  })
  return Array.from(map.values()).sort((left, right) => (
    String(right.term).localeCompare(String(left.term)) || left.depth - right.depth || left.label.localeCompare(right.label)
  ))
}
function scopeContains(parent, child) {
  if (!parent || !child || parent.school !== child.school || parent.term !== child.term) return false
  if (parent.scopeType === 'campus') return true
  if (parent.courseFamily !== child.courseFamily) return false
  if (parent.scopeType === 'course_family') return true
  if (parent.courseCode !== child.courseCode) return false
  if (parent.scopeType === 'course_code') return true
  return parent.scopeKey === child.scopeKey
}
function scopeDistance(parent, child) {
  if (!scopeContains(parent, child)) return -1
  return Math.max(0, Number(child.depth) - Number(parent.depth))
}
function scopeVerification(db, userId, scope) {
  const user = db.users.find((item) => item.id === userId)
  const courses = db.schedules[userId] || []
  const verified = courses.some((course) => {
    const session = sessionScopeFromCourse(user || {}, course)
    if (session.school !== scope.school || session.term !== scope.term) return false
    if (scope.scopeType === 'campus') return true
    if (scope.scopeType === 'course_family') return session.courseFamily === scope.courseFamily
    if (scope.scopeType === 'course_code') return session.courseCode === scope.courseCode
    return session.scopeKey === scope.scopeKey
  })
  return { scopeVerified: verified, verificationReason: verified ? '课表已验证' : '用户自行选择' }
}
function migrateBuddyScopeRecords(db) {
  const scopes = buildBuddyScopes(db)
  const fallbackTerm = scopes.length ? scopes[0].term : '2025-26-S2'
  db.buddyOptIns.forEach((optIn) => {
    if (!optIn.scope || !optIn.scopeKey) {
      const user = db.users.find((item) => item.id === optIn.userId)
      const course = findCourse(db, optIn.userId, optIn.courseId)
      const scope = course && user
        ? sessionScopeFromCourse(user, course)
        : normalizeBuddyScope({ scopeType: 'campus', school: user && user.school, term: fallbackTerm })
      optIn.scope = scope
      optIn.scopeKey = scope.scopeKey
    }
    if (optIn.scopeVerified === undefined) Object.assign(optIn, scopeVerification(db, optIn.userId, optIn.scope))
  })
  db.buddyPosts.forEach((post) => {
    if (post.scope && post.scopeKey) return
    const creator = db.users.find((item) => item.id === post.creatorUserId)
    const scope = normalizeBuddyScope({ scopeType: 'campus', school: creator && creator.school, term: fallbackTerm })
    post.scope = scope
    post.scopeKey = scope.scopeKey
  })
}
function findBuddyScope(db, scopeKey) {
  migrateBuddyScopeRecords(db)
  return buildBuddyScopes(db).find((item) => item.scopeKey === scopeKey) ||
    db.buddyOptIns.map((item) => item.scope).find((item) => item && item.scopeKey === scopeKey) ||
    db.buddyPosts.map((item) => item.scope).find((item) => item && item.scopeKey === scopeKey)
}

// ---- scope 搭子 actions ----
function getBuddyScopeTerms(db) {
  return Array.from(new Set(buildBuddyScopes(db).map((item) => item.term))).sort().reverse()
}
function getBuddyScopes(db, term) {
  const scopes = buildBuddyScopes(db)
  const selectedTerm = term || (scopes[0] && scopes[0].term)
  return clone(scopes.filter((item) => item.term === selectedTerm))
}
function getBuddyOptIn(db, userId, scopeKey) {
  migrateBuddyScopeRecords(db)
  return clone(db.buddyOptIns.find((item) => item.userId === userId && item.scopeKey === scopeKey && item.enabled) || null)
}
function setBuddyOptIn(db, userId, scopeKey, payload) {
  const user = db.users.find((item) => item.id === userId)
  const scope = findBuddyScope(db, scopeKey)
  if (!scope) throw new Error('匹配范围不存在')
  const tags = Array.from(new Set((payload.tags || []).map((item) => String(item).trim()).filter(Boolean)))
  const wechat = String(payload.buddyWechatId || '').trim()
  if (!payload.consent) throw new Error('需要同意按匹配范围开放联系方式')
  if (!wechat) throw new Error('请填写用于搭子匹配的微信号')
  if (!tags.length) throw new Error('请至少选择一个需求标签')
  if (minutes(payload.availabilityEnd) <= minutes(payload.availabilityStart)) throw new Error('可约结束时间必须晚于开始时间')
  const now = new Date().toISOString()
  let optIn = db.buddyOptIns.find((item) => item.userId === userId && item.scopeKey === scopeKey)
  if (!optIn) { optIn = { id: uniqueId('buddy-optin'), userId, createdAt: now }; db.buddyOptIns.push(optIn) }
  Object.assign(optIn, {
    enabled: true, scope, scopeKey, tags,
    availabilityStart: payload.availabilityStart,
    availabilityEnd: payload.availabilityEnd,
    buddyWechatId: wechat,
    bio: String(payload.bio || user.bio || '').trim(),
    consent: true, updatedAt: now
  }, scopeVerification(db, userId, scope))
  user.buddyWechatId = wechat
  return clone(optIn)
}
function removeBuddyOptIn(db, userId, scopeKey) {
  migrateBuddyScopeRecords(db)
  const optIn = db.buddyOptIns.find((item) => item.userId === userId && item.scopeKey === scopeKey && item.enabled)
  if (optIn) { optIn.enabled = false; optIn.updatedAt = new Date().toISOString() }
  db.buddyMatchRequests.forEach((request) => {
    if ((request.fromOptInId === (optIn && optIn.id) || request.toOptInId === (optIn && optIn.id)) && request.status === 'pending') request.status = 'withdrawn'
  })
  return true
}
function acceptedBuddyMatch(db, firstOptInId, secondOptInId) {
  return db.buddyMatchRequests.some((item) => (
    item.status === 'accepted' &&
    ((item.fromOptInId === firstOptInId && item.toOptInId === secondOptInId) || (item.fromOptInId === secondOptInId && item.toOptInId === firstOptInId))
  ))
}
function scopedCandidateScore(user, mine, theirs) {
  const myTags = mine.tags || []
  const theirTags = theirs.tags || []
  const overlapCount = myTags.filter((tag) => theirTags.includes(tag)).length
  const tagScore = overlapCount / Math.max(1, new Set(myTags.concat(theirTags)).size) * 40
  const timeScore = overlapRatio(mine, theirs) * 25
  const distance = scopeDistance(mine.scope, theirs.scope)
  const scopeScore = distance < 0 ? 10 : Math.max(0, 20 - distance * 6)
  const verifiedScore = theirs.scopeVerified ? 10 : 0
  const fields = [user.avatar, user.name, user.major, user.degree, theirs.bio]
  const profileScore = fields.filter(Boolean).length / fields.length * 5
  return Math.round((tagScore + timeScore + scopeScore + verifiedScore + profileScore) * 10) / 10
}
function scopedBuddyProfile(user, optIn, includeWechat) {
  const profile = {
    id: user.id, optInId: optIn.id,
    avatar: user.avatar || (user.name || 'X').substring(0, 1),
    name: user.name || 'Xipoo User', signature: user.signature || '',
    major: user.major || '未填写', degree: user.degree || '未填写',
    tags: clone(optIn.tags || []),
    availabilityStart: optIn.availabilityStart, availabilityEnd: optIn.availabilityEnd,
    bio: optIn.bio || user.bio || '', scope: clone(optIn.scope),
    scopeVerified: Boolean(optIn.scopeVerified), verificationReason: optIn.verificationReason || '用户自行选择'
  }
  if (includeWechat) profile.buddyWechatId = optIn.buddyWechatId
  return profile
}
function getBuddyCandidates(db, userId, scopeKey) {
  migrateBuddyScopeRecords(db)
  const mine = db.buddyOptIns.find((item) => item.userId === userId && item.scopeKey === scopeKey && item.enabled)
  if (!mine) throw new Error('请先开启该范围的个人匹配')
  return db.buddyOptIns
    .filter((item) => item.enabled && item.userId !== userId && (scopeContains(mine.scope, item.scope) || acceptedBuddyMatch(db, mine.id, item.id)))
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.userId)
      if (!user || isBlocked(db, userId, item.userId)) return null
      const sameScope = mine.scopeKey === item.scopeKey
      const accepted = acceptedBuddyMatch(db, mine.id, item.id)
      const request = db.buddyMatchRequests
        .filter((entry) => ['pending', 'accepted'].includes(entry.status) &&
          ((entry.fromOptInId === mine.id && entry.toOptInId === item.id) || (entry.fromOptInId === item.id && entry.toOptInId === mine.id)))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0]
      const distance = scopeDistance(mine.scope, item.scope)
      return {
        id: item.id,
        profile: scopedBuddyProfile(user, item, sameScope || accepted),
        score: scopedCandidateScore(user, mine, item),
        contactVisible: sameScope || accepted,
        requestStatus: request ? request.status : '',
        requestDirection: request ? (request.fromOptInId === mine.id ? 'outgoing' : 'incoming') : '',
        matchReason: `${distance === 0 ? '相同范围' : (distance > 0 ? `下级范围 ${item.scope.label}` : '已接受跨层级匹配')} · 标签与可约时间匹配`
      }
    })
    .filter(Boolean)
    .reduce((list, candidate) => {
      const index = list.findIndex((item) => item.profile.id === candidate.profile.id)
      if (index === -1) list.push(candidate)
      else if (candidate.score > list[index].score) list[index] = candidate
      return list
    }, [])
    .sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id))
}
function createBuddyMatchRequest(db, userId, payload) {
  migrateBuddyScopeRecords(db)
  const fromOptIn = db.buddyOptIns.find((item) => item.id === payload.fromOptInId && item.userId === userId && item.enabled)
  const toOptIn = db.buddyOptIns.find((item) => item.id === payload.toOptInId && item.enabled)
  if (!fromOptIn || !toOptIn || !scopeContains(fromOptIn.scope, toOptIn.scope)) throw new Error('匹配对象不存在')
  if (fromOptIn.scopeKey === toOptIn.scopeKey) throw new Error('相同范围已直接开放联系方式')
  if (isBlocked(db, userId, toOptIn.userId)) throw new Error('双方存在屏蔽关系')
  const existing = db.buddyMatchRequests.find((item) => item.fromOptInId === fromOptIn.id && item.toOptInId === toOptIn.id && item.status === 'pending')
  if (existing) throw new Error('匹配申请已发送')
  const request = {
    id: uniqueId('buddy-match-request'), fromUserId: userId, toUserId: toOptIn.userId,
    fromOptInId: fromOptIn.id, toOptInId: toOptIn.id,
    message: String(payload.message || '').trim(), status: 'pending', createdAt: new Date().toISOString()
  }
  db.buddyMatchRequests.push(request)
  return clone(request)
}
function getBuddyMatchRequests(db, userId) {
  migrateBuddyScopeRecords(db)
  return clone(db.buddyMatchRequests
    .filter((item) => item.toUserId === userId && item.status === 'pending' && !isBlocked(db, userId, item.fromUserId))
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.fromUserId)
      const optIn = db.buddyOptIns.find((entry) => entry.id === item.fromOptInId)
      return Object.assign({}, item, { applicant: scopedBuddyProfile(user, optIn, false) })
    }))
}
function resolveBuddyMatchRequest(db, userId, requestId, decision) {
  const request = db.buddyMatchRequests.find((item) => item.id === requestId)
  if (!request || request.toUserId !== userId || request.status !== 'pending') throw new Error('匹配申请不存在')
  const fromOptIn = db.buddyOptIns.find((item) => item.id === request.fromOptInId && item.enabled)
  const toOptIn = db.buddyOptIns.find((item) => item.id === request.toOptInId && item.enabled)
  if (!fromOptIn || !toOptIn) throw new Error('匹配范围已关闭')
  request.status = decision
  request.resolvedAt = new Date().toISOString()
  return clone(request)
}

// ---- 课程搭子 actions ----
function setCourseBuddyOptIn(db, userId, courseId, payload) {
  const { user, identity } = assertConfirmedCourse(db, userId, courseId)
  const tags = Array.from(new Set((payload.tags || []).map((item) => String(item).trim()).filter(Boolean)))
  const wechat = String(payload.buddyWechatId || '').trim()
  if (!payload.consent) throw new Error('需要同意向同课程匹配池成员公开微信号')
  if (!wechat) throw new Error('请填写用于搭子匹配的微信号')
  if (!tags.length) throw new Error('请至少选择一个需求标签')
  if (minutes(payload.availabilityEnd) <= minutes(payload.availabilityStart)) throw new Error('可约结束时间必须晚于开始时间')
  const now = new Date().toISOString()
  let optIn = db.buddyOptIns.find((item) => item.userId === userId && item.courseId === courseId)
  if (!optIn) { optIn = { id: uniqueId('buddy-optin'), userId, courseId, createdAt: now }; db.buddyOptIns.push(optIn) }
  Object.assign(optIn, {
    enabled: true, identity, tags,
    availabilityStart: payload.availabilityStart, availabilityEnd: payload.availabilityEnd,
    buddyWechatId: wechat, bio: String(payload.bio || user.bio || '').trim(), consent: true, updatedAt: now
  })
  user.buddyWechatId = wechat
  if (optIn.bio) user.bio = optIn.bio
  return clone(optIn)
}
function removeCourseBuddyOptIn(db, userId, courseId) {
  const { identity } = assertConfirmedCourse(db, userId, courseId)
  const optIn = activeOptIn(db, userId, courseId)
  if (optIn) { optIn.enabled = false; optIn.updatedAt = new Date().toISOString() }
  deactivateCourseParticipation(db, userId, identity)
  return true
}
function getCourseBuddyStatus(db, userId, courseId) {
  assertConfirmedCourse(db, userId, courseId)
  return clone(activeOptIn(db, userId, courseId) || null)
}
function getCourseBuddyCandidates(db, userId, courseId) {
  const { identity, optIn } = assertActiveOptIn(db, userId, courseId)
  return db.buddyOptIns
    .filter((item) => item.enabled && item.userId !== userId)
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.userId)
      const course = findCourse(db, item.userId, item.courseId)
      if (!user || !course || course.confirmed === false || isBlocked(db, userId, item.userId)) return null
      const theirIdentity = item.identity || courseIdentity(user, course)
      if (!sameCourseIdentity(identity, theirIdentity)) return null
      return {
        profile: buddyProfile(user, item),
        score: candidateScore(user, optIn, item),
        rotation: `${identityKey(identity)}|${item.userId}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 17
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.rotation - b.rotation)
    .map((item) => ({ id: item.profile.id, profile: item.profile, score: item.score }))
}

// ---- 课程组队 ----
function teamMemberCount(db, teamId) {
  return db.courseTeamMembers.filter((item) => item.teamId === teamId && item.status === 'active').length
}
function deactivateCourseParticipation(db, userId, identity) {
  db.courseTeamApplications.forEach((application) => {
    const team = db.courseTeams.find((item) => item.id === application.teamId)
    if (application.userId === userId && application.status === 'pending' && team && sameCourseIdentity(team.identity, identity)) application.status = 'withdrawn'
  })
  db.courseTeamMembers.forEach((membership) => {
    const team = db.courseTeams.find((item) => item.id === membership.teamId)
    if (membership.userId !== userId || membership.status !== 'active' || !team || !sameCourseIdentity(team.identity, identity)) return
    membership.status = 'left'
    membership.leftAt = new Date().toISOString()
    if (team.creatorUserId === userId) {
      const nextMember = db.courseTeamMembers.find((item) => item.teamId === team.id && item.status === 'active')
      if (nextMember) { nextMember.role = 'creator'; team.creatorUserId = nextMember.userId } else team.status = 'cancelled'
    }
    refreshTeamStatus(db, team)
  })
}
function refreshTeamStatus(db, team) {
  if (team.status === 'cancelled') return
  if (new Date(team.deadline).getTime() <= Date.now()) team.status = 'expired'
  else if (teamMemberCount(db, team.id) >= team.maxMembers) team.status = 'full'
  else team.status = 'open'
  if (team.status === 'expired') {
    db.courseTeamApplications.forEach((application) => {
      if (application.teamId === team.id && application.status === 'pending') application.status = 'expired'
    })
  }
}
function serializeTeam(db, team, viewerId) {
  refreshTeamStatus(db, team)
  const members = db.courseTeamMembers
    .filter((item) => item.teamId === team.id && item.status === 'active')
    .map((member) => {
      const user = db.users.find((item) => item.id === member.userId)
      const opted = optInForIdentity(db, member.userId, team.identity)
      return user && opted ? buddyProfile(user, opted) : null
    })
    .filter(Boolean)
  const applications = viewerId === team.creatorUserId
    ? db.courseTeamApplications
      .filter((item) => item.teamId === team.id && item.status === 'pending' && !isBlocked(db, viewerId, item.userId))
      .map((application) => ({
        id: application.id, message: application.message,
        applicant: buddyProfile(db.users.find((item) => item.id === application.userId), optInForIdentity(db, application.userId, team.identity))
      }))
    : []
  const myApplication = db.courseTeamApplications.find((item) => item.teamId === team.id && item.userId === viewerId)
  const wasMember = db.courseTeamMembers.some((m) => m.teamId === team.id && m.userId === viewerId && m.status === 'left')
  const hasInteracted = team.creatorUserId === viewerId || members.some((member) => member.id === viewerId) || !!myApplication || wasMember
  return Object.assign({}, clone(team), {
    memberCount: members.length, members, applications,
    isCreator: team.creatorUserId === viewerId,
    isMember: members.some((member) => member.id === viewerId),
    myApplicationStatus: myApplication ? myApplication.status : '',
    hasInteracted
  })
}
function createCourseTeam(db, userId, payload) {
  const { identity } = assertActiveOptIn(db, userId, payload.courseId)
  const maxMembers = Number(payload.maxMembers)
  if (maxMembers < 2 || maxMembers > 5) throw new Error('目标人数必须为 2 至 5 人，且包含发起人')
  if (!payload.title || !payload.goal) throw new Error('请填写组队标题和目标')
  if (new Date(payload.deadline).getTime() <= Date.now()) throw new Error('申请截止时间必须晚于当前时间')
  const existingMembership = db.courseTeamMembers.find((member) => {
    const team = db.courseTeams.find((item) => item.id === member.teamId)
    return member.userId === userId && member.status === 'active' && team && sameCourseIdentity(team.identity, identity)
  })
  if (existingMembership) throw new Error('你已加入该课程的一个有效小组')
  const team = {
    id: uniqueId('course-team'), courseId: payload.courseId, creatorUserId: userId, identity,
    title: String(payload.title).trim(), goal: String(payload.goal).trim(), tags: clone(payload.tags || []),
    maxMembers, deadline: payload.deadline, requirements: String(payload.requirements || '').trim(),
    status: 'open', createdAt: new Date().toISOString()
  }
  db.courseTeams.push(team)
  db.courseTeamMembers.push({ id: uniqueId('course-team-member'), teamId: team.id, userId, role: 'creator', status: 'active', joinedAt: new Date().toISOString() })
  return serializeTeam(db, team, userId)
}
function getCourseTeams(db, userId, courseId) {
  const { identity } = assertActiveOptIn(db, userId, courseId)
  return db.courseTeams
    .filter((team) => {
      if (!sameCourseIdentity(team.identity, identity)) return false
      if (!isBlocked(db, userId, team.creatorUserId) && team.status !== 'cancelled') return true
      // 用户交互过的队伍（即使已取消或被屏蔽），供「已关闭」分区展示
      return db.courseTeamMembers.some((m) => m.teamId === team.id && m.userId === userId) ||
        db.courseTeamApplications.some((a) => a.teamId === team.id && a.userId === userId)
    })
    .map((team) => serializeTeam(db, team, userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}
function getCourseTeam(db, userId, teamId) {
  const team = db.courseTeams.find((item) => item.id === teamId)
  if (!team) throw new Error('组队申请不存在')
  if (isBlocked(db, userId, team.creatorUserId)) throw new Error('双方存在屏蔽关系')
  const ownCourse = (db.schedules[userId] || []).find((course) => {
    const user = db.users.find((item) => item.id === userId)
    return sameCourseIdentity(courseIdentity(user, course), team.identity)
  })
  if (!ownCourse) throw new Error('仅该课程成员可以查看')
  assertActiveOptIn(db, userId, ownCourse.id)
  return serializeTeam(db, team, userId)
}
function applyCourseTeam(db, userId, teamId, payload = {}) {
  const recentApplications = db.courseTeamApplications.filter((item) => item.userId === userId && Date.now() - new Date(item.createdAt).getTime() < 10 * 60 * 1000)
  if (recentApplications.length >= 5) {
    db.riskEvents.push({ id: uniqueId('risk-event'), userId, type: 'bulk_course_team_application', status: 'open', createdAt: new Date().toISOString() })
    throw new Error('申请过于频繁，请稍后再试')
  }
  const team = db.courseTeams.find((item) => item.id === teamId)
  if (!team) throw new Error('组队申请不存在')
  if (isBlocked(db, userId, team.creatorUserId)) throw new Error('双方存在屏蔽关系')
  refreshTeamStatus(db, team)
  if (team.status !== 'open') throw new Error('该组队已满员或截止')
  if (team.creatorUserId === userId) throw new Error('发起人无需申请自己的小组')
  const ownCourse = (db.schedules[userId] || []).find((course) => {
    const user = db.users.find((item) => item.id === userId)
    return sameCourseIdentity(courseIdentity(user, course), team.identity)
  })
  if (!ownCourse) throw new Error('仅同课程成员可以申请')
  assertActiveOptIn(db, userId, ownCourse.id)
  if (db.courseTeamMembers.some((item) => item.teamId === teamId && item.userId === userId && item.status === 'active')) throw new Error('你已经是该小组成员')
  const existing = db.courseTeamApplications.find((item) => item.teamId === teamId && item.userId === userId)
  if (existing && existing.status === 'pending') throw new Error('申请已提交')

  // 检查现有成员中是否有申请人拉黑的用户
  const force = payload.force === true
  if (!force) {
    const blockedIds = new Set(db.userBlocks.filter((b) => b.blockerUserId === userId).map((b) => b.blockedUserId))
    const activeMemberIds = db.courseTeamMembers.filter((m) => m.teamId === teamId && m.status === 'active').map((m) => m.userId)
    const blockedMembers = activeMemberIds.filter((id) => blockedIds.has(id))
    if (blockedMembers.length > 0) {
      const blockedUsers = blockedMembers.map((id) => {
        const u = db.users.find((item) => item.id === id)
        return { id, name: u ? (u.name || u.nickname || id) : id }
      })
      return { needConfirm: true, blockedUsers }
    }
  }

  const application = { id: uniqueId('course-team-application'), teamId, userId, message: String(payload.message || '').trim(), status: 'pending', createdAt: new Date().toISOString() }
  db.courseTeamApplications.push(application)
  return clone(application)
}
function resolveCourseTeamApplication(db, userId, applicationId, decision) {
  const application = db.courseTeamApplications.find((item) => item.id === applicationId)
  const team = application && db.courseTeams.find((item) => item.id === application.teamId)
  if (!application || !team) throw new Error('申请不存在')
  if (team.creatorUserId !== userId) throw new Error('仅发起人可以审核申请')
  if (application.status !== 'pending') throw new Error('该申请已处理')
  refreshTeamStatus(db, team)
  var blockedJoinedNotifs = null
  var applicantNotif = null
  if (decision === 'rejected') {
    application.status = 'rejected'
  } else {
    if (team.status !== 'open' || teamMemberCount(db, team.id) >= team.maxMembers) throw new Error('小组已满员或截止')
    const conflictingMember = db.courseTeamMembers.find((member) => {
      const memberTeam = db.courseTeams.find((item) => item.id === member.teamId)
      return member.userId === application.userId && member.status === 'active' && memberTeam && sameCourseIdentity(memberTeam.identity, team.identity)
    })
    if (conflictingMember) throw new Error('该用户已加入本课程其他小组')
    application.status = 'accepted'
    db.courseTeamMembers.push({ id: uniqueId('course-team-member'), teamId: team.id, userId: application.userId, role: 'member', status: 'active', joinedAt: new Date().toISOString() })
    db.courseTeamApplications.forEach((item) => {
      const otherTeam = db.courseTeams.find((entry) => entry.id === item.teamId)
      if (item.userId === application.userId && item.id !== application.id && item.status === 'pending' && otherTeam && sameCourseIdentity(otherTeam.identity, team.identity)) item.status = 'withdrawn'
    })
    refreshTeamStatus(db, team)

    // 通知申请人
    const creator = db.users.find((u) => u.id === userId)
    applicantNotif = {
      userId: application.userId,
      type: 'post_accepted',
      fromUserId: userId,
      fromUserName: creator ? (creator.name || creator.nickname || userId) : userId,
      postId: team.id,
      postTitle: team.title || team.courseName || ''
    }

    // 检查新成员是否被现有成员拉黑
    const newMemberId = application.userId
    const existingMembers = db.courseTeamMembers.filter((m) => m.teamId === team.id && m.status === 'active' && m.userId !== newMemberId).map((m) => m.userId)
    const blockerIds = existingMembers.filter((id) => db.userBlocks.some((b) => b.blockerUserId === id && b.blockedUserId === newMemberId))
    if (blockerIds.length > 0) {
      const newMember = db.users.find((u) => u.id === newMemberId)
      blockedJoinedNotifs = blockerIds.map((id) => ({
        userId: id,
        type: 'post_blocked_joined',
        fromUserId: newMemberId,
        fromUserName: newMember ? (newMember.name || newMember.nickname || newMemberId) : newMemberId,
        postId: team.id,
        postTitle: team.title || team.courseName || ''
      }))
    }
  }
  application.resolvedAt = new Date().toISOString()
  return Object.assign(serializeTeam(db, team, userId), { _blockedJoinedNotifs: blockedJoinedNotifs, _applicantNotif: applicantNotif || null })
}
function withdrawCourseTeamApplication(db, userId, applicationId) {
  const application = db.courseTeamApplications.find((item) => item.id === applicationId)
  if (!application || application.userId !== userId) throw new Error('申请不存在')
  if (application.status !== 'pending') throw new Error('只有待审核申请可以撤回')
  application.status = 'withdrawn'
  return true
}
function deleteCourseTeam(db, userId, teamId) {
  const team = db.courseTeams.find((item) => item.id === teamId)
  if (!team || team.creatorUserId !== userId) throw new Error('组队申请不存在')
  if (teamMemberCount(db, teamId) > 1) throw new Error('已成组后不能取消，请由成员分别退出')
  team.status = 'cancelled'
  db.courseTeamApplications.forEach((item) => { if (item.teamId === teamId && item.status === 'pending') item.status = 'withdrawn' })
  return true
}
function leaveCourseTeam(db, userId, teamId) {
  const team = db.courseTeams.find((item) => item.id === teamId)
  const membership = db.courseTeamMembers.find((item) => item.teamId === teamId && item.userId === userId && item.status === 'active')
  if (!team || !membership) throw new Error('你不是该小组成员')
  membership.status = 'left'
  membership.leftAt = new Date().toISOString()
  if (team.creatorUserId === userId) {
    const nextMember = db.courseTeamMembers.find((item) => item.teamId === teamId && item.status === 'active')
    if (nextMember) { nextMember.role = 'creator'; team.creatorUserId = nextMember.userId } else team.status = 'cancelled'
  }
  refreshTeamStatus(db, team)
  return true
}

// ---- 通用搭子帖 ----
const BUDDY_TYPE_LIMITS = {
  meal: { label: '饭搭子', min: 2, max: 5 },
  study: { label: '自习搭子', min: 2, max: 5 },
  sport: { label: '运动搭子', min: 2, max: 10 },
  project: { label: '项目搭子', min: 2, max: 8 }
}
const DEFAULT_LOCATION_TAGS = ['中央食堂', '北区食堂', '图书馆', '体育馆', '操场', '创新工场', '教学楼公共区']
function genericBuddyProfile(user, includeWechat) {
  if (!user) return null
  const profile = {
    id: user.id, avatar: user.avatar || (user.name || 'X').substring(0, 1), name: user.name || 'Xipoo User',
    signature: user.signature || '', major: user.major || '', degree: user.degree || '',
    featureTags: clone(user.featureTags || []), bio: user.bio || ''
  }
  if (includeWechat) profile.buddyWechatId = user.buddyWechatId || ''
  return profile
}
function buddyMemberCount(db, postId) {
  return db.buddyMembers.filter((item) => item.postId === postId && item.status === 'active').length
}
function refreshBuddyPostStatus(db, post) {
  if (post.status === 'cancelled') return
  if (new Date(post.deadline).getTime() <= Date.now() || new Date(post.endAt).getTime() <= Date.now()) post.status = 'expired'
  else if (buddyMemberCount(db, post.id) >= post.maxMembers) post.status = 'full'
  else post.status = 'open'
  if (post.status === 'expired') {
    db.buddyApplications.forEach((application) => { if (application.postId === post.id && application.status === 'pending') application.status = 'expired' })
  }
}
function genericBuddyScore(user, post, creator, selectedScope) {
  const userTags = user.featureTags || []
  const postTags = post.tags || []
  const overlap = postTags.filter((tag) => userTags.includes(tag)).length
  const tagScore = overlap / Math.max(1, new Set(userTags.concat(postTags)).size) * 60
  const profileFields = [creator.avatar, creator.signature, creator.major, creator.degree, creator.bio]
  const completeness = profileFields.filter(Boolean).length / profileFields.length * 25
  const ageHours = Math.max(0, (Date.now() - new Date(post.createdAt).getTime()) / 3600000)
  const activityScore = Math.max(0, 15 - Math.min(15, ageHours / 24))
  const distance = selectedScope && post.scope ? scopeDistance(selectedScope, post.scope) : 0
  const scopeScore = distance >= 0 ? Math.max(0, 15 - distance * 5) : 0
  const verifiedScore = post.scopeVerified ? 10 : 0
  return Math.round((tagScore * 0.75 + completeness + activityScore + scopeScore + verifiedScore) * 10) / 10
}
function serializeBuddyPost(db, post, viewerId, selectedScope) {
  refreshBuddyPostStatus(db, post)
  const membership = db.buddyMembers.find((item) => item.postId === post.id && item.userId === viewerId && item.status === 'active')
  const isMember = Boolean(membership)
  const isCreator = post.creatorUserId === viewerId
  const members = db.buddyMembers
    .filter((item) => item.postId === post.id && item.status === 'active')
    .map((item) => genericBuddyProfile(db.users.find((user) => user.id === item.userId), isMember))
    .filter(Boolean)
  const applications = isCreator
    ? db.buddyApplications
      .filter((item) => item.postId === post.id && item.status === 'pending' && !isBlocked(db, viewerId, item.userId))
      .map((item) => ({ id: item.id, message: item.message, applicant: genericBuddyProfile(db.users.find((user) => user.id === item.userId), false) }))
    : []
  const myApplication = db.buddyApplications.find((item) => item.postId === post.id && item.userId === viewerId)
  const creator = db.users.find((item) => item.id === post.creatorUserId)
  return Object.assign({}, clone(post), {
    typeLabel: BUDDY_TYPE_LIMITS[post.type].label,
    creator: genericBuddyProfile(creator, isMember),
    members, memberCount: members.length, applications, isCreator, isMember,
    myApplicationStatus: myApplication ? myApplication.status : '',
    score: genericBuddyScore(db.users.find((item) => item.id === viewerId) || {}, post, creator || {}, selectedScope),
    scopeLabel: post.scope ? post.scope.label : '全西浦',
    scopeVerified: Boolean(post.scopeVerified),
    verificationReason: post.verificationReason || '用户自行选择'
  })
}
function getBuddyCenter(db, userId) {
  migrateBuddyScopeRecords(db)
  const scopes = buildBuddyScopes(db)
  const currentUser = db.users.find((item) => item.id === userId)
  const courses = clone(db.schedules[userId] || []).map((course) => {
    const scope = sessionScopeFromCourse(currentUser || {}, course)
    return {
      id: course.id, title: course.title, courseCode: normalizeCourseCode(course.courseCode || course.title),
      section: course.section || '', term: course.term || '', weekday: course.weekday, start: course.start, end: course.end,
      scopeKey: scope.scopeKey, confirmed: course.confirmed !== false,
      matchingEnabled: db.buddyOptIns.some((item) => item.userId === userId && item.scopeKey === scope.scopeKey && item.enabled)
    }
  })
  const myPosts = db.buddyPosts.filter((post) => post.creatorUserId === userId)
  const myMemberships = db.buddyMembers.filter((item) => item.userId === userId && item.status === 'active')
  const myApplications = db.buddyApplications.filter((item) => item.userId === userId && item.status === 'pending')
  return {
    courses,
    terms: Array.from(new Set(scopes.map((item) => item.term))).sort().reverse(),
    scopes,
    locationTags: clone(db.buddyLocationTags),
    types: Object.keys(BUDDY_TYPE_LIMITS).map((key) => Object.assign({ id: key }, BUDDY_TYPE_LIMITS[key])),
    stats: {
      activeCoursePools: courses.filter((item) => item.matchingEnabled).length,
      myPosts: myPosts.length, myGroups: myMemberships.length, pendingApplications: myApplications.length
    }
  }
}
function createBuddyPost(db, userId, payload) {
  migrateBuddyScopeRecords(db)
  const type = String(payload.type || '')
  const limits = BUDDY_TYPE_LIMITS[type]
  if (!limits) throw new Error('不支持的搭子类型')
  const availableScopes = buildBuddyScopes(db)
  const defaultScope = availableScopes.find((item) => item.scopeType === 'campus')
  const scope = payload.scopeKey ? findBuddyScope(db, payload.scopeKey) : defaultScope
  if (!scope) throw new Error('请选择有效的匹配范围')
  const maxMembers = Number(payload.maxMembers)
  const scopedMax = scope.scopeType === 'campus' ? limits.max : 5
  if (maxMembers < 2 || maxMembers > scopedMax) throw new Error(`${scope.scopeType === 'campus' ? limits.label : '课程范围'}人数必须为 2 至 ${scopedMax} 人`)
  if (!payload.title || !payload.startAt || !payload.endAt || !payload.deadline) throw new Error('请完整填写搭子需求')
  if (!db.buddyLocationTags.includes(payload.locationTag)) throw new Error('请选择校区预设地点')
  if (new Date(payload.startAt).getTime() >= new Date(payload.endAt).getTime()) throw new Error('结束时间必须晚于开始时间')
  if (new Date(payload.deadline).getTime() <= Date.now() || new Date(payload.deadline).getTime() > new Date(payload.startAt).getTime()) throw new Error('申请截止时间必须晚于当前时间且不晚于活动开始')
  const creator = db.users.find((item) => item.id === userId)
  if (!creator || !creator.buddyWechatId) throw new Error('请先在个人资料中填写搭子微信号')
  const post = {
    id: uniqueId('buddy-post'), creatorUserId: userId, type, scope, scopeKey: scope.scopeKey,
    title: String(payload.title).trim(), maxMembers, startAt: payload.startAt, endAt: payload.endAt,
    locationTag: payload.locationTag,
    tags: Array.from(new Set((payload.tags || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 8),
    description: String(payload.description || '').trim(), deadline: payload.deadline, status: 'open', createdAt: new Date().toISOString()
  }
  Object.assign(post, scopeVerification(db, userId, scope))
  db.buddyPosts.push(post)
  db.buddyMembers.push({ id: uniqueId('buddy-member'), postId: post.id, userId, role: 'creator', status: 'active', joinedAt: new Date().toISOString() })
  return serializeBuddyPost(db, post, userId)
}
function getBuddyPosts(db, userId, filters = {}) {
  migrateBuddyScopeRecords(db)
  const selectedScope = filters.scopeKey ? findBuddyScope(db, filters.scopeKey) : null
  return db.buddyPosts
    .filter((post) => post.status !== 'cancelled')
    .filter((post) => !filters.type || post.type === filters.type)
    .filter((post) => !filters.locationTag || post.locationTag === filters.locationTag)
    .filter((post) => !filters.startAt || new Date(post.endAt).getTime() > new Date(filters.startAt).getTime())
    .filter((post) => !filters.endAt || new Date(post.startAt).getTime() < new Date(filters.endAt).getTime())
    .filter((post) => !selectedScope || scopeContains(selectedScope, post.scope))
    .filter((post) => !isBlocked(db, userId, post.creatorUserId))
    .map((post) => serializeBuddyPost(db, post, userId, selectedScope))
    .sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
}
function getBuddyPost(db, userId, postId) {
  migrateBuddyScopeRecords(db)
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post || isBlocked(db, userId, post.creatorUserId)) throw new Error('搭子需求不存在')
  return serializeBuddyPost(db, post, userId)
}
function applyBuddyPost(db, userId, postId, payload = {}) {
  migrateBuddyScopeRecords(db)
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post) throw new Error('搭子需求不存在')
  refreshBuddyPostStatus(db, post)
  if (post.status !== 'open') throw new Error('该需求已满员或截止')
  if (post.creatorUserId === userId) throw new Error('发起人无需申请自己的需求')
  if (isBlocked(db, userId, post.creatorUserId)) throw new Error('双方存在屏蔽关系')
  const user = db.users.find((item) => item.id === userId)
  if (!user || !user.buddyWechatId) throw new Error('请先在个人资料中填写搭子微信号')
  if (db.buddyMembers.some((item) => item.postId === postId && item.userId === userId && item.status === 'active')) throw new Error('你已经是该小组成员')
  const existing = db.buddyApplications.find((item) => item.postId === postId && item.userId === userId && item.status === 'pending')
  if (existing) throw new Error('申请已提交')

  // 检查现有成员中是否有申请人拉黑的用户
  const force = payload.force === true
  if (!force) {
    const blockedIds = new Set(db.userBlocks.filter((b) => b.blockerUserId === userId).map((b) => b.blockedUserId))
    const activeMemberIds = db.buddyMembers.filter((m) => m.postId === postId && m.status === 'active').map((m) => m.userId)
    // 补齐创建者（不在 buddyMembers 中），确保创建者被屏蔽时也能检测到
    const allMemberIds = [...new Set([post.creatorUserId, ...activeMemberIds])].filter((id) => id !== userId)
    const blockedMembers = allMemberIds.filter((id) => blockedIds.has(id))
    if (blockedMembers.length > 0) {
      const blockedUsers = blockedMembers.map((id) => {
        const u = db.users.find((item) => item.id === id)
        return { id, name: u ? (u.name || u.nickname || id) : id }
      })
      return { needConfirm: true, blockedUsers }
    }
  }

  const application = { id: uniqueId('buddy-application'), postId, userId, message: String(payload.message || '').trim(), status: 'pending', createdAt: new Date().toISOString() }
  db.buddyApplications.push(application)
  return clone(application)
}
function resolveBuddyApplication(db, userId, applicationId, decision) {
  const application = db.buddyApplications.find((item) => item.id === applicationId)
  const post = application && db.buddyPosts.find((item) => item.id === application.postId)
  if (!application || !post) throw new Error('申请不存在')
  if (post.creatorUserId !== userId) throw new Error('仅发起人可以审核')
  if (application.status !== 'pending') throw new Error('该申请已处理')
  refreshBuddyPostStatus(db, post)
  var blockedJoinedNotifs = null
  var applicantNotif = null
  if (decision === 'rejected') {
    application.status = 'rejected'
  } else {
    if (post.status !== 'open') throw new Error('该需求已满员或截止')
    application.status = 'accepted'
    db.buddyMembers.push({ id: uniqueId('buddy-member'), postId: post.id, userId: application.userId, role: 'member', status: 'active', joinedAt: new Date().toISOString() })
    refreshBuddyPostStatus(db, post)

    // 通知申请人
    const creator = db.users.find((u) => u.id === userId)
    applicantNotif = {
      userId: application.userId,
      type: 'post_accepted',
      fromUserId: userId,
      fromUserName: creator ? (creator.name || creator.nickname || userId) : userId,
      postId: post.id,
      postTitle: post.title || ''
    }

    // 检查新成员是否被现有成员拉黑
    const newMemberId = application.userId
    const existingMembers = db.buddyMembers.filter((m) => m.postId === post.id && m.status === 'active' && m.userId !== newMemberId).map((m) => m.userId)
    const blockerIds = existingMembers.filter((id) => db.userBlocks.some((b) => b.blockerUserId === id && b.blockedUserId === newMemberId))
    if (blockerIds.length > 0) {
      const newMember = db.users.find((u) => u.id === newMemberId)
      blockedJoinedNotifs = blockerIds.map((id) => ({
        userId: id,
        type: 'post_blocked_joined',
        fromUserId: newMemberId,
        fromUserName: newMember ? (newMember.name || newMember.nickname || newMemberId) : newMemberId,
        postId: post.id,
        postTitle: post.title || ''
      }))
    }
  }
  application.resolvedAt = new Date().toISOString()
  return Object.assign(serializeBuddyPost(db, post, userId), { _blockedJoinedNotifs: blockedJoinedNotifs, _applicantNotif: applicantNotif || null })
}
function deleteBuddyPost(db, userId, postId) {
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post || post.creatorUserId !== userId) throw new Error('搭子需求不存在')
  post.status = 'cancelled'
  db.buddyApplications.forEach((item) => { if (item.postId === postId && item.status === 'pending') item.status = 'withdrawn' })
  return true
}
function leaveBuddyPost(db, userId, postId) {
  const post = db.buddyPosts.find((item) => item.id === postId)
  const member = db.buddyMembers.find((item) => item.postId === postId && item.userId === userId && item.status === 'active')
  if (!post || !member) throw new Error('你不是该小组成员')
  member.status = 'left'
  member.leftAt = new Date().toISOString()
  if (post.creatorUserId === userId) {
    const next = db.buddyMembers.find((item) => item.postId === postId && item.status === 'active')
    if (next) { next.role = 'creator'; post.creatorUserId = next.userId } else post.status = 'cancelled'
  }
  refreshBuddyPostStatus(db, post)
  return true
}
function blockUser(db, userId, targetUserId) {
  if (targetUserId === userId) throw new Error('不能屏蔽自己')
  if (!db.userBlocks.some((item) => item.blockerUserId === userId && item.blockedUserId === targetUserId)) {
    db.userBlocks.push({ id: uniqueId('user-block'), blockerUserId: userId, blockedUserId: targetUserId, createdAt: new Date().toISOString() })
  }

  // 双向清理小组关系：
  // 1) 屏蔽者退出被屏蔽用户创建的搭子帖/组队
  // 2) 被屏蔽用户退出屏蔽者创建的搭子帖/组队

  const allPosts = db.buddyPosts.filter((p) => p.creatorUserId === targetUserId || p.creatorUserId === userId)
  allPosts.forEach((post) => {
    const removeUserId = post.creatorUserId === targetUserId ? userId : targetUserId
    const member = db.buddyMembers.find((m) => m.postId === post.id && m.userId === removeUserId && m.status === 'active')
    if (member) {
      member.status = 'left'
      member.leftAt = new Date().toISOString()
      refreshBuddyPostStatus(db, post)
    }
  })

  const allTeams = db.courseTeams.filter((t) => t.creatorUserId === targetUserId || t.creatorUserId === userId)
  allTeams.forEach((team) => {
    const removeUserId = team.creatorUserId === targetUserId ? userId : targetUserId
    const member = db.courseTeamMembers.find((m) => m.teamId === team.id && m.userId === removeUserId && m.status === 'active')
    if (member) {
      member.status = 'left'
      member.leftAt = new Date().toISOString()
      refreshTeamStatus(db, team)
    }
  })

  // 检查双方是否在第三方小组中是共同成员（非创建者），返回供前端提示
  const sharedGroups = []
  db.buddyPosts.forEach((post) => {
    if (post.creatorUserId === userId || post.creatorUserId === targetUserId) return
    const aMember = db.buddyMembers.find((m) => m.postId === post.id && m.userId === userId && m.status === 'active')
    const bMember = db.buddyMembers.find((m) => m.postId === post.id && m.userId === targetUserId && m.status === 'active')
    if (aMember && bMember) {
      sharedGroups.push({ id: post.id, title: post.title || '', type: 'buddy_post' })
    }
  })
  db.courseTeams.forEach((team) => {
    if (team.creatorUserId === userId || team.creatorUserId === targetUserId) return
    const aMember = db.courseTeamMembers.find((m) => m.teamId === team.id && m.userId === userId && m.status === 'active')
    const bMember = db.courseTeamMembers.find((m) => m.teamId === team.id && m.userId === targetUserId && m.status === 'active')
    if (aMember && bMember) {
      sharedGroups.push({ id: team.id, title: team.title || team.courseName || '', type: 'course_team' })
    }
  })

  return { blocked: true, sharedGroups: sharedGroups.length > 0 ? sharedGroups : null }
}
function getBlockedUsers(db, userId) {
  const blocks = (db.userBlocks || []).filter((b) => b.blockerUserId === userId)
  return blocks.map((b) => {
    const blocked = db.users.find((u) => u.id === b.blockedUserId)
    return {
      id: b.id,
      blockedUserId: b.blockedUserId,
      blockedUser: blocked ? { id: blocked.id, name: blocked.name, avatar: blocked.avatar || '' } : null,
      createdAt: b.createdAt
    }
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}
function unblockUser(db, userId, targetUserId) {
  const idx = (db.userBlocks || []).findIndex((b) => b.blockerUserId === userId && b.blockedUserId === targetUserId)
  if (idx >= 0) {
    const removed = db.userBlocks.splice(idx, 1)[0]
    if (!db._removedBlockIds) db._removedBlockIds = []
    db._removedBlockIds.push(removed.id)
  }
  // 清理双方之间的 IGNORED 请求
  const reqs = db.buddyMatchRequests || []
  for (let i = reqs.length - 1; i >= 0; i--) {
    const r = reqs[i]
    if (r.status === 'ignored' &&
      ((r.fromUserId === userId && r.toUserId === targetUserId) || (r.fromUserId === targetUserId && r.toUserId === userId))) {
      reqs.splice(i, 1)
    }
  }
  return { unblocked: true }
}
function reportUser(db, userId, targetUserId, payload = {}) {
  if (targetUserId === userId) throw new Error('不能举报自己')
  const validTypes = ['behavior_report', 'nickname_report', 'avatar_report']
  const type = validTypes.includes(payload.type) ? payload.type : 'behavior_report'
  db.userReports.push({
    id: uniqueId('user-report'),
    reporterUserId: userId,
    reportedUserId: targetUserId,
    type,
    reason: String(payload.reason || '其他').trim(),
    detail: String(payload.detail || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  })
  db.riskEvents.push({ id: uniqueId('risk-event'), userId: targetUserId, sourceUserId: userId, type: 'user_report', status: 'open', createdAt: new Date().toISOString() })
  return true
}

function submitFeedback(db, userId, payload = {}) {
  const content = String(payload.content || '').trim()
  if (!content) throw new Error('反馈内容不能为空')
  db.userReports.push({
    id: uniqueId('user-feedback'),
    reporterUserId: userId,
    type: 'feedback',
    reason: '',
    detail: content,
    contact: String(payload.contact || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  })
  return true
}

module.exports = {
  DEFAULT_LOCATION_TAGS,
  // course buddy
  getCourseBuddyStatus, setCourseBuddyOptIn, removeCourseBuddyOptIn, getCourseBuddyCandidates,
  // scope buddy
  getBuddyScopeTerms, getBuddyScopes, getBuddyOptIn, setBuddyOptIn, removeBuddyOptIn, getBuddyCandidates,
  createBuddyMatchRequest, getBuddyMatchRequests, resolveBuddyMatchRequest,
  // course teams
  createCourseTeam, getCourseTeams, getCourseTeam, applyCourseTeam, resolveCourseTeamApplication,
  withdrawCourseTeamApplication, deleteCourseTeam, leaveCourseTeam,
  // buddy posts
  getBuddyCenter, createBuddyPost, getBuddyPosts, getBuddyPost, applyBuddyPost, resolveBuddyApplication,
  deleteBuddyPost, leaveBuddyPost, blockUser, unblockUser, getBlockedUsers, reportUser, submitFeedback
}
