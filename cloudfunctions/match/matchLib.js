/**
 * 找搭子匹配系统 — 核心业务逻辑
 *
 * 设计原则：
 * - 纯函数操作内存镜像 (memDb)，持久化由 index.js 负责
 * - memDb 结构：{ users, schedulesFlat, matchPool, matchRequests, matchedPairs, userBlocks }
 * - 用户主键使用 xipooId（存于 user.id）
 */

// 内联常量（云函数不可引用外部目录）
const BUDDY_TYPE = { STUDY: 'study', MEAL: 'meal', SPORT: 'sport', SELFSTUDY: 'selfstudy', ENTERTAINMENT: 'entertainment' }
const MATCH_REQUEST_STATUS = { PENDING: 'pending', ACCEPTED: 'accepted', IGNORED: 'ignored', EXPIRED: 'expired' }
const MATCHED_PAIR_STATUS = { ACTIVE: 'active', UNMATCHED: 'unmatched' }
const GENDER_FILTER = { ANY: 'any', MALE: 'male', FEMALE: 'female' }

// ==================== 系统预设标签库 ====================
const SYSTEM_TAGS = [
  { id: 'tag_study_01', zh: '图书馆卷王', en: 'Library King', category: 'study' },
  { id: 'tag_study_02', zh: '晨读党', en: 'Morning Reader', category: 'study' },
  { id: 'tag_study_03', zh: 'DDL战神', en: 'DDL Warrior', category: 'study' },
  { id: 'tag_study_04', zh: '笔记共享', en: 'Note Sharing', category: 'study' },
  { id: 'tag_study_05', zh: '期末抱佛脚', en: 'Last-Minute Crammer', category: 'study' },
  { id: 'tag_sport_01', zh: '健身撸铁', en: 'Gym Rat', category: 'sport' },
  { id: 'tag_sport_02', zh: '跑步', en: 'Runner', category: 'sport' },
  { id: 'tag_sport_03', zh: '羽毛球', en: 'Badminton', category: 'sport' },
  { id: 'tag_sport_04', zh: '游泳', en: 'Swimmer', category: 'sport' },
  { id: 'tag_sport_05', zh: '篮球', en: 'Basketball', category: 'sport' },
  { id: 'tag_sport_06', zh: '足球', en: 'Football', category: 'sport' },
  { id: 'tag_meal_01', zh: '食堂干饭人', en: 'Canteen Foodie', category: 'meal' },
  { id: 'tag_meal_02', zh: '外卖拼单', en: 'Takeout Grouper', category: 'meal' },
  { id: 'tag_meal_03', zh: '奶茶搭子', en: 'Milk Tea Buddy', category: 'meal' },
  { id: 'tag_meal_04', zh: '轻食主义', en: 'Light Eater', category: 'meal' },
  { id: 'tag_meal_05', zh: '探店打卡', en: 'Food Explorer', category: 'meal' },
  { id: 'tag_life_01', zh: '早睡早起', en: 'Early Bird', category: 'lifestyle' },
  { id: 'tag_life_02', zh: '夜猫子', en: 'Night Owl', category: 'lifestyle' },
  { id: 'tag_life_03', zh: '午休必睡', en: 'No Nap No Life', category: 'lifestyle' },
  { id: 'tag_ent_01', zh: '游戏开黑', en: 'Game Squad', category: 'entertainment' },
  { id: 'tag_ent_02', zh: '电影搭子', en: 'Movie Buddy', category: 'entertainment' },
  { id: 'tag_ent_03', zh: '逛展', en: 'Exhibition Goer', category: 'entertainment' },
  { id: 'tag_ent_04', zh: 'K歌', en: 'Karaoke', category: 'entertainment' },
  { id: 'tag_ent_05', zh: '桌游', en: 'Board Games', category: 'entertainment' }
]

// ==================== 工具函数 ====================

let idSeq = 0
function uid(prefix) {
  idSeq += 1
  return `${prefix}-${Date.now()}-${idSeq}`
}

function clone(v) { return JSON.parse(JSON.stringify(v)) }

// ==================== 空闲时间位图 ====================

const SLOTS_PER_DAY = 22  // 9:00-20:00, 30min 粒度
const TOTAL_SLOTS = 154   // 22 × 7
const DAY_START_MINUTES = 9 * 60  // 540

/**
 * 将 time "HH:mm" 转为当日 slot 索引 (0-21)
 * 9:00 → 0, 9:30 → 1, ..., 19:30 → 21
 */
function timeToSlot(time) {
  const [h, m] = String(time || '9:00').split(':').map(Number)
  return Math.floor((h * 60 + m - DAY_START_MINUTES) / 30)
}

/**
 * 根据课表计算 154 位空闲位图
 * courses: [{ weekday, start, end }]
 * weekday: 1=Mon ... 7=Sun
 */
function calculateFreeTimeBitmap(courses) {
  // 初始全 1（全部空闲）
  const bits = new Array(TOTAL_SLOTS).fill(1)
  const activeCourses = (courses || []).filter(
    (c) => c.weekday && c.start && c.end && c.confirmed !== false
  )
  activeCourses.forEach((c) => {
    const day = Number(c.weekday)  // 1-7
    if (day < 1 || day > 7) return
    const startSlot = timeToSlot(c.start)
    const endSlot = timeToSlot(c.end)
    const dayOffset = (day - 1) * SLOTS_PER_DAY
    for (let s = startSlot; s < endSlot && s < SLOTS_PER_DAY; s++) {
      if (s >= 0) bits[dayOffset + s] = 0
    }
  })
  return bits.join('')
}

/** 午餐时段 (11:00-13:00) 每日 slot 索引 4-8（第4-8个时段，共5个） */
const LUNCH_SLOTS = [4, 5, 6, 7, 8]
/** 晚餐时段 (17:00-19:00) 每日 slot 索引 16-20（第16-20个时段，共5个） */
const DINNER_SLOTS = [16, 17, 18, 19, 20]

function isMealSlot(daySlotIndex) {
  return LUNCH_SLOTS.includes(daySlotIndex) || DINNER_SLOTS.includes(daySlotIndex)
}

/**
 * 对两个位图进行按位与，返回 { regular, weighted }
 * regular: 共同空闲 slot 数
 * weighted: 午餐/晚餐 slot ×1.5 加权
 */
function countCommonFreeSlots(bitmapA, bitmapB) {
  if (!bitmapA || !bitmapB || bitmapA.length !== TOTAL_SLOTS || bitmapB.length !== TOTAL_SLOTS) {
    return { regular: 0, weighted: 0 }
  }
  let regular = 0
  let weighted = 0
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (bitmapA[i] === '1' && bitmapB[i] === '1') {
      regular += 1
      const daySlotIndex = i % SLOTS_PER_DAY
      weighted += isMealSlot(daySlotIndex) ? 1.5 : 1
    }
  }
  return { regular, weighted }
}

// ==================== 资料完整度计分 ====================

function computeProfileCompleteness(user, courseCount) {
  let score = 0
  if (courseCount > 0) score += 50
  if (user.signature && user.signature.trim()) score += 20
  const tagCount = (user.selectedTags || []).length
  if (tagCount >= 3) score += Math.min(20, 10 + (tagCount - 3) * 2)
  if ((user.grade || user.degree || '') && (user.grade || user.degree || '').trim()) score += 5
  if (user.major && user.major.trim()) score += 5
  return score
}

// ==================== 共同标签 & 同年级 ====================

function countCommonTags(myTagIds, theirTagIds) {
  const theirSet = new Set(theirTagIds || [])
  return (myTagIds || []).filter((t) => theirSet.has(t)).length
}

function isSameGrade(myGrade, theirGrade) {
  if (!myGrade || !theirGrade) return false
  return String(myGrade).trim() === String(theirGrade).trim()
}

// ==================== 课程匹配辅助 ====================

/**
 * 两门课是否为同一门（同 courseId + 同 section）
 */
function isSameCourse(a, b) {
  const aId = a.courseId || ((a.courseCode || '') + '_' + (a.section || ''))
  const bId = b.courseId || ((b.courseCode || '') + '_' + (b.section || ''))
  if (aId && bId && aId === bId) return true
  return (a.courseCode || '') === (b.courseCode || '') && String(a.section || '') === String(b.section || '')
}

function countCommonCourses(myCourses, theirCourses) {
  let count = 0
  const theirs = [...(theirCourses || [])]
  ;(myCourses || []).forEach((myCourse) => {
    const idx = theirs.findIndex((c) => isSameCourse(myCourse, c))
    if (idx >= 0) {
      count += 1
      theirs.splice(idx, 1)  // 同一门课不重复计数
    }
  })
  return count
}

// ==================== 过滤 & 冷却期 ====================

const COOLDOWN_DAYS = 7
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000
const INTEREST_EXPIRE_MS = 72 * 60 * 60 * 1000  // 72h

function isBlocked(memDb, userId, targetId) {
  return (memDb.userBlocks || []).some((b) =>
    b.blockerUserId === userId && b.blockedUserId === targetId
  )
}

function isAlreadyMatched(memDb, userId, targetId) {
  return (memDb.matchedPairs || []).some((p) =>
    p.status === MATCHED_PAIR_STATUS.ACTIVE &&
    ((p.userA === userId && p.userB === targetId) || (p.userA === targetId && p.userB === userId))
  )
}

function hasPendingRequest(memDb, fromUserId, toUserId, buddyType) {
  return (memDb.matchRequests || []).some((r) =>
    r.fromUserId === fromUserId && r.toUserId === toUserId &&
    r.buddyType === buddyType && r.status === MATCH_REQUEST_STATUS.PENDING
  )
}

function isInCooldown(memDb, fromUserId, toUserId, buddyType) {
  const now = Date.now()
  return (memDb.matchRequests || []).some((r) =>
    r.fromUserId === fromUserId && r.toUserId === toUserId &&
    r.buddyType === buddyType &&
    (r.status === MATCH_REQUEST_STATUS.IGNORED || r.status === MATCH_REQUEST_STATUS.EXPIRED) &&
    r.createdAt && (now - new Date(r.createdAt).getTime()) < COOLDOWN_MS
  )
}

/** 检查双方是否互相向对方发起了 pending 请求（双向互发） */
function findMutualPending(memDb, userIdA, userIdB, buddyType) {
  return (memDb.matchRequests || []).filter((r) =>
    r.status === MATCH_REQUEST_STATUS.PENDING && r.buddyType === buddyType &&
    ((r.fromUserId === userIdA && r.toUserId === userIdB) || (r.fromUserId === userIdB && r.toUserId === userIdA))
  )
}

// ==================== 脱敏公共主页 ====================

function publicProfile(user, completeness) {
  return {
    id: user.id,
    avatar: user.avatarUrl || user.avatar || '',
    nickname: user.name || 'Xipoo User',
    grade: user.grade || user.degree || '',
    tags: user.selectedTags || [],
    signature: user.signature || '',
    completeness: completeness != null ? completeness : computeProfileCompleteness(user, 0)
  }
}

function fullProfile(user, completeness) {
  return {
    id: user.id,
    avatar: user.avatarUrl || user.avatar || '',
    nickname: user.name || 'Xipoo User',
    grade: user.grade || user.degree || '',
    major: user.major || '',
    degree: user.degree || '',
    school: user.school || '',
    gender: user.gender || '',
    tags: user.selectedTags || [],
    signature: user.signature || '',
    bio: user.bio || '',
    buddyWechatId: user.buddyWechatId || '',
    completeness: completeness != null ? completeness : computeProfileCompleteness(user, 0)
  }
}

// ==================== 匹配推荐算法 ====================

/**
 * 获取某类型的推荐列表 Top 20
 */
function getRecommendations(memDb, userId, buddyType) {
  const me = (memDb.users || []).find((u) => u.id === userId)
  if (!me) throw new Error('用户不存在')

  // 检查自己是否已入池
  const myPool = (memDb.matchPool || []).find((p) => p.userId === userId)
  const poolEntry = myPool && myPool.pools && myPool.pools[buddyType]
  if (!poolEntry || !poolEntry.enabled) {
    throw new Error('请先开启该类型的找搭子开关')
  }

  const myCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === userId)
  const myCourseCount = myCourses.length
  const myTags = (poolEntry && poolEntry.selectedTags) || me.selectedTags || []
  const myGrade = me.grade || me.degree || ''
  const myBitmap = me.freeTimeBitmap || ''

  const now = Date.now()

  // 候选集：过滤
  const candidates = (memDb.users || [])
    .filter((u) => u.id !== userId)
    .filter((u) => {
      // 对方必须入池
      const pool = (memDb.matchPool || []).find((p) => p.userId === u.id)
      const entry = pool && pool.pools && pool.pools[buddyType]
      return entry && entry.enabled
    })
    .filter((u) => {
      // 性别硬过滤
      const pool = (memDb.matchPool || []).find((p) => p.userId === u.id)
      const entry = pool && pool.pools && pool.pools[buddyType]
      if (!entry || !entry.genderFilter || entry.genderFilter === GENDER_FILTER.ANY) return true
      const myG = (me.gender === '男') ? 'male' : (me.gender === '女') ? 'female' : me.gender
      return entry.genderFilter === myG
    })
    .filter((u) => {
      // 我设置的性别筛选
      if (!poolEntry.genderFilter || poolEntry.genderFilter === GENDER_FILTER.ANY) return true
      const uGender = (u.gender === '男') ? 'male' : (u.gender === '女') ? 'female' : u.gender
      return poolEntry.genderFilter === uGender
    })
    .filter((u) => !isBlocked(memDb, userId, u.id))
    .filter((u) => !isInCooldown(memDb, userId, u.id, buddyType))

  // 正在匹配中的请求，标记为已发送但不可再发
  const scored = candidates.map((candidate) => {
    const theirCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === candidate.id)
    const theirPool = (memDb.matchPool || []).find((p) => p.userId === candidate.id)
    const theirPoolEntry = theirPool && theirPool.pools && theirPool.pools[buddyType]
    const theirTags = candidate.selectedTags || []
    const theirBitmap = candidate.freeTimeBitmap || ''
    const theirGrade = candidate.grade || ''

    let totalScore = 0
    let hardPass = false

    if (buddyType === BUDDY_TYPE.COURSE) {
      const commonCourses = countCommonCourses(myCourses, theirCourses)
      if (commonCourses === 0) hardPass = true
      totalScore = commonCourses * 100
        + countCommonTags(myTags, theirTags) * 100
        + (isSameGrade(myGrade, theirGrade) ? 10 : 0)
    } else {
      // 饭搭子 / 运动搭子 / 自习搭子
      const { weighted } = countCommonFreeSlots(myBitmap, theirBitmap)
      if (weighted === 0) hardPass = true
      totalScore = Math.round(weighted * 40)
        + countCommonTags(myTags, theirTags) * 100
        + (isSameGrade(myGrade, theirGrade) ? 10 : 0)
    }

    const completeness = computeProfileCompleteness(candidate, theirCourses.length)
    const pending = hasPendingRequest(memDb, userId, candidate.id, buddyType)
    const matched = isAlreadyMatched(memDb, userId, candidate.id)

    return {
      userId: candidate.id,
      profile: publicProfile(candidate, completeness),
      score: hardPass ? -1 : totalScore,
      completeness,
      lastActiveAt: candidate.lastActiveAt || '',
      hasPending: pending,
      isMatchedPair: matched,
      commonTagCount: countCommonTags(myTags, theirTags),
      commonDetail: buddyType === BUDDY_TYPE.COURSE
        ? { commonCourses: countCommonCourses(myCourses, theirCourses) }
        : { commonFreeSlots: countCommonFreeSlots(myBitmap, theirBitmap).regular }
    }
  })

  // 排序：score desc → completeness desc → lastActiveAt desc
  const ranked = scored
    .filter((c) => c.score >= 0 && !c.hasPending)  // 硬条件不满足或已发请求的不展示（但标记已发送的除外）
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.completeness !== a.completeness) return b.completeness - a.completeness
      return String(b.lastActiveAt).localeCompare(String(a.lastActiveAt))
    })
    .slice(0, 20)
    .map((c) => ({
      userId: c.userId,
      profile: c.profile,
      score: c.score,
      commonTagCount: c.commonTagCount,
      sameGrade: isSameGrade(myGrade, c.profile.grade),
      isMatchedPair: c.isMatchedPair || false,
      ...c.commonDetail
    }))

  // 找出已发送请求的用户（单独返回，前端标记）
  const sentList = scored
    .filter((c) => c.hasPending)
    .map((c) => ({
      userId: c.userId,
      profile: c.profile,
      status: 'sent'
    }))

  return { recommendations: ranked, sentCount: sentList.length, total: scored.length }
}

// ==================== 意向请求 ====================

function sendInterest(memDb, fromUserId, toUserId, buddyType) {
  if (fromUserId === toUserId) throw new Error('不能对自己发起感兴趣')

  function isInPool(pool, type) {
    if (type === 'course') {
      return pool && pool.coursePools && Object.values(pool.coursePools).some((cp) => cp.enabled)
    }
    return pool && pool.pools && pool.pools[type] && pool.pools[type].enabled
  }

  const fromPool = (memDb.matchPool || []).find((p) => p.userId === fromUserId)
  if (!isInPool(fromPool, buddyType)) throw new Error('请先开启该类型的找搭子开关')
  const toUser = (memDb.users || []).find((u) => u.id === toUserId)
  if (!toUser) throw new Error('用户不存在')
  const toPool = (memDb.matchPool || []).find((p) => p.userId === toUserId)
  if (!isInPool(toPool, buddyType)) throw new Error('对方未开启该类型匹配')

  if (isAlreadyMatched(memDb, fromUserId, toUserId)) throw new Error('你们已经是搭子')
  if (isInCooldown(memDb, fromUserId, toUserId, buddyType)) throw new Error('对方处于冷却期')

  // 重复请求检查
  if (hasPendingRequest(memDb, fromUserId, toUserId, buddyType)) {
    throw new Error('已向对方发起过感兴趣，请等待回复')
  }

  // 双向互发检查：对方是否已向我发起 pending 请求
  const mutualRequests = findMutualPending(memDb, fromUserId, toUserId, buddyType)
  if (mutualRequests.length > 0) {
    // 双向互发 → 自动匹配
    const now = new Date().toISOString()
    mutualRequests.forEach((r) => {
      r.status = MATCH_REQUEST_STATUS.ACCEPTED
      r.resolvedAt = now
    })
    const pair = {
      id: uid('pair'),
      userA: fromUserId,
      userB: toUserId,
      buddyType,
      matchedAt: now,
      unmatchedAt: null,
      unmatchedBy: null,
      status: MATCHED_PAIR_STATUS.ACTIVE
    }
    if (!memDb.matchedPairs) memDb.matchedPairs = []
    memDb.matchedPairs.push(pair)

    const aUser = (memDb.users || []).find((u) => u.id === fromUserId)
    const bUser = (memDb.users || []).find((u) => u.id === toUserId)
    return {
      autoMatched: true,
      pair: clone(pair),
      partner: publicProfile(bUser || {}, computeProfileCompleteness(bUser || {}, 0))
    }
  }

  // 正常发起
  const request = {
    id: uid('req'),
    fromUserId,
    toUserId,
    buddyType,
    status: MATCH_REQUEST_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    resolvedAt: null
  }
  if (!memDb.matchRequests) memDb.matchRequests = []
  memDb.matchRequests.push(request)
  return { autoMatched: false, request: clone(request) }
}

function getIncomingInterests(memDb, userId) {
  const now = Date.now()
  const requests = (memDb.matchRequests || [])
    .filter((r) => r.toUserId === userId)
    .map((r) => {
      // 过期检查：72h 未处理自动过期
      if (r.status === MATCH_REQUEST_STATUS.PENDING && r.createdAt) {
        if (now - new Date(r.createdAt).getTime() > INTEREST_EXPIRE_MS) {
          r.status = MATCH_REQUEST_STATUS.EXPIRED
          r.resolvedAt = new Date().toISOString()
        }
      }
      return r
    })

  // 只显示待处理 + 过滤 blocked
  return requests
    .filter((r) => r.status === MATCH_REQUEST_STATUS.PENDING && !isBlocked(memDb, userId, r.fromUserId))
    .map((r) => {
      const user = (memDb.users || []).find((u) => u.id === r.fromUserId)
      const theirCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === r.fromUserId)
      return {
        id: r.id,
        buddyType: r.buddyType,
        status: r.status,
        createdAt: r.createdAt,
        fromUser: user ? publicProfile(user, computeProfileCompleteness(user, theirCourses.length)) : null
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function getSentInterests(memDb, userId) {
  return (memDb.matchRequests || [])
    .filter((r) => r.fromUserId === userId && r.status === 'pending')
    .map((r) => {
      const toUser = (memDb.users || []).find((u) => u.id === r.toUserId)
      const theirCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === r.toUserId)
      return {
        id: r.id,
        buddyType: r.buddyType,
        status: r.status,
        createdAt: r.createdAt,
        toUser: toUser ? publicProfile(toUser, computeProfileCompleteness(toUser, theirCourses.length)) : null
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function acceptInterest(memDb, userId, requestId) {
  const request = (memDb.matchRequests || []).find((r) => r.id === requestId)
  if (!request || request.toUserId !== userId) throw new Error('请求不存在')
  if (request.status !== MATCH_REQUEST_STATUS.PENDING) throw new Error('该请求已处理')

  // 检查是否已配对
  if (isAlreadyMatched(memDb, userId, request.fromUserId)) throw new Error('你们已经是搭子')

  const now = new Date().toISOString()
  request.status = MATCH_REQUEST_STATUS.ACCEPTED
  request.resolvedAt = now

  // 创建匹配记录
  const pair = {
    id: uid('pair'),
    userA: userId,
    userB: request.fromUserId,
    buddyType: request.buddyType,
    matchedAt: now,
    unmatchedAt: null,
    unmatchedBy: null,
    status: MATCHED_PAIR_STATUS.ACTIVE
  }
  if (!memDb.matchedPairs) memDb.matchedPairs = []
  memDb.matchedPairs.push(pair)

  // 返回对方完整主页
  const partner = (memDb.users || []).find((u) => u.id === request.fromUserId)
  const partnerCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === request.fromUserId)
  return {
    pair: clone(pair),
    partner: partner ? fullProfile(partner, computeProfileCompleteness(partner, partnerCourses.length)) : null
  }
}

function cancelInterest(memDb, userId, requestId) {
  const request = (memDb.matchRequests || []).find((r) => r.id === requestId)
  if (!request || request.fromUserId !== userId) throw new Error('请求不存在')
  if (request.status !== MATCH_REQUEST_STATUS.PENDING) throw new Error('只能撤回待处理的请求')
  request.status = 'cancelled'
  request.resolvedAt = new Date().toISOString()
  return true
}

function ignoreInterest(memDb, userId, requestId) {
  const request = (memDb.matchRequests || []).find((r) => r.id === requestId)
  if (!request || request.toUserId !== userId) throw new Error('请求不存在')
  if (request.status !== MATCH_REQUEST_STATUS.PENDING) throw new Error('该请求已处理')

  request.status = MATCH_REQUEST_STATUS.IGNORED
  request.resolvedAt = new Date().toISOString()
  return true
}

// ==================== 匹配管理 ====================

function getMyMatches(memDb, userId) {
  const pairs = (memDb.matchedPairs || [])
    .filter((p) => p.status === MATCHED_PAIR_STATUS.ACTIVE &&
      (p.userA === userId || p.userB === userId))

  return pairs.map((p) => {
    const partnerId = p.userA === userId ? p.userB : p.userA
    const partner = (memDb.users || []).find((u) => u.id === partnerId)
    const partnerCourses = (memDb.schedulesFlat || []).filter((c) => c.userId === partnerId)
    return {
      pairId: p.id,
      buddyType: p.buddyType,
      matchedAt: p.matchedAt,
      partner: partner ? fullProfile(partner, computeProfileCompleteness(partner, partnerCourses.length)) : null
    }
  }).sort((a, b) => String(b.matchedAt).localeCompare(String(a.matchedAt)))
}

function unmatch(memDb, userId, pairId) {
  const pair = (memDb.matchedPairs || []).find((p) => p.id === pairId)
  if (!pair) throw new Error('匹配记录不存在')
  if (pair.userA !== userId && pair.userB !== userId) throw new Error('无权操作')
  if (pair.status !== MATCHED_PAIR_STATUS.ACTIVE) throw new Error('该匹配已解除')

  pair.status = MATCHED_PAIR_STATUS.UNMATCHED
  pair.unmatchedAt = new Date().toISOString()
  pair.unmatchedBy = userId
  return true
}

// ==================== 拉黑 ====================

function blockUserInMatch(memDb, userId, targetUserId) {
  if (userId === targetUserId) throw new Error('不能拉黑自己')

  // 写入拉黑记录
  if (!(memDb.userBlocks || []).some((b) => b.blockerUserId === userId && b.blockedUserId === targetUserId)) {
    if (!memDb.userBlocks) memDb.userBlocks = []
    memDb.userBlocks.push({
      id: uid('block'),
      blockerUserId: userId,
      blockedUserId: targetUserId,
      createdAt: new Date().toISOString()
    })
  }

  // 若存在活跃匹配，直接删除记录
  var pairIdx = -1
  var pair = null
  for (var i = 0; i < (memDb.matchedPairs || []).length; i++) {
    var p = memDb.matchedPairs[i]
    if (p.status === MATCHED_PAIR_STATUS.ACTIVE &&
      ((p.userA === userId && p.userB === targetUserId) || (p.userA === targetUserId && p.userB === userId))) {
      pairIdx = i
      pair = p
      break
    }
  }
  if (pairIdx >= 0) {
    var removed = memDb.matchedPairs.splice(pairIdx, 1)[0]
    if (!memDb._removedPairIds) memDb._removedPairIds = []
    memDb._removedPairIds.push(removed.id)
  }

  // 只忽略被屏蔽者发来的 pending 请求，不忽略屏蔽者自己发出的
  // 这样解除屏蔽后屏蔽者不会因自己的请求被 ignore 而陷入冷却期
  ;(memDb.matchRequests || []).forEach((r) => {
    if (r.status === MATCH_REQUEST_STATUS.PENDING &&
      r.fromUserId === targetUserId && r.toUserId === userId) {
      r.status = MATCH_REQUEST_STATUS.IGNORED
      r.resolvedAt = new Date().toISOString()
    }
  })

  return { blocked: true, wasUnmatched: !!pair }
}

function getBlockedUsers(memDb, userId) {
  const blocks = (memDb.userBlocks || []).filter((b) => b.blockerUserId === userId)
  return blocks.map((b) => {
    const blocked = (memDb.users || []).find((u) => u.id === b.blockedUserId)
    return {
      id: b.id,
      blockedUserId: b.blockedUserId,
      blockedUser: blocked ? { id: blocked.id, name: blocked.name, nickname: blocked.name, avatar: blocked.avatarUrl || blocked.avatar || '', grade: blocked.grade || '' } : null,
      createdAt: b.createdAt
    }
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function unblockUser(memDb, userId, targetUserId) {
  const idx = (memDb.userBlocks || []).findIndex((b) => b.blockerUserId === userId && b.blockedUserId === targetUserId)
  if (idx >= 0) {
    var removed = memDb.userBlocks.splice(idx, 1)[0]
    if (!memDb._removedBlockIds) memDb._removedBlockIds = []
    memDb._removedBlockIds.push(removed.id)
  }
  // 清除双方之间的 IGNORED 请求，避免解除屏蔽后仍受冷却期影响
  var reqs = memDb.matchRequests || []
  for (var i = reqs.length - 1; i >= 0; i--) {
    var r = reqs[i]
    if (r.status === MATCH_REQUEST_STATUS.IGNORED &&
      ((r.fromUserId === userId && r.toUserId === targetUserId) || (r.fromUserId === targetUserId && r.toUserId === userId))) {
      reqs.splice(i, 1)
    }
  }
  return { unblocked: true }
}

// ==================== 系统标签 ====================

function getSystemTags() {
  return clone(SYSTEM_TAGS)
}

function updateSelectedTags(memDb, userId, tagIds) {
  const user = (memDb.users || []).find((u) => u.id === userId)
  if (!user) throw new Error('用户不存在')

  if (!Array.isArray(tagIds)) throw new Error('标签格式错误')
  if (tagIds.length > 10) throw new Error('最多选择10个标签')

  // 验证标签合法性
  const validIds = new Set(SYSTEM_TAGS.map((t) => t.id))
  const invalid = tagIds.filter((id) => !validIds.has(id))
  if (invalid.length) throw new Error(`无效标签: ${invalid.join(', ')}`)

  user.selectedTags = tagIds
  user._updated = true
  return clone(user.selectedTags)
}

// ==================== 入池管理 ====================

function getMatchPool(memDb, userId) {
  let pool = (memDb.matchPool || []).find((p) => p.userId === userId)
  if (!pool) {
    pool = {
      userId,
      pools: {
        [BUDDY_TYPE.COURSE]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.STUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.MEAL]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SPORT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SELFSTUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.ENTERTAINMENT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    memDb.matchPool.push(pool)
  }
  return clone(pool)
}

function setMatchPool(memDb, userId, buddyType, config) {
  if (!Object.values(BUDDY_TYPE).includes(buddyType)) throw new Error('无效的搭子类型')

  const enabled = Boolean(config.enabled)
  let genderFilter = config.genderFilter || GENDER_FILTER.ANY
  if (!Object.values(GENDER_FILTER).includes(genderFilter)) genderFilter = GENDER_FILTER.ANY
  let selectedTags = Array.isArray(config.selectedTags) ? config.selectedTags.slice(0, 10) : undefined

  let pool = (memDb.matchPool || []).find((p) => p.userId === userId)
  if (!pool) {
    pool = {
      userId,
      pools: {
        [BUDDY_TYPE.COURSE]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.STUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.MEAL]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SPORT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SELFSTUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.ENTERTAINMENT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] }
      },
      createdAt: new Date().toISOString()
    }
    memDb.matchPool.push(pool)
  }

  if (!pool.pools[buddyType]) {
    pool.pools[buddyType] = { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] }
  }
  pool.pools[buddyType].enabled = enabled
  pool.pools[buddyType].genderFilter = genderFilter
  if (selectedTags !== undefined) {
    pool.pools[buddyType].selectedTags = selectedTags
  }
  pool.updatedAt = new Date().toISOString()

  // 关闭入池时，清理该类型下我发出的 pending 请求
  if (!enabled) {
    ;(memDb.matchRequests || []).forEach((r) => {
      if (r.fromUserId === userId && r.buddyType === buddyType && r.status === MATCH_REQUEST_STATUS.PENDING) {
        r.status = MATCH_REQUEST_STATUS.IGNORED
        r.resolvedAt = new Date().toISOString()
      }
    })
  }

  return clone(pool)
}

function setCoursePool(memDb, userId, courseId, config) {
  const enabled = Boolean(config && config.enabled)
  const genderFilter = (config && config.genderFilter && Object.values(GENDER_FILTER).includes(config.genderFilter)) ? config.genderFilter : GENDER_FILTER.ANY
  const selectedTags = (config && Array.isArray(config.selectedTags)) ? config.selectedTags.slice(0, 10) : []
  const matchMode = (config && config.matchMode === 'family') ? 'family' : 'campus'
  const sameGrade = Boolean(config && config.sameGrade)

  let pool = (memDb.matchPool || []).find((p) => p.userId === userId)
  if (!pool) {
    pool = {
      userId,
      pools: {
        [BUDDY_TYPE.STUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.MEAL]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SPORT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.SELFSTUDY]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] },
        [BUDDY_TYPE.ENTERTAINMENT]: { enabled: false, genderFilter: GENDER_FILTER.ANY, selectedTags: [] }
      },
      coursePools: {},
      createdAt: new Date().toISOString()
    }
    memDb.matchPool.push(pool)
  }

  if (!pool.coursePools) pool.coursePools = {}
  // 用 courseCode 前缀找已有 key，合并而非创建重复
  const parts = courseId.split('_')
  const code = parts[0] || courseId
  const existingKey = findPoolKey(pool.coursePools, code)
  const targetKey = existingKey || courseId
  pool.coursePools[targetKey] = { enabled, genderFilter, selectedTags, matchMode, sameGrade }
  pool.updatedAt = new Date().toISOString()

  return clone(pool)
}

// ==================== 课表变更联动 ====================

function onScheduleChanged(memDb, userId) {
  const user = (memDb.users || []).find((u) => u.id === userId)
  if (!user) return

  const courses = (memDb.schedulesFlat || []).filter((c) => c.userId === userId)
  user.freeTimeBitmap = calculateFreeTimeBitmap(courses)
  user._updated = true
}

function runMatchAction(action, memDb, userId, payload) {
  const data = payload.data || payload
  switch (action) {
    case 'match:getSystemTags':
      return getSystemTags()
    case 'match:updateSelectedTags':
      return updateSelectedTags(memDb, userId, payload.tagIds || data)
    case 'match:getMatchPool':
      return getMatchPool(memDb, userId)
    case 'match:setMatchPool':
      return setMatchPool(memDb, userId, payload.buddyType || payload.type, payload.config || data)
    case 'match:setCoursePool':
      return setCoursePool(memDb, userId, payload.courseId, payload.config || data)
    case 'match:getCourseRecommendations':
      return getCourseRecommendations(memDb, userId, payload.courseId || payload.id)
    case 'match:getRecommendations':
      return getRecommendations(memDb, userId, payload.buddyType || payload.type)
    case 'match:sendInterest':
      return sendInterest(memDb, userId, payload.toUserId || payload.targetUserId, payload.buddyType || payload.type)
    case 'match:getIncomingInterests':
      return getIncomingInterests(memDb, userId)
    case 'match:getSentInterests':
      return getSentInterests(memDb, userId)
    case 'match:acceptInterest':
      return acceptInterest(memDb, userId, payload.requestId || payload.id)
    case 'match:ignoreInterest':
      return ignoreInterest(memDb, userId, payload.requestId || payload.id)
    case 'match:cancelInterest':
      return cancelInterest(memDb, userId, payload.requestId || payload.id)
    case 'match:getMyMatches':
      return getMyMatches(memDb, userId)
    case 'match:unmatch':
      return unmatch(memDb, userId, payload.pairId || payload.id)
    case 'match:blockUser':
      return blockUserInMatch(memDb, userId, payload.userId || payload.targetUserId)
    case 'match:getBlockedUsers':
      return getBlockedUsers(memDb, userId)
    case 'match:unblockUser':
      return unblockUser(memDb, userId, payload.userId || payload.targetUserId)
    default:
      return undefined
  }
}


// ==================== 课程匹配 ====================

function findPoolKey(coursePools, courseCode) {
  if (!coursePools || !courseCode) return null
  const keys = Object.keys(coursePools)
  return keys.find((k) => k.startsWith(courseCode + '_')) || null
}

function getCourseRecommendations(memDb, userId, courseId) {
  const me = (memDb.users || []).find((u) => u.id === userId)
  if (!me) throw new Error('用户不存在')
  const myCoursesArr = (memDb.schedulesFlat || []).filter((c) => c.userId === userId)
  const sel = myCoursesArr.find((c) => ((c.courseCode || '') + '_' + (c.section || '')) === courseId || c.courseId === courseId || c.id === courseId)
  if (!sel) throw new Error('课程不存在')

  const myP = (memDb.matchPool || []).find((p) => p.userId === userId)
  const myCPs = myP && myP.coursePools
  // 用 courseCode 匹配 coursePools 键（忽略 section 差异）
  const poolKey = myCPs && myCPs[courseId] ? courseId : findPoolKey(myCPs, sel.courseCode)
  if (!poolKey) throw new Error('你尚未加入该课程池，请在设置中开启入池匹配')
  const myCP = myCPs[poolKey]
  if (!myCP || !myCP.enabled) throw new Error('你尚未加入该课程池，请在设置中开启入池匹配')

  const mode = myCP.matchMode || 'campus'
  const sameGradeOnly = myCP.sameGrade || false
  const filterTags = (myCP.selectedTags && myCP.selectedTags.length > 0) ? myCP.selectedTags : (me.selectedTags || [])
  const genderFilter = myCP.genderFilter || GENDER_FILTER.ANY
  const myGrade = me.grade || me.degree || ''

  const poolUsers = (memDb.users || []).filter((u) => {
    const up = (memDb.matchPool || []).find((p) => p.userId === u.id)
    return up && up.coursePools
  })
  console.log('[DEBUG getCourseRecs] usersWithCoursePools=', poolUsers.map(u => ({ id: u.id, keys: Object.keys((memDb.matchPool.find(p => p.userId === u.id) || {}).coursePools || {}) })))

  const cands = (memDb.users || []).filter((u) => {
    if (u.id === userId) return false
    if (isBlocked(memDb, userId, u.id)) return false
    if (isAlreadyMatched(memDb, userId, u.id)) return false
    const up = (memDb.matchPool || []).find((p) => p.userId === u.id)
    const uCPs = up && up.coursePools
    const uPoolKey = uCPs && uCPs[poolKey] ? poolKey : findPoolKey(uCPs, sel.courseCode)
    if (!uPoolKey) return false
    const uCP = uCPs[uPoolKey]
    if (!uCP || !uCP.enabled) return false
    if (sameGradeOnly) {
      const ug = u.grade || u.degree || ''
      const mg = me.grade || me.degree || ''
      if (!ug || !mg || ug !== mg) return false
    }
    if (genderFilter !== GENDER_FILTER.ANY) {
      const ug = (u.gender === '男') ? 'male' : (u.gender === '女') ? 'female' : u.gender
      if (ug !== genderFilter) return false
    }
    return true
  })
  console.log('[DEBUG getCourseRecs] totalUsers=', (memDb.users || []).length, 'candidates=', cands.length, 'candIds=', cands.map(u => u.id))
  const targetCode = (sel.courseCode || '').toUpperCase()
  const scored = cands.map((c) => {
    const tc = (memDb.schedulesFlat || []).filter((cc) => cc.userId === c.id)
    const tt = c.selectedTags || []
    const tg = c.grade || c.degree || ''
    const exact = countCommonCourses(myCoursesArr, tc)
    let byCode = 0
    if (mode === 'family') byCode = tc.some((x) => (x.courseCode || '').toUpperCase() === targetCode) ? 1 : 0
    const cc = mode === 'family' ? byCode : exact
    if (cc === 0) return null
    let s = cc * 100 + countCommonTags(filterTags, tt) * 100 + (isSameGrade(myGrade, tg) ? 10 : 0)
    if (mode === 'family' && exact > 0) s += 50
    const comp = computeProfileCompleteness(c, tc.length)
    return { userId: c.id, profile: publicProfile(c, comp), score: s, completeness: comp, lastActiveAt: c.lastActiveAt || '', commonTagCount: countCommonTags(filterTags, tt), commonCourses: cc, sameGrade: isSameGrade(myGrade, tg) }
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.completeness - a.completeness || String(b.lastActiveAt).localeCompare(String(a.lastActiveAt))).slice(0, 20)
  return { recommendations: scored.map((c) => ({ userId: c.userId, profile: c.profile, score: c.score, commonTagCount: c.commonTagCount, sameGrade: c.sameGrade, commonCourses: c.commonCourses })), total: scored.length }
}

module.exports = {
  // 工具
  calculateFreeTimeBitmap,
  countCommonFreeSlots,
  computeProfileCompleteness,
  runMatchAction,
  // 标签
  getSystemTags,
  updateSelectedTags,
  // 入池
  getMatchPool,
  setMatchPool,
  // 匹配
  getRecommendations,
  getCourseRecommendations,
  setCoursePool,
  sendInterest,
  getIncomingInterests,
  getSentInterests,
  acceptInterest,
  ignoreInterest,
  cancelInterest,
  // 管理
  getMyMatches,
  unmatch,
  blockUserInMatch,
  getBlockedUsers,
  unblockUser,
  // 联动
  onScheduleChanged
}
