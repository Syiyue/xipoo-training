const seed = require('./mockData')

const DB_KEY = 'xipoo_mock_db'
const SESSION_KEY = 'xipoo_session'
const DB_VERSION = 12
let idSequence = 0
// 模块级内存缓存：避免每次 API 调用都同步 getStorageSync 解析整个 mock DB
// （云熔断期间所有 API 走 mock，全库同步 parse 是页面切换卡顿的一大来源）
let cachedDb = null

function resetMockDbCache() {
  cachedDb = null
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueId(prefix) {
  idSequence += 1
  return `${prefix}-${Date.now()}-${idSequence}`
}

function getCurrentUserId() {
  const session = wx.getStorageSync(SESSION_KEY)
  return session && session.userId
}

function saveDb(db) {
  cachedDb = db
  wx.setStorageSync(DB_KEY, db)
}

function ensureDb() {
  if (cachedDb) return cachedDb
  const existing = wx.getStorageSync(DB_KEY)
  if (existing && existing.users) {
    let changed = false
    const needsMigration = Number(existing.version || 0) < DB_VERSION

    existing.users = existing.users.map((user, index) => {
      const nextUser = Object.assign({}, user)
      if (!nextUser.phone) {
        nextUser.phone = `1380000000${index + 1}`
        changed = true
      }
      if (!Array.isArray(nextUser.subscriptions)) {
        nextUser.subscriptions = ['chips']
        changed = true
      }
      if (!Array.isArray(nextUser.featureTags)) {
        nextUser.featureTags = []
        changed = true
      }
      if (!nextUser.profileVisibility) {
        nextUser.profileVisibility = { gender: true, degree: true, major: true, school: true, tags: true, bio: true }
        changed = true
      }
      if (!nextUser.profileTheme) {
        nextUser.profileTheme = 'mint'
        changed = true
      }
      return nextUser
    })

    existing.schedules = existing.schedules || {}
    existing.activitySchedules = existing.activitySchedules || {}
    existing.friendships = existing.friendships || []
    existing.friendRequests = existing.friendRequests || []
    existing.buddyOptIns = existing.buddyOptIns || []
    existing.courseTeams = existing.courseTeams || []
    existing.courseTeamApplications = existing.courseTeamApplications || []
    existing.courseTeamMembers = existing.courseTeamMembers || []
    existing.userBlocks = existing.userBlocks || []
    existing.userReports = existing.userReports || []
    existing.riskEvents = existing.riskEvents || []
    existing.scheduleMatches = existing.scheduleMatches || []
    existing.buddyPosts = existing.buddyPosts || []
    existing.buddyApplications = existing.buddyApplications || []
    existing.buddyMembers = existing.buddyMembers || []
    existing.buddyMatchRequests = existing.buddyMatchRequests || []
    existing.buddyLocationTags = existing.buddyLocationTags || clone(seed.buddyLocationTags || [])
    existing.companionAds = existing.companionAds || []
    existing.companionAdEvents = existing.companionAdEvents || []
    existing.reservationActivities = existing.reservationActivities || []
    existing.reservationSlots = existing.reservationSlots || []
    existing.reservationOrders = existing.reservationOrders || []
    existing.activityCategories = existing.activityCategories || clone(seed.activityCategories || [])
    existing.spaceManagers = existing.spaceManagers || []

    if (Number(existing.version || 0) < 10) {
      existing.users.forEach((user) => {
        user.profileVisibility = { gender: true, degree: true, major: true, school: true, tags: true, bio: true }
        const seedUser = seed.users.find((item) => item.id === user.id)
        if (seedUser) {
          ;['gender', 'signature', 'featureTags', 'profileTheme'].forEach((field) => {
            if (!user[field] || (Array.isArray(user[field]) && !user[field].length)) {
              user[field] = clone(seedUser[field])
            }
          })
        }
      })
      changed = true
    }

    seed.users.forEach((seedUser) => {
      const user = existing.users.find((item) => item.id === seedUser.id)
      if (user) {
        ;['degree', 'bio', 'buddyWechatId'].forEach((field) => {
          if (user[field] === undefined && seedUser[field] !== undefined) {
            user[field] = seedUser[field]
            changed = true
          }
        })
      }
    })
    existing.publishers = mergePublishers(existing.publishers || [])
    changed = true
    existing.activities = existing.activities || []
    existing.activityRegistrations = existing.activityRegistrations || {}

    seed.activities.forEach((activity) => {
      const index = existing.activities.findIndex((item) => item.id === activity.id)
      if (index === -1) {
        existing.activities.push(ensureActivityInteraction(clone(activity)))
        changed = true
      } else {
        const merged = Object.assign({}, activity, existing.activities[index], {
          cover: activity.cover,
          coverUrl: activity.coverUrl
        })
        if (!merged.publisherKey) {
          merged.publisherKey = activity.publisherKey
        }
        if (!merged.category) {
          merged.category = activity.category
        }
        existing.activities[index] = ensureActivityInteraction(merged)
        changed = true
      }
    })

    existing.activities = existing.activities.map((activity) => ensureActivityInteraction(activity))

    existing.users.forEach((user) => {
      if (!existing.schedules[user.id]) {
        existing.schedules[user.id] = []
        changed = true
      }
      if (!existing.activitySchedules[user.id]) {
        existing.activitySchedules[user.id] = []
        changed = true
      }
      if (!existing.activityRegistrations[user.id]) {
        existing.activityRegistrations[user.id] = []
        changed = true
      }
    })

    if (needsMigration) {
      Object.keys(seed.schedules || {}).forEach((userId) => {
        const list = existing.schedules[userId] || []
        seed.schedules[userId].forEach((course) => {
          if (!list.some((item) => item.id === course.id)) {
            list.push(clone(course))
            changed = true
          }
        })
        existing.schedules[userId] = list
      })

      ;(seed.buddyOptIns || []).forEach((optIn) => {
        if (!existing.buddyOptIns.some((item) => item.id === optIn.id)) {
          existing.buddyOptIns.push(clone(optIn))
          changed = true
        }
      })

      ;(seed.friendships || []).forEach((friendship) => {
        if (!existing.friendships.some((item) => item.id === friendship.id)) {
          existing.friendships.push(clone(friendship))
          changed = true
        }
      })
    }

    if (existing.version !== DB_VERSION) {
      existing.version = DB_VERSION
      changed = true
    }

    if (changed) saveDb(existing)
    cachedDb = existing
    return existing
  }

  const db = clone(seed)
  db.version = DB_VERSION
  db.buddyMatchRequests = db.buddyMatchRequests || []
  saveDb(db)
  return db
}

function mergePublishers(existingPublishers) {
  const list = Array.isArray(existingPublishers) ? existingPublishers.slice() : []
  seed.publishers.forEach((publisher) => {
    const index = list.findIndex((item) => item.key === publisher.key)
    if (index === -1) {
      list.push(clone(publisher))
    } else {
      list[index] = Object.assign({}, publisher, list[index], {
        name: publisher.name,
        nameZh: publisher.nameZh,
        accent: publisher.accent,
        verified: publisher.verified
      })
    }
  })
  return list
}

function publicUser(user) {
  if (!user) return null
  const copy = Object.assign({}, user)
  delete copy.password
  delete copy.buddyWechatId
  copy.wechatBound = Boolean(copy.openid)
  if (copy.phone) {
    copy.phone = copy.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
  }
  return copy
}

function ownUser(user) {
  const copy = publicUser(user)
  if (copy) {
    copy.buddyWechatId = user.buddyWechatId || ''
    copy.city = user.city || ''
    copy.tags = Array.isArray(user.tags) ? user.tags : []
    copy.showcaseImages = Array.isArray(user.showcaseImages) ? user.showcaseImages : []
    copy.privacySettings = Object.assign({ gender: true, grade: true, major: true, school: true, bio: true, city: true, tags: true, showcase: true }, user.privacySettings || {})
  }
  return copy
}

function currentUserRecord(db) {
  const userId = getCurrentUserId()
  if (!userId) return null
  const session = wx.getStorageSync(SESSION_KEY) || {}
  let user = db.users.find((item) => item.id === userId)
  if (!user) {
    user = {
      id: userId,
      openid: session.openid || '',
      phone: '',
      password: '',
      name: 'Xipoo User',
      school: 'XJTLU',
      age: '',
      degree: '',
      major: 'Not filled',
      avatar: 'X',
      bio: 'Wechat cloud user',
      subscriptions: ['chips'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    db.users.push(user)
    db.schedules[userId] = db.schedules[userId] || []
    db.activitySchedules[userId] = db.activitySchedules[userId] || []
    db.activityRegistrations[userId] = db.activityRegistrations[userId] || []
    saveDb(db)
  }
  return user
}

function currentUserSubscriptions(db) {
  const user = currentUserRecord(db)
  if (!user) return []
  user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : ['chips']
  return user.subscriptions
}

function activityDisplayTitle(activity) {
  return activity.titleZh || activity.title || ''
}

function ensureActivityInteraction(activity) {
  activity.comments = Array.isArray(activity.comments) ? activity.comments : []
  activity.pinned = Boolean(activity.pinned)
  activity.polished = Boolean(activity.polished)
  activity.joined = Boolean(activity.joined)
  activity.liked = Boolean(activity.liked)
  activity.saved = Boolean(activity.saved)
  activity.shareCount = Number(activity.shareCount || 0)
  activity.likeCount = Number(activity.likeCount || 0)
  activity.joinCount = Number(activity.joinCount || 0)
  return activity
}

function minutes(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return hour * 60 + minute
}

function formatTime(total) {
  const hour = Math.floor(total / 60)
  const minute = total % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function freeSlots(courses) {
  const dayStart = 8 * 60
  const dayEnd = 22 * 60
  const busy = courses
    .map((item) => ({ start: minutes(item.start), end: minutes(item.end) }))
    .sort((a, b) => a.start - b.start)

  const slots = []
  let cursor = dayStart
  busy.forEach((item) => {
    if (item.start - cursor >= 45) {
      slots.push({ start: cursor, end: item.start })
    }
    cursor = Math.max(cursor, item.end)
  })
  if (dayEnd - cursor >= 45) {
    slots.push({ start: cursor, end: dayEnd })
  }
  return slots
}

function overlapSlots(aCourses, bCourses) {
  const aSlots = freeSlots(aCourses)
  const bSlots = freeSlots(bCourses)
  const result = []

  aSlots.forEach((a) => {
    bSlots.forEach((b) => {
      const start = Math.max(a.start, b.start)
      const end = Math.min(a.end, b.end)
      if (end - start >= 45) {
        result.push({
          start: formatTime(start),
          end: formatTime(end),
          duration: end - start
        })
      }
    })
  })

  return result
}

function recommendation(slot) {
  if (!slot) {
    return 'No shared block was found in this range. Try a wider time window.'
  }
  const start = minutes(slot.start)
  if (start < 12 * 60) return 'Good for review, lab prep, or a quick campus coffee chat.'
  if (start < 18 * 60) return 'Good for project discussion, salon attendance, or group work.'
  return 'Good for sports, dinner, or a relaxed social activity together.'
}

function login({ phone, password }) {
  const db = ensureDb()
  const user = db.users.find((item) => item.phone === phone && item.password === password)
  if (!user) throw new Error('Invalid phone or password')
  const session = { token: `mock-token-${Date.now()}`, userId: user.id }
  wx.setStorageSync(SESSION_KEY, session)
  return { session, user: ownUser(user) }
}

function register({ phone, password, name, smsCode }) {
  const db = ensureDb()
  if (!/^1\d{10}$/.test(phone)) throw new Error('Please enter a valid 11-digit phone number')
  const smsRecord = wx.getStorageSync(`xipoo_sms_${phone}`)
  if (!smsRecord || smsRecord.code !== smsCode || smsRecord.expiresAt < Date.now()) {
    throw new Error('Invalid SMS code')
  }
  if (db.users.some((item) => item.phone === phone)) throw new Error('This phone number is already registered')

  const usedIds = db.users.map((item) => Number(String(item.id).replace(/^XP/, ''))).filter(Boolean)
  const nextNumericId = Math.max(1000, ...usedIds) + 1
  const userId = `XP${nextNumericId}`
  const user = {
    id: userId,
    phone,
    password,
    name,
    school: 'XJTLU',
    age: '',
    degree: '',
    major: 'Not filled',
    avatar: name ? name.substring(0, 1).toUpperCase() : 'X',
    bio: 'New Xipoo user',
    subscriptions: ['chips']
  }

  db.users.push(user)
  db.schedules[userId] = []
  db.activitySchedules[userId] = []
  db.activityRegistrations[userId] = []
  saveDb(db)
  return login({ phone, password })
}

function normalizeWechatProfile(profile) {
  const nickname = profile && profile.nickName ? profile.nickName : 'Xipoo User'
  return {
    name: nickname,
    avatar: nickname ? nickname.substring(0, 1).toUpperCase() : 'X',
    avatarUrl: profile && profile.avatarUrl ? profile.avatarUrl : ''
  }
}

function wechatLogin(profile) {
  const db = ensureDb()
  let openid = wx.getStorageSync('xipoo_mock_openid')
  if (!openid) {
    openid = `mock-openid-${Date.now()}`
    wx.setStorageSync('xipoo_mock_openid', openid)
  }

  const profileData = normalizeWechatProfile(profile)
  let user = db.users.find((item) => item.openid === openid)
  if (!user) {
    const usedIds = db.users.map((item) => Number(String(item.id).replace(/^XP/, ''))).filter(Boolean)
    const nextNumericId = Math.max(1000, ...usedIds) + 1
    const userId = `XP${nextNumericId}`
    user = {
      id: userId,
      openid,
      unionid: '',
      phone: '',
      password: '',
      name: profileData.name,
      school: 'XJTLU',
      age: '',
      gender: '',
      degree: '',
      major: 'Not filled',
      avatar: profileData.avatar,
      avatarUrl: profileData.avatarUrl,
      bio: 'Wechat cloud user',
      signature: '',
      featureTags: [],
      profileTheme: 'mint',
      profileVisibility: { gender: true, degree: true, major: true, school: true, tags: true, bio: true },
      buddyWechatId: '',
      subscriptions: ['chips'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    }
    db.users.push(user)
    db.schedules[userId] = []
    db.activitySchedules[userId] = []
    db.activityRegistrations[userId] = []
  } else {
    if (profileData.name && (!user.name || user.name === 'Xipoo User')) {
      user.name = profileData.name
      user.avatar = profileData.avatar
      user.avatarUrl = profileData.avatarUrl
    }
    // 为已有用户补全好友系统所需字段
    if (user.gender === undefined) user.gender = ''
    if (user.signature === undefined) user.signature = ''
    if (!user.featureTags) user.featureTags = []
    if (user.profileTheme === undefined) user.profileTheme = 'mint'
    if (user.profileVisibility === undefined) user.profileVisibility = { gender: true, degree: true, major: true, school: true, tags: true, bio: true }
    if (user.buddyWechatId === undefined) user.buddyWechatId = ''
    user.lastLoginAt = new Date().toISOString()
    user.updatedAt = new Date().toISOString()
  }

  const session = { token: `mock-cloud-token-${Date.now()}`, userId: user.id, openid }
  wx.setStorageSync(SESSION_KEY, session)
  saveDb(db)
  return { session, user: ownUser(user) }
}

function sendSmsCode(phone) {
  if (!/^1\d{10}$/.test(phone)) throw new Error('Please enter a valid 11-digit phone number')
  const code = String(Math.floor(100000 + Math.random() * 900000))
  wx.setStorageSync(`xipoo_sms_${phone}`, { code, expiresAt: Date.now() + 5 * 60 * 1000 })
  console.log(`[Xipoo SMS mock] ${phone}: ${code}`)
  return { sent: true, expiresIn: 300, devCode: code }
}

function bindPhone({ phone, smsCode }) {
  const db = ensureDb()
  const user = currentUserRecord(db)
  if (!user) throw new Error('User not found')
  if (!/^1\d{10}$/.test(phone)) throw new Error('Please enter a valid 11-digit phone number')
  const smsRecord = wx.getStorageSync(`xipoo_sms_${phone}`)
  if (!smsRecord || smsRecord.code !== smsCode || smsRecord.expiresAt < Date.now()) {
    throw new Error('Invalid SMS code')
  }
  const occupied = db.users.find((item) => item.id !== user.id && item.phone === phone)
  if (occupied) throw new Error('This phone number is already bound')
  user.phone = phone
  user.updatedAt = new Date().toISOString()
  saveDb(db)
  return ownUser(user)
}

function logout() {
  wx.removeStorageSync(SESSION_KEY)
  return true
}

function me() {
  const db = ensureDb()
  return ownUser(currentUserRecord(db))
}

function updateProfile(profile) {
  const db = ensureDb()
  const user = currentUserRecord(db)
  if (!user) throw new Error('User not found')
  Object.assign(user, {
    // 与云端保持一致：这是局部更新，未提交字段必须原样保留。
    name: profile.name === undefined ? user.name : profile.name,
    age: profile.age === undefined ? (user.age || '') : profile.age,
    degree: profile.degree === undefined ? (user.degree || '') : profile.degree,
    major: profile.major === undefined ? (user.major || '') : profile.major,
    school: profile.school === undefined ? user.school : profile.school,
    gender: profile.gender === undefined ? (user.gender || '') : profile.gender,
    bio: profile.bio === undefined ? (user.bio || '') : profile.bio,
    signature: profile.signature === undefined ? (user.signature || '') : profile.signature,
    avatarUrl: profile.avatarUrl === undefined ? (user.avatarUrl || '') : profile.avatarUrl,
    city: profile.city === undefined ? (user.city || '') : profile.city,
    tags: profile.tags === undefined
      ? (user.tags || [])
      : Array.from(new Set((profile.tags || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 10),
    showcaseImages: profile.showcaseImages === undefined
      ? (user.showcaseImages || [])
      : (Array.isArray(profile.showcaseImages) ? profile.showcaseImages.slice(0, 6) : []),
    featureTags: profile.featureTags === undefined
      ? (user.featureTags || [])
      : Array.from(new Set((profile.featureTags || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 8),
    profileTheme: profile.profileTheme === undefined ? (user.profileTheme || 'mint') : profile.profileTheme,
    profileVisibility: Object.assign(
      { gender: true, degree: true, major: true, school: true, tags: true, bio: true },
      user.profileVisibility || {},
      profile.profileVisibility || {}
    ),
    privacySettings: Object.assign(
      { gender: true, grade: true, major: true, school: true, bio: true, city: true, tags: true, showcase: true },
      user.privacySettings || {},
      profile.privacySettings || {}
    ),
    buddyWechatId: profile.buddyWechatId === undefined
      ? (user.buddyWechatId || '')
      : String(profile.buddyWechatId || '').trim()
  })
  if (user.name) user.avatar = user.name.substring(0, 1).toUpperCase()
  saveDb(db)
  return ownUser(user)
}

function getSchedule(userId) {
  const db = ensureDb()
  return clone(db.schedules[userId || getCurrentUserId()] || [])
}

function getActivitySchedule() {
  const db = ensureDb()
  return clone(db.activitySchedules[getCurrentUserId()] || [])
}

function upsertCourse(course) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const list = db.schedules[userId] || []
  const next = Object.assign({}, course, {
    id: course.id || `manual-${Date.now()}`,
    weekday: Number(course.weekday),
    courseCode: normalizeCourseCode(course.courseCode || course.title),
    term: course.term || '2025-26-S2',
    section: String(course.section || '').trim().toUpperCase(),
    confirmed: course.confirmed !== false
  })
  const index = list.findIndex((item) => item.id === next.id)
  if (index >= 0) list[index] = next
  else list.push(next)
  db.schedules[userId] = list
  saveDb(db)
  return clone(next)
}

function deleteCourse(courseId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const user = db.users.find((item) => item.id === userId)
  const course = findCourse(db, userId, courseId)
  if (user && course) deactivateCourseParticipation(db, userId, courseIdentity(user, course))
  db.schedules[userId] = (db.schedules[userId] || []).filter((item) => item.id !== courseId)
  db.buddyOptIns = db.buddyOptIns.filter((item) => !(item.userId === userId && item.courseId === courseId))
  saveDb(db)
  return true
}

function listAiImportBatches() {
  const courses = getSchedule()
  const batches = new Map()
  courses.forEach((course) => {
    if (course.source !== 'ocr' || !course.importBatchId) return
    const batch = batches.get(course.importBatchId) || {
      id: course.importBatchId,
      importedAt: course.importedAt || '',
      courseCount: 0,
      preview: []
    }
    batch.courseCount += 1
    if (course.importedAt && (!batch.importedAt || course.importedAt < batch.importedAt)) batch.importedAt = course.importedAt
    if (course.title && batch.preview.length < 3) batch.preview.push(course.title)
    batches.set(course.importBatchId, batch)
  })
  return Array.from(batches.values()).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))
}

function deleteAiImportBatch(batchId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const courses = db.schedules[userId] || []
  const kept = courses.filter((course) => course.importBatchId !== batchId)
  const removed = courses.length - kept.length
  db.schedules[userId] = kept
  saveDb(db)
  return { batchId, removed }
}

function clearCourses() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const removed = (db.schedules[userId] || []).length
  db.schedules[userId] = []
  db.buddyOptIns = db.buddyOptIns.filter((item) => item.userId !== userId)
  saveDb(db)
  return { removed }
}

function importScheduleImage() {
  throw new Error('Please start the real backend and configure the AI schedule import API first')
}

// ==================== 日程共享权限模型（mock 侧与 friend 云函数一致） ====================
// share[userId] 表示 userId 授权对方查看自己日程的权限；兼容旧布尔值 true→busy / false→none
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

function filterCourseByPermission(course, permission) {
  if (!course || course.private === true || course.shareable === false) return null
  const base = { id: course.id, date: course.date || '', weekday: course.weekday, start: course.start, end: course.end, busy: true }
  if (permission.level === 'busy') return base
  base.title = course.title || ''
  base.courseCode = course.courseCode || ''
  if (permission.level === 'title') return base
  base.place = permission.showLocation ? (course.place || '') : ''
  base.teacher = course.teacher || ''
  return base
}

function searchUsers(keyword) {
  const db = ensureDb()
  const meId = getCurrentUserId()
  const normalizedId = String(keyword || '').trim().toUpperCase()
  if (!normalizedId) return []
  return db.users
    .filter((item) => item.id !== meId)
    .filter((item) => item.id.toUpperCase() === normalizedId)
    .map((item) => ({
      id: item.id,
      name: item.name,
      avatar: item.avatar,
      avatarUrl: item.avatarUrl || ''
    }))
}

function getFriendships() {
  const db = ensureDb()
  const meId = getCurrentUserId()
  return db.friendships
    .filter((item) => item.users.includes(meId))
    .map((friendship) => {
      const friendId = friendship.users.find((id) => id !== meId)
      const myPermission = shareEntryOf(friendship, meId)
      const friendPermission = shareEntryOf(friendship, friendId)
      return {
        id: friendship.id,
        friend: friendSummary(db.users.find((user) => user.id === friendId)),
        myPermission,
        friendPermission,
        myShare: myPermission.level !== 'none',
        friendShare: friendPermission.level !== 'none',
        mutuallyShared: myPermission.level !== 'none' && friendPermission.level !== 'none'
      }
    })
}

function friendSummary(user) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    avatarUrl: user.avatarUrl || '',
    signature: user.signature || ''
  }
}

function areFriends(db, firstUserId, secondUserId) {
  return db.friendships.some((item) => item.users.includes(firstUserId) && item.users.includes(secondUserId))
}

function getFriendProfile(friendId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  if (!areFriends(db, userId, friendId)) throw new Error('只有互为好友后才能查看主页')
  const friend = db.users.find((item) => item.id === friendId)
  if (!friend) throw new Error('用户不存在')
  const friendship = db.friendships.find((item) => item.users.includes(userId) && item.users.includes(friendId))
  const visibility = Object.assign(
    { gender: true, degree: true, major: true, school: true, tags: true, bio: true },
    friend.profileVisibility || {}
  )
  return {
    id: friend.id,
    name: friend.name,
    avatar: friend.avatar,
    avatarUrl: friend.avatarUrl || '',
    signature: friend.signature || '',
    profileTheme: friend.profileTheme || 'mint',
    coverUrl: friend.coverUrl || '',
    gender: friend.gender || '',
    degree: friend.degree || '',
    major: friend.major || '',
    school: friend.school || '',
    featureTags: clone(friend.featureTags || []),
    bio: friend.bio || '',
    tags: Array.isArray(friend.tags) ? friend.tags : [],
    showcaseImages: Array.isArray(friend.showcaseImages) ? friend.showcaseImages : [],
    visibility,
    myPermission: shareEntryOf(friendship, userId),
    friendPermission: shareEntryOf(friendship, friendId),
    myScheduleShared: shareEntryOf(friendship, userId).level !== 'none',
    friendScheduleShared: shareEntryOf(friendship, friendId).level !== 'none'
  }
}

function getRequests() {
  const db = ensureDb()
  const meId = getCurrentUserId()
  return db.friendRequests
    .filter((item) => item.to === meId && item.status === 'pending')
    .map((request) => Object.assign({}, request, {
      message: request.message || '',
      fromUser: friendSummary(db.users.find((user) => user.id === request.from))
    }))
}

function sendFriendRequest(to, message) {
  const db = ensureDb()
  const meId = getCurrentUserId()
  if (to === meId) throw new Error('You cannot add yourself')
  if (db.friendships.some((item) => item.users.includes(meId) && item.users.includes(to))) {
    throw new Error('You are already friends')
  }
  if (db.friendRequests.some((item) => item.from === meId && item.to === to && item.status === 'pending')) {
    throw new Error('Friend request already sent')
  }
  db.friendRequests.push({
    id: `request-${Date.now()}`,
    from: meId,
    to,
    status: 'pending',
    message: message || ''
  })
  saveDb(db)
  return true
}

function acceptFriendRequest(requestId, grantLevel, range) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const request = db.friendRequests.find((item) => item.id === requestId && item.to === userId)
  if (!request || request.status !== 'pending') throw new Error('共享邀请不存在')
  request.status = 'accepted'
  // 接受方可设置自己授予对方的权限（默认仅忙闲），邀请方默认同样仅忙闲
  const level = PERMISSION_LEVELS.includes(grantLevel) ? grantLevel : 'busy'
  const share = {}
  share[request.to] = Object.assign({}, DEFAULT_PERMISSION, {
    level,
    startDate: range && range.startDate ? String(range.startDate) : '',
    endDate: range && range.endDate ? String(range.endDate) : ''
  })
  share[request.from] = Object.assign({}, DEFAULT_PERMISSION)
  db.friendships.push({
    id: `friendship-${Date.now()}`,
    users: [request.from, request.to],
    share,
    createdAt: new Date().toISOString()
  })
  saveDb(db)
  return true
}

// 微信邀请卡片直达：接受后直接建立联系人关系
function acceptInvite(inviterId, grantLevel) {
  const db = ensureDb()
  const meId = getCurrentUserId()
  if (!inviterId || inviterId === meId) throw new Error('邀请人无效')
  if (areFriends(db, meId, inviterId)) throw new Error('你们已经是日程联系人')
  const level = PERMISSION_LEVELS.includes(grantLevel) ? grantLevel : 'busy'
  const share = {}
  share[meId] = Object.assign({}, DEFAULT_PERMISSION, { level })
  share[inviterId] = Object.assign({}, DEFAULT_PERMISSION)
  db.friendships.push({
    id: `friendship-${Date.now()}`,
    users: [inviterId, meId],
    share,
    sourceType: 'wechat_share',
    createdAt: new Date().toISOString()
  })
  db.friendRequests
    .filter((item) => item.from === inviterId && item.to === meId && item.status === 'pending')
    .forEach((item) => { item.status = 'accepted' })
  saveDb(db)
  return true
}

function rejectFriendRequest(requestId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const request = db.friendRequests.find((item) => item.id === requestId && item.to === userId)
  if (!request || request.status !== 'pending') throw new Error('好友申请不存在')
  request.status = 'rejected'
  request.resolvedAt = new Date().toISOString()
  saveDb(db)
  return true
}

function removeFriend(friendId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const before = db.friendships.length
  db.friendships = db.friendships.filter((item) => !(item.users.includes(userId) && item.users.includes(friendId)))
  if (db.friendships.length === before) throw new Error('好友关系不存在')
  saveDb(db)
  return true
}

function setScheduleSharing(friendId, enabled) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const friendship = db.friendships.find((item) => item.users.includes(userId) && item.users.includes(friendId))
  if (!friendship) throw new Error('联系人关系不存在')
  const current = shareEntryOf(friendship, userId)
  friendship.share[userId] = Object.assign({}, current, { level: enabled ? 'busy' : 'none' })
  saveDb(db)
  return friendship.share[userId].level !== 'none'
}

// 设置“对方可以查看我的内容”：level / showLocation / allowFreeTimeCalc / 日期范围
function setSharePermission(friendId, settings = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const friendship = db.friendships.find((item) => item.users.includes(userId) && item.users.includes(friendId))
  if (!friendship) throw new Error('联系人关系不存在')
  const current = shareEntryOf(friendship, userId)
  const next = {
    level: PERMISSION_LEVELS.includes(settings.level) ? settings.level : current.level,
    showLocation: settings.showLocation === undefined ? current.showLocation : Boolean(settings.showLocation),
    allowFreeTimeCalc: settings.allowFreeTimeCalc === undefined ? current.allowFreeTimeCalc : Boolean(settings.allowFreeTimeCalc),
    startDate: settings.startDate === undefined ? current.startDate : String(settings.startDate || ''),
    endDate: settings.endDate === undefined ? current.endDate : String(settings.endDate || '')
  }
  friendship.share[userId] = next
  saveDb(db)
  return clone(next)
}

function toggleShare(friendId) {
  const db = ensureDb()
  const meId = getCurrentUserId()
  const friendship = db.friendships.find((item) => item.users.includes(meId) && item.users.includes(friendId))
  if (!friendship) throw new Error('Friendship not found')
  const current = shareEntryOf(friendship, meId)
  friendship.share[meId] = Object.assign({}, current, { level: current.level === 'none' ? 'busy' : 'none' })
  saveDb(db)
  return friendship.share[meId].level !== 'none'
}

function getFriendSchedule(friendId) {
  const db = ensureDb()
  const meId = getCurrentUserId()
  const friendship = db.friendships.find((item) => item.users.includes(meId) && item.users.includes(friendId))
  if (!friendship) throw new Error('对方尚未向你开放日程')
  // 联系人关系不等于日程查看权限：必须单独检查对方授权给我的 permission
  const permission = shareEntryOf(friendship, friendId)
  if (permission.level === 'none') throw new Error('对方尚未向你开放日程')
  return clone((db.schedules[friendId] || [])
    .filter((course) => {
      if (permission.startDate && course.date && course.date < permission.startDate) return false
      if (permission.endDate && course.date && course.date > permission.endDate) return false
      return true
    })
    .map((course) => filterCourseByPermission(course, permission))
    .filter(Boolean))
}

function matchWithFriend(friendId, date, range = {}) {
  const mine = getSchedule(getCurrentUserId()).filter((item) => item.date === date)
  const theirs = getFriendSchedule(friendId).filter((item) => item.date === date)
  let slots = overlapSlots(mine, theirs)

  if (range.start && range.end) {
    const rangeStart = minutes(range.start)
    const rangeEnd = minutes(range.end)
    slots = slots
      .map((slot) => {
        const start = Math.max(minutes(slot.start), rangeStart)
        const end = Math.min(minutes(slot.end), rangeEnd)
        return { start: formatTime(start), end: formatTime(end), duration: end - start }
      })
      .filter((slot) => slot.duration >= 15)
  }

  return {
    date,
    range,
    slots,
    recommendation: recommendation(slots[0]),
    myCourses: mine,
    friendCourses: theirs
  }
}

function courseOccursOn(course, date) {
  if (course.date === date) return true
  if (!course.weekday) return false
  const target = new Date(`${date}T00:00:00`)
  const weekday = target.getDay() === 0 ? 7 : target.getDay()
  if (Number(course.weekday) !== weekday) return false
  if (course.termStartDate && date < course.termStartDate) return false
  if (course.termEndDate && date > course.termEndDate) return false
  return true
}

function mergeBusyIntervals(courses, rangeStart, rangeEnd) {
  const intervals = courses
    .map((course) => ({
      start: Math.max(rangeStart, minutes(course.start)),
      end: Math.min(rangeEnd, minutes(course.end))
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  return intervals.reduce((result, interval) => {
    const previous = result[result.length - 1]
    if (!previous || interval.start > previous.end) result.push(interval)
    else previous.end = Math.max(previous.end, interval.end)
    return result
  }, [])
}

function validateGroupParticipants(db, userId, friendIds) {
  const uniqueFriendIds = Array.from(new Set(friendIds || [])).filter(Boolean)
  if (uniqueFriendIds.length > 8) throw new Error('一次最多选择 8 位好友')
  if (uniqueFriendIds.includes(userId)) throw new Error('好友列表中不能包含自己')
  const participantIds = [userId].concat(uniqueFriendIds)
  // 至少有一位参与者（自己），无需额外最低好友数限制
  if (participantIds.length < 1) throw new Error('请至少选择一位参与者')
  for (const friendId of uniqueFriendIds) {
    const friendship = db.friendships.find((item) => item.users.includes(userId) && item.users.includes(friendId))
    if (!friendship) throw new Error('参与者 ' + userId + ' 与 ' + friendId + ' 之间缺少日程联系人关系')
    const firstPerm = shareEntryOf(friendship, userId)
    const secondPerm = shareEntryOf(friendship, friendId)
    if (firstPerm.level === 'none' || secondPerm.level === 'none') throw new Error(userId + ' 与 ' + friendId + ' 需要互相开放日程权限')
    if (!firstPerm.allowFreeTimeCalc || !secondPerm.allowFreeTimeCalc) throw new Error('参与者 ' + (firstPerm.allowFreeTimeCalc ? friendId : userId) + ' 未允许参与共同空闲计算')
  }
  return participantIds
}

function groupFreeSlots(friendIds, startDate, endDate, range = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const participantIds = validateGroupParticipants(db, userId, friendIds)
  if (!startDate || !endDate || startDate > endDate) throw new Error('请选择正确的日期范围')
  const rangeStart = minutes(range.start || '08:00')
  const rangeEnd = minutes(range.end || '22:00')
  if (rangeEnd <= rangeStart) throw new Error('结束时间必须晚于开始时间')

  const participants = participantIds.map((id) => {
    const user = db.users.find((item) => item.id === id)
    return { id, name: user ? user.name : id, avatar: user ? user.avatar : '?' }
  })
  const days = []
  const cursor = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if ((end - cursor) / 86400000 > 92) throw new Error('日期范围最多为 93 天')

  while (cursor <= end) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const conflicts = participantIds.flatMap((id) => {
      const participant = participants.find((item) => item.id === id)
      return (db.schedules[id] || [])
        // 参与者标记为「不去上」的课程不计入忙碌
        .filter((course) => !course.excludedFromFreeTime)
        .filter((course) => courseOccursOn(course, date))
        .filter((course) => minutes(course.end) > rangeStart && minutes(course.start) < rangeEnd)
        .map((course) => ({
          id: `${id}-${course.id}-${date}`,
          userId: id,
          userName: participant.name,
          avatar: participant.avatar,
          courseId: course.id,
          title: course.title,
          start: course.start,
          end: course.end,
          place: course.place || ''
        }))
    })
    const busy = mergeBusyIntervals(conflicts, rangeStart, rangeEnd)
    const free = []
    let pointer = rangeStart
    busy.forEach((interval) => {
      if (interval.start - pointer >= 30) {
        free.push({ start: formatTime(pointer), end: formatTime(interval.start), duration: interval.start - pointer })
      }
      pointer = Math.max(pointer, interval.end)
    })
    if (rangeEnd - pointer >= 30) {
      free.push({ start: formatTime(pointer), end: formatTime(rangeEnd), duration: rangeEnd - pointer })
    }
    const hours = []
    for (let hour = Math.ceil(rangeStart / 60); hour < Math.floor(rangeEnd / 60); hour += 1) {
      const start = hour * 60
      const endMinute = start + 60
      const busyUsers = participantIds.filter((id) => conflicts.some((conflict) => (
        conflict.userId === id &&
        minutes(conflict.end) > start &&
        minutes(conflict.start) < endMinute
      )))
      const state = busyUsers.length === 0
        ? 'available'
        : (busyUsers.length === participantIds.length ? 'busy' : 'partial')
      hours.push({
        label: `${String(hour).padStart(2, '0')}:00`,
        start: formatTime(start),
        end: formatTime(endMinute),
        state,
        busyCount: busyUsers.length,
        conflicts: conflicts.filter((conflict) => minutes(conflict.end) > start && minutes(conflict.start) < endMinute)
      })
    }
    days.push({
      date,
      weekday: ['日', '一', '二', '三', '四', '五', '六'][cursor.getDay()],
      free,
      hours,
      conflicts,
      freeMinutes: free.reduce((sum, slot) => sum + slot.duration, 0)
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return {
    participants,
    startDate,
    endDate,
    range: { start: formatTime(rangeStart), end: formatTime(rangeEnd) },
    days,
    availableDays: days.filter((day) => day.free.length).length
  }
}

function createScheduleMatch(payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const result = groupFreeSlots(
    payload.friendIds,
    payload.startDate,
    payload.endDate,
    payload.range || {}
  )
  const record = {
    id: uniqueId('schedule-match'),
    creatorUserId: userId,
    participantIds: result.participants.map((item) => item.id),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    result
  }
  db.scheduleMatches.push(record)
  saveDb(db)
  return clone(record)
}

function getScheduleMatch(matchId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const record = db.scheduleMatches.find((item) => item.id === matchId)
  if (!record) throw new Error('匹配结果不存在')
  if (new Date(record.expiresAt).getTime() <= Date.now()) throw new Error('匹配结果已过期')
  if (!record.participantIds.includes(userId)) throw new Error('只有参与者可以查看该结果')
  return clone(record)
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
  return [
    identity.school,
    identity.term,
    identity.courseCode,
    identity.weekday,
    identity.start,
    identity.end,
    identity.section || '*'
  ].join('|')
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
  if (course.termEndDate && new Date(`${course.termEndDate}T23:59:59`).getTime() <= Date.now()) {
    throw new Error('该课程或学期已结束')
  }
  const identity = courseIdentity(user, course)
  if (!identity.courseCode) throw new Error('请先补充标准课程代码，例如 CCT007')
  return { user, course, identity }
}

function activeOptIn(db, userId, courseId) {
  return db.buddyOptIns.find((item) => (
    item.userId === userId &&
    item.courseId === courseId &&
    item.enabled
  ))
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
  return db.userBlocks.some((item) => (
    (item.blockerUserId === firstUserId && item.blockedUserId === secondUserId) ||
    (item.blockerUserId === secondUserId && item.blockedUserId === firstUserId)
  ))
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

const SCOPE_DEPTH = {
  campus: 0,
  course_family: 1,
  course_code: 2,
  course_session: 3
}

function courseFamily(courseCode) {
  const match = String(courseCode || '').toUpperCase().match(/^[A-Z]+/)
  return match ? match[0] : ''
}

function buddyScopeKey(scope) {
  const parts = [
    scope.scopeType,
    scope.school,
    scope.term,
    scope.courseFamily || '',
    scope.courseCode || '',
    scope.section || '',
    scope.weekday || '',
    scope.startTime || '',
    scope.endTime || ''
  ]
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
    String(right.term).localeCompare(String(left.term)) ||
    left.depth - right.depth ||
    left.label.localeCompare(right.label)
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
  return {
    scopeVerified: verified,
    verificationReason: verified ? '课表已验证' : '用户自行选择'
  }
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
    const scope = normalizeBuddyScope({
      scopeType: 'campus',
      school: creator && creator.school,
      term: fallbackTerm
    })
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

function getBuddyScopeTerms() {
  const db = ensureDb()
  return Array.from(new Set(buildBuddyScopes(db).map((item) => item.term))).sort().reverse()
}

function getBuddyScopes(term) {
  const db = ensureDb()
  const scopes = buildBuddyScopes(db)
  const selectedTerm = term || (scopes[0] && scopes[0].term)
  return clone(scopes.filter((item) => item.term === selectedTerm))
}

function getBuddyOptIn(scopeKey) {
  const db = ensureDb()
  migrateBuddyScopeRecords(db)
  return clone(db.buddyOptIns.find((item) => (
    item.userId === getCurrentUserId() &&
    item.scopeKey === scopeKey &&
    item.enabled
  )) || null)
}

function setBuddyOptIn(scopeKey, payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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
  if (!optIn) {
    optIn = { id: uniqueId('buddy-optin'), userId, createdAt: now }
    db.buddyOptIns.push(optIn)
  }
  Object.assign(optIn, {
    enabled: true,
    scope,
    scopeKey,
    tags,
    availabilityStart: payload.availabilityStart,
    availabilityEnd: payload.availabilityEnd,
    buddyWechatId: wechat,
    bio: String(payload.bio || user.bio || '').trim(),
    consent: true,
    updatedAt: now
  }, scopeVerification(db, userId, scope))
  user.buddyWechatId = wechat
  saveDb(db)
  return clone(optIn)
}

function removeBuddyOptIn(scopeKey) {
  const db = ensureDb()
  migrateBuddyScopeRecords(db)
  const optIn = db.buddyOptIns.find((item) => item.userId === getCurrentUserId() && item.scopeKey === scopeKey && item.enabled)
  if (optIn) {
    optIn.enabled = false
    optIn.updatedAt = new Date().toISOString()
  }
  db.buddyMatchRequests.forEach((request) => {
    if ((request.fromOptInId === (optIn && optIn.id) || request.toOptInId === (optIn && optIn.id)) && request.status === 'pending') {
      request.status = 'withdrawn'
    }
  })
  saveDb(db)
  return true
}

function acceptedBuddyMatch(db, firstOptInId, secondOptInId) {
  return db.buddyMatchRequests.some((item) => (
    item.status === 'accepted' &&
    ((item.fromOptInId === firstOptInId && item.toOptInId === secondOptInId) ||
      (item.fromOptInId === secondOptInId && item.toOptInId === firstOptInId))
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
    id: user.id,
    optInId: optIn.id,
    avatar: user.avatar || (user.name || 'X').substring(0, 1),
    name: user.name || 'Xipoo User',
    signature: user.signature || '',
    major: user.major || '未填写',
    degree: user.degree || '未填写',
    tags: clone(optIn.tags || []),
    availabilityStart: optIn.availabilityStart,
    availabilityEnd: optIn.availabilityEnd,
    bio: optIn.bio || user.bio || '',
    scope: clone(optIn.scope),
    scopeVerified: Boolean(optIn.scopeVerified),
    verificationReason: optIn.verificationReason || '用户自行选择'
  }
  if (includeWechat) profile.buddyWechatId = optIn.buddyWechatId
  return profile
}

function getBuddyCandidates(scopeKey) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const mine = db.buddyOptIns.find((item) => item.userId === userId && item.scopeKey === scopeKey && item.enabled)
  if (!mine) throw new Error('请先开启该范围的个人匹配')
  return db.buddyOptIns
    .filter((item) => (
      item.enabled &&
      item.userId !== userId &&
      (scopeContains(mine.scope, item.scope) || acceptedBuddyMatch(db, mine.id, item.id))
    ))
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.userId)
      if (!user || isBlocked(db, userId, item.userId)) return null
      const sameScope = mine.scopeKey === item.scopeKey
      const accepted = acceptedBuddyMatch(db, mine.id, item.id)
      const request = db.buddyMatchRequests
        .filter((entry) => (
          ['pending', 'accepted'].includes(entry.status) &&
          ((entry.fromOptInId === mine.id && entry.toOptInId === item.id) ||
            (entry.fromOptInId === item.id && entry.toOptInId === mine.id))
        ))
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

function createBuddyMatchRequest(payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const fromOptIn = db.buddyOptIns.find((item) => item.id === payload.fromOptInId && item.userId === userId && item.enabled)
  const toOptIn = db.buddyOptIns.find((item) => item.id === payload.toOptInId && item.enabled)
  if (!fromOptIn || !toOptIn || !scopeContains(fromOptIn.scope, toOptIn.scope)) throw new Error('匹配对象不存在')
  if (fromOptIn.scopeKey === toOptIn.scopeKey) throw new Error('相同范围已直接开放联系方式')
  if (isBlocked(db, userId, toOptIn.userId)) throw new Error('双方存在屏蔽关系')
  const existing = db.buddyMatchRequests.find((item) => (
    item.fromOptInId === fromOptIn.id && item.toOptInId === toOptIn.id && item.status === 'pending'
  ))
  if (existing) throw new Error('匹配申请已发送')
  const request = {
    id: uniqueId('buddy-match-request'),
    fromUserId: userId,
    toUserId: toOptIn.userId,
    fromOptInId: fromOptIn.id,
    toOptInId: toOptIn.id,
    message: String(payload.message || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  db.buddyMatchRequests.push(request)
  saveDb(db)
  return clone(request)
}

function getBuddyMatchRequests() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  return clone(db.buddyMatchRequests
    .filter((item) => item.toUserId === userId && item.status === 'pending' && !isBlocked(db, userId, item.fromUserId))
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.fromUserId)
      const optIn = db.buddyOptIns.find((entry) => entry.id === item.fromOptInId)
      return Object.assign({}, item, { applicant: scopedBuddyProfile(user, optIn, false) })
    }))
}

function resolveBuddyMatchRequest(requestId, decision) {
  const db = ensureDb()
  const request = db.buddyMatchRequests.find((item) => item.id === requestId)
  if (!request || request.toUserId !== getCurrentUserId() || request.status !== 'pending') throw new Error('匹配申请不存在')
  const fromOptIn = db.buddyOptIns.find((item) => item.id === request.fromOptInId && item.enabled)
  const toOptIn = db.buddyOptIns.find((item) => item.id === request.toOptInId && item.enabled)
  if (!fromOptIn || !toOptIn) throw new Error('匹配范围已关闭')
  request.status = decision
  request.resolvedAt = new Date().toISOString()
  saveDb(db)
  return clone(request)
}

function setCourseBuddyOptIn(courseId, payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const { user, identity } = assertConfirmedCourse(db, userId, courseId)
  const tags = Array.from(new Set((payload.tags || []).map((item) => String(item).trim()).filter(Boolean)))
  const wechat = String(payload.buddyWechatId || '').trim()
  if (!payload.consent) throw new Error('需要同意向同课程匹配池成员公开微信号')
  if (!wechat) throw new Error('请填写用于搭子匹配的微信号')
  if (!tags.length) throw new Error('请至少选择一个需求标签')
  if (minutes(payload.availabilityEnd) <= minutes(payload.availabilityStart)) {
    throw new Error('可约结束时间必须晚于开始时间')
  }
  const now = new Date().toISOString()
  let optIn = db.buddyOptIns.find((item) => item.userId === userId && item.courseId === courseId)
  if (!optIn) {
    optIn = {
      id: uniqueId('buddy-optin'),
      userId,
      courseId,
      createdAt: now
    }
    db.buddyOptIns.push(optIn)
  }
  Object.assign(optIn, {
    enabled: true,
    identity,
    tags,
    availabilityStart: payload.availabilityStart,
    availabilityEnd: payload.availabilityEnd,
    buddyWechatId: wechat,
    bio: String(payload.bio || user.bio || '').trim(),
    consent: true,
    updatedAt: now
  })
  user.buddyWechatId = wechat
  if (optIn.bio) user.bio = optIn.bio
  saveDb(db)
  return clone(optIn)
}

function removeCourseBuddyOptIn(courseId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const { identity } = assertConfirmedCourse(db, userId, courseId)
  const optIn = activeOptIn(db, userId, courseId)
  if (optIn) {
    optIn.enabled = false
    optIn.updatedAt = new Date().toISOString()
  }
  deactivateCourseParticipation(db, userId, identity)
  saveDb(db)
  return true
}

function getCourseBuddyStatus(courseId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  assertConfirmedCourse(db, userId, courseId)
  return clone(activeOptIn(db, userId, courseId) || null)
}

function getCourseBuddyCandidates(courseId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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

function teamMemberCount(db, teamId) {
  return db.courseTeamMembers.filter((item) => item.teamId === teamId && item.status === 'active').length
}

function deactivateCourseParticipation(db, userId, identity) {
  db.courseTeamApplications.forEach((application) => {
    const team = db.courseTeams.find((item) => item.id === application.teamId)
    if (application.userId === userId &&
      application.status === 'pending' &&
      team &&
      sameCourseIdentity(team.identity, identity)) {
      application.status = 'withdrawn'
    }
  })

  db.courseTeamMembers.forEach((membership) => {
    const team = db.courseTeams.find((item) => item.id === membership.teamId)
    if (membership.userId !== userId ||
      membership.status !== 'active' ||
      !team ||
      !sameCourseIdentity(team.identity, identity)) return
    membership.status = 'left'
    membership.leftAt = new Date().toISOString()
    if (team.creatorUserId === userId) {
      const nextMember = db.courseTeamMembers.find((item) => (
        item.teamId === team.id &&
        item.status === 'active'
      ))
      if (nextMember) {
        nextMember.role = 'creator'
        team.creatorUserId = nextMember.userId
      } else {
        team.status = 'cancelled'
      }
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
        id: application.id,
        message: application.message,
        applicant: buddyProfile(
          db.users.find((item) => item.id === application.userId),
          optInForIdentity(db, application.userId, team.identity)
        )
      }))
    : []
  const myApplication = db.courseTeamApplications.find((item) => item.teamId === team.id && item.userId === viewerId)
  return Object.assign({}, clone(team), {
    memberCount: members.length,
    members,
    applications,
    isCreator: team.creatorUserId === viewerId,
    isMember: members.some((member) => member.id === viewerId),
    myApplicationStatus: myApplication ? myApplication.status : ''
  })
}

function createCourseTeam(payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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
    id: uniqueId('course-team'),
    courseId: payload.courseId,
    creatorUserId: userId,
    identity,
    title: String(payload.title).trim(),
    goal: String(payload.goal).trim(),
    tags: clone(payload.tags || []),
    maxMembers,
    deadline: payload.deadline,
    requirements: String(payload.requirements || '').trim(),
    status: 'open',
    createdAt: new Date().toISOString()
  }
  db.courseTeams.push(team)
  db.courseTeamMembers.push({
    id: uniqueId('course-team-member'),
    teamId: team.id,
    userId,
    role: 'creator',
    status: 'active',
    joinedAt: new Date().toISOString()
  })
  saveDb(db)
  return serializeTeam(db, team, userId)
}

function getCourseTeams(courseId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const { identity } = assertActiveOptIn(db, userId, courseId)
  const result = db.courseTeams
    .filter((team) => (
      sameCourseIdentity(team.identity, identity) &&
      team.status !== 'cancelled' &&
      !isBlocked(db, userId, team.creatorUserId)
    ))
    .map((team) => serializeTeam(db, team, userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  saveDb(db)
  return result
}

function getCourseTeam(teamId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const team = db.courseTeams.find((item) => item.id === teamId)
  if (!team) throw new Error('组队申请不存在')
  if (isBlocked(db, userId, team.creatorUserId)) throw new Error('双方存在屏蔽关系')
  const ownCourse = (db.schedules[userId] || []).find((course) => {
    const user = db.users.find((item) => item.id === userId)
    return sameCourseIdentity(courseIdentity(user, course), team.identity)
  })
  if (!ownCourse) throw new Error('仅该课程成员可以查看')
  assertActiveOptIn(db, userId, ownCourse.id)
  const result = serializeTeam(db, team, userId)
  saveDb(db)
  return result
}

function applyCourseTeam(teamId, payload = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const recentApplications = db.courseTeamApplications.filter((item) => (
    item.userId === userId &&
    Date.now() - new Date(item.createdAt).getTime() < 10 * 60 * 1000
  ))
  if (recentApplications.length >= 5) {
    db.riskEvents.push({
      id: uniqueId('risk-event'),
      userId,
      type: 'bulk_course_team_application',
      status: 'open',
      createdAt: new Date().toISOString()
    })
    saveDb(db)
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
  if (db.courseTeamMembers.some((item) => item.teamId === teamId && item.userId === userId && item.status === 'active')) {
    throw new Error('你已经是该小组成员')
  }
  const existing = db.courseTeamApplications.find((item) => item.teamId === teamId && item.userId === userId)
  if (existing && existing.status === 'pending') throw new Error('申请已提交')
  const application = {
    id: uniqueId('course-team-application'),
    teamId,
    userId,
    message: String(payload.message || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  db.courseTeamApplications.push(application)
  saveDb(db)
  return clone(application)
}

function resolveCourseTeamApplication(applicationId, decision) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const application = db.courseTeamApplications.find((item) => item.id === applicationId)
  const team = application && db.courseTeams.find((item) => item.id === application.teamId)
  if (!application || !team) throw new Error('申请不存在')
  if (team.creatorUserId !== userId) throw new Error('仅发起人可以审核申请')
  if (application.status !== 'pending') throw new Error('该申请已处理')
  refreshTeamStatus(db, team)
  if (decision === 'rejected') {
    application.status = 'rejected'
  } else {
    if (team.status !== 'open' || teamMemberCount(db, team.id) >= team.maxMembers) throw new Error('小组已满员或截止')
    const conflictingMember = db.courseTeamMembers.find((member) => {
      const memberTeam = db.courseTeams.find((item) => item.id === member.teamId)
      return member.userId === application.userId &&
        member.status === 'active' &&
        memberTeam &&
        sameCourseIdentity(memberTeam.identity, team.identity)
    })
    if (conflictingMember) throw new Error('该用户已加入本课程其他小组')
    application.status = 'accepted'
    db.courseTeamMembers.push({
      id: uniqueId('course-team-member'),
      teamId: team.id,
      userId: application.userId,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString()
    })
    db.courseTeamApplications.forEach((item) => {
      const otherTeam = db.courseTeams.find((entry) => entry.id === item.teamId)
      if (item.userId === application.userId &&
        item.id !== application.id &&
        item.status === 'pending' &&
        otherTeam &&
        sameCourseIdentity(otherTeam.identity, team.identity)) {
        item.status = 'withdrawn'
      }
    })
    refreshTeamStatus(db, team)
  }
  application.resolvedAt = new Date().toISOString()
  saveDb(db)
  return serializeTeam(db, team, userId)
}

function withdrawCourseTeamApplication(applicationId) {
  const db = ensureDb()
  const application = db.courseTeamApplications.find((item) => item.id === applicationId)
  if (!application || application.userId !== getCurrentUserId()) throw new Error('申请不存在')
  if (application.status !== 'pending') throw new Error('只有待审核申请可以撤回')
  application.status = 'withdrawn'
  saveDb(db)
  return true
}

function deleteCourseTeam(teamId) {
  const db = ensureDb()
  const team = db.courseTeams.find((item) => item.id === teamId)
  if (!team || team.creatorUserId !== getCurrentUserId()) throw new Error('组队申请不存在')
  if (teamMemberCount(db, teamId) > 1) throw new Error('已成组后不能取消，请由成员分别退出')
  team.status = 'cancelled'
  db.courseTeamApplications.forEach((item) => {
    if (item.teamId === teamId && item.status === 'pending') item.status = 'withdrawn'
  })
  saveDb(db)
  return true
}

function leaveCourseTeam(teamId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const team = db.courseTeams.find((item) => item.id === teamId)
  const membership = db.courseTeamMembers.find((item) => item.teamId === teamId && item.userId === userId && item.status === 'active')
  if (!team || !membership) throw new Error('你不是该小组成员')
  membership.status = 'left'
  membership.leftAt = new Date().toISOString()
  if (team.creatorUserId === userId) {
    const nextMember = db.courseTeamMembers.find((item) => item.teamId === teamId && item.status === 'active')
    if (nextMember) {
      nextMember.role = 'creator'
      team.creatorUserId = nextMember.userId
    } else {
      team.status = 'cancelled'
    }
  }
  refreshTeamStatus(db, team)
  saveDb(db)
  return true
}

const BUDDY_TYPE_LIMITS = {
  meal: { label: '饭搭子', min: 2, max: 5 },
  study: { label: '自习搭子', min: 2, max: 5 },
  sport: { label: '运动搭子', min: 2, max: 10 },
  project: { label: '项目搭子', min: 2, max: 8 }
}

function genericBuddyProfile(user, includeWechat) {
  if (!user) return null
  const profile = {
    id: user.id,
    avatar: user.avatar || (user.name || 'X').substring(0, 1),
    name: user.name || 'Xipoo User',
    signature: user.signature || '',
    major: user.major || '',
    degree: user.degree || '',
    featureTags: clone(user.featureTags || []),
    bio: user.bio || ''
  }
  if (includeWechat) profile.buddyWechatId = user.buddyWechatId || ''
  return profile
}

function buddyMemberCount(db, postId) {
  return db.buddyMembers.filter((item) => item.postId === postId && item.status === 'active').length
}

function refreshBuddyPostStatus(db, post) {
  if (post.status === 'cancelled') return
  if (new Date(post.deadline).getTime() <= Date.now() || new Date(post.endAt).getTime() <= Date.now()) {
    post.status = 'expired'
  } else if (buddyMemberCount(db, post.id) >= post.maxMembers) {
    post.status = 'full'
  } else {
    post.status = 'open'
  }
  if (post.status === 'expired') {
    db.buddyApplications.forEach((application) => {
      if (application.postId === post.id && application.status === 'pending') application.status = 'expired'
    })
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
    .map((item) => genericBuddyProfile(
      db.users.find((user) => user.id === item.userId),
      isMember
    ))
    .filter(Boolean)
  const applications = isCreator
    ? db.buddyApplications
      .filter((item) => item.postId === post.id && item.status === 'pending' && !isBlocked(db, viewerId, item.userId))
      .map((item) => ({
        id: item.id,
        message: item.message,
        applicant: genericBuddyProfile(db.users.find((user) => user.id === item.userId), false)
      }))
    : []
  const myApplication = db.buddyApplications.find((item) => item.postId === post.id && item.userId === viewerId)
  const creator = db.users.find((item) => item.id === post.creatorUserId)
  return Object.assign({}, clone(post), {
    typeLabel: BUDDY_TYPE_LIMITS[post.type].label,
    creator: genericBuddyProfile(creator, isMember),
    members,
    memberCount: members.length,
    applications,
    isCreator,
    isMember,
    myApplicationStatus: myApplication ? myApplication.status : '',
    score: genericBuddyScore(db.users.find((item) => item.id === viewerId) || {}, post, creator || {}, selectedScope),
    scopeLabel: post.scope ? post.scope.label : '全西浦',
    scopeVerified: Boolean(post.scopeVerified),
    verificationReason: post.verificationReason || '用户自行选择'
  })
}

function getBuddyCenter() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const scopes = buildBuddyScopes(db)
  const currentUser = db.users.find((item) => item.id === userId)
  const courses = clone(db.schedules[userId] || []).map((course) => {
    const scope = sessionScopeFromCourse(currentUser || {}, course)
    return {
      id: course.id,
      title: course.title,
      courseCode: normalizeCourseCode(course.courseCode || course.title),
      section: course.section || '',
      term: course.term || '',
      weekday: course.weekday,
      start: course.start,
      end: course.end,
      scopeKey: scope.scopeKey,
      confirmed: course.confirmed !== false,
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
      myPosts: myPosts.length,
      myGroups: myMemberships.length,
      pendingApplications: myApplications.length
    }
  }
}

function createBuddyPost(payload) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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
  if (maxMembers < 2 || maxMembers > scopedMax) {
    throw new Error(`${scope.scopeType === 'campus' ? limits.label : '课程范围'}人数必须为 2 至 ${scopedMax} 人`)
  }
  if (!payload.title || !payload.startAt || !payload.endAt || !payload.deadline) throw new Error('请完整填写搭子需求')
  if (!db.buddyLocationTags.includes(payload.locationTag)) throw new Error('请选择校区预设地点')
  if (new Date(payload.startAt).getTime() >= new Date(payload.endAt).getTime()) throw new Error('结束时间必须晚于开始时间')
  if (new Date(payload.deadline).getTime() <= Date.now() || new Date(payload.deadline).getTime() > new Date(payload.startAt).getTime()) {
    throw new Error('申请截止时间必须晚于当前时间且不晚于活动开始')
  }
  const creator = db.users.find((item) => item.id === userId)
  if (!creator || !creator.buddyWechatId) throw new Error('请先在个人资料中填写搭子微信号')
  const post = {
    id: uniqueId('buddy-post'),
    creatorUserId: userId,
    type,
    scope,
    scopeKey: scope.scopeKey,
    title: String(payload.title).trim(),
    maxMembers,
    startAt: payload.startAt,
    endAt: payload.endAt,
    locationTag: payload.locationTag,
    tags: Array.from(new Set((payload.tags || []).map((item) => String(item).trim()).filter(Boolean))).slice(0, 8),
    description: String(payload.description || '').trim(),
    deadline: payload.deadline,
    status: 'open',
    createdAt: new Date().toISOString()
  }
  Object.assign(post, scopeVerification(db, userId, scope))
  db.buddyPosts.push(post)
  db.buddyMembers.push({
    id: uniqueId('buddy-member'),
    postId: post.id,
    userId,
    role: 'creator',
    status: 'active',
    joinedAt: new Date().toISOString()
  })
  saveDb(db)
  return serializeBuddyPost(db, post, userId)
}

function getBuddyPosts(filters = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const selectedScope = filters.scopeKey ? findBuddyScope(db, filters.scopeKey) : null
  const posts = db.buddyPosts
    .filter((post) => post.status !== 'cancelled')
    .filter((post) => !filters.type || post.type === filters.type)
    .filter((post) => !filters.locationTag || post.locationTag === filters.locationTag)
    .filter((post) => !filters.startAt || new Date(post.endAt).getTime() > new Date(filters.startAt).getTime())
    .filter((post) => !filters.endAt || new Date(post.startAt).getTime() < new Date(filters.endAt).getTime())
    .filter((post) => !selectedScope || scopeContains(selectedScope, post.scope))
    .filter((post) => !isBlocked(db, userId, post.creatorUserId))
    .map((post) => serializeBuddyPost(db, post, userId, selectedScope))
    .sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
  saveDb(db)
  return posts
}

function getBuddyPost(postId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post || isBlocked(db, userId, post.creatorUserId)) throw new Error('搭子需求不存在')
  const result = serializeBuddyPost(db, post, userId)
  saveDb(db)
  return result
}

function applyBuddyPost(postId, payload = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  migrateBuddyScopeRecords(db)
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post) throw new Error('搭子需求不存在')
  refreshBuddyPostStatus(db, post)
  if (post.status !== 'open') throw new Error('该需求已满员或截止')
  if (post.creatorUserId === userId) throw new Error('发起人无需申请自己的需求')
  if (isBlocked(db, userId, post.creatorUserId)) throw new Error('双方存在屏蔽关系')
  const user = db.users.find((item) => item.id === userId)
  if (!user || !user.buddyWechatId) throw new Error('请先在个人资料中填写搭子微信号')
  if (db.buddyMembers.some((item) => item.postId === postId && item.userId === userId && item.status === 'active')) {
    throw new Error('你已经是该小组成员')
  }
  const existing = db.buddyApplications.find((item) => item.postId === postId && item.userId === userId && item.status === 'pending')
  if (existing) throw new Error('申请已提交')
  const application = {
    id: uniqueId('buddy-application'),
    postId,
    userId,
    message: String(payload.message || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  db.buddyApplications.push(application)
  saveDb(db)
  return clone(application)
}

function resolveBuddyApplication(applicationId, decision) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const application = db.buddyApplications.find((item) => item.id === applicationId)
  const post = application && db.buddyPosts.find((item) => item.id === application.postId)
  if (!application || !post) throw new Error('申请不存在')
  if (post.creatorUserId !== userId) throw new Error('仅发起人可以审核')
  if (application.status !== 'pending') throw new Error('该申请已处理')
  refreshBuddyPostStatus(db, post)
  if (decision === 'rejected') {
    application.status = 'rejected'
  } else {
    if (post.status !== 'open') throw new Error('该需求已满员或截止')
    application.status = 'accepted'
    db.buddyMembers.push({
      id: uniqueId('buddy-member'),
      postId: post.id,
      userId: application.userId,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString()
    })
    refreshBuddyPostStatus(db, post)
  }
  application.resolvedAt = new Date().toISOString()
  saveDb(db)
  return serializeBuddyPost(db, post, userId)
}

function deleteBuddyPost(postId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const post = db.buddyPosts.find((item) => item.id === postId)
  if (!post || post.creatorUserId !== userId) throw new Error('搭子需求不存在')
  post.status = 'cancelled'
  db.buddyApplications.forEach((item) => {
    if (item.postId === postId && item.status === 'pending') item.status = 'withdrawn'
  })
  saveDb(db)
  return true
}

function leaveBuddyPost(postId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const post = db.buddyPosts.find((item) => item.id === postId)
  const member = db.buddyMembers.find((item) => item.postId === postId && item.userId === userId && item.status === 'active')
  if (!post || !member) throw new Error('你不是该小组成员')
  member.status = 'left'
  member.leftAt = new Date().toISOString()
  if (post.creatorUserId === userId) {
    const next = db.buddyMembers.find((item) => item.postId === postId && item.status === 'active')
    if (next) {
      next.role = 'creator'
      post.creatorUserId = next.userId
    } else {
      post.status = 'cancelled'
    }
  }
  refreshBuddyPostStatus(db, post)
  saveDb(db)
  return true
}

function blockUser(targetUserId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  if (targetUserId === userId) throw new Error('不能屏蔽自己')
  if (!db.userBlocks.some((item) => item.blockerUserId === userId && item.blockedUserId === targetUserId)) {
    db.userBlocks.push({
      id: uniqueId('user-block'),
      blockerUserId: userId,
      blockedUserId: targetUserId,
      createdAt: new Date().toISOString()
    })
  }
  saveDb(db)
  return true
}

function reportUser(targetUserId, payload = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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
  db.riskEvents.push({
    id: uniqueId('risk-event'),
    userId: targetUserId,
    sourceUserId: userId,
    type: 'user_report',
    status: 'open',
    createdAt: new Date().toISOString()
  })
  saveDb(db)
  return true
}

function submitFeedback(payload = {}) {
  const db = ensureDb()
  const userId = getCurrentUserId()
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
  saveDb(db)
  return true
}

// ===== 噗噗推广位（与 companion 云函数 ads/track 行为一致） =====
function getCompanionAds() {
  const db = ensureDb()
  db.companionAds = db.companionAds || []
  const now = new Date().toISOString()
  const ads = (db.companionAds || [])
    .filter((ad) => ad.status === 'active')
    .filter((ad) => (!ad.startAt || ad.startAt <= now) && (!ad.endAt || ad.endAt >= now))
    .map((ad) => ({
      id: ad.id,
      copy: ad.copy,
      copyEn: ad.copyEn || '',
      icon: ad.icon || '🐙',
      imageUrl: ad.imageUrl || '',
      action: ad.action || null,
      sceneTags: Array.isArray(ad.sceneTags) ? ad.sceneTags : [],
      dailyCapPerUser: Number(ad.dailyCapPerUser) || 1
    }))
  return clone({ ads })
}

// 活动点击上报（模块 2）：写明细 + 累计计数
function trackActivityClick(activityId, jumpType) {
  const db = ensureDb()
  if (!activityId) throw new Error('activityId 不能为空')
  db.activityClicks = db.activityClicks || []
  db.activityClicks.push({
    activityId,
    userId: getCurrentUserId() || 'anonymous',
    jumpType: jumpType || '',
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  })
  const activity = (db.activities || []).find((item) => item.id === activityId)
  if (activity) activity.clickCount = Number(activity.clickCount || 0) + 1
  saveDb(db)
  return { tracked: true }
}

function trackCompanionAd(adId, type, scene) {
  const db = ensureDb()
  db.companionAds = db.companionAds || []
  db.companionAdEvents = db.companionAdEvents || []
  if (!adId || !['impression', 'click', 'close'].includes(type)) throw new Error('adId 或事件类型非法')
  db.companionAdEvents.push({
    adId,
    userId: getCurrentUserId() || '',
    type,
    scene: scene || '',
    createdAt: new Date().toISOString()
  })
  if (type !== 'close') {
    const ad = (db.companionAds || []).find((item) => item.id === adId)
    if (ad) {
      ad.stats = ad.stats || { impressions: 0, clicks: 0 }
      if (type === 'impression') ad.stats.impressions += 1
      else ad.stats.clicks += 1
    }
  }
  saveDb(db)
  return clone({ tracked: type })
}

function getActivitySubscriptions() {

  const db = ensureDb()
  const subscriptions = currentUserSubscriptions(db)
  return clone((db.publishers || []).map((publisher) => {
    const publisherActivities = (db.activities || []).filter((item) => item.publisherKey === publisher.key)
    const latestActivity = publisherActivities
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0]
    return Object.assign({}, publisher, {
      subscribed: subscriptions.includes(publisher.key),
      activityCount: publisherActivities.length,
      latestActivityTitle: latestActivity ? activityDisplayTitle(latestActivity) : '',
      latestActivityDate: latestActivity ? latestActivity.date : ''
    })
  }))
}

function getCuratedActivities() {
  const db = ensureDb()
  const flagged = (db.activities || []).filter((item) => item.isHot || item.isRecommended)
  const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''))
  return clone({
    hot: flagged.filter((item) => item.isHot).sort(byDateDesc).slice(0, 5),
    recommended: flagged.filter((item) => item.isRecommended).sort(byDateDesc),
    hotLimit: 5
  })
}

// 活动分类（模块 4）：只返回启用项，按 sort 升序；scope 可选过滤
function getActivityCategories(scope) {
  const db = ensureDb()
  const list = (db.activityCategories || [])
    .filter((item) => item.enabled !== false)
    .filter((item) => !scope || item.scope === scope)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
  return clone({ list })
}

function getActivityPublisher(key) {
  const db = ensureDb()
  const publisher = (db.publishers || []).find((item) => item.key === key)
  if (!publisher) return null
  const userId = getCurrentUserId()
  const subscriptions = currentUserSubscriptions(db)
  const registrations = db.activityRegistrations[userId] || []
  const schedules = db.activitySchedules[userId] || []
  const publisherActivities = (db.activities || [])
    .filter((item) => item.publisherKey === key)
    .map((item) => Object.assign({}, ensureActivityInteraction(item), {
      registered: registrations.some((entry) => entry.activityId === item.id),
      scheduled: schedules.some((entry) => entry.activityId === item.id)
    }))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  return clone({
    publisher: Object.assign({}, publisher, {
      subscribed: subscriptions.includes(key),
      activityCount: publisherActivities.length
    }),
    activities: publisherActivities
  })
}

function getPaiManagers() {
  const db = ensureDb()
  return clone({
    list: (db.spaceManagers || [])
      .filter((manager) => manager.enabled !== false)
      .map((manager) => ({
        id: manager.id,
        displayName: manager.displayName || '',
        avatarUrl: manager.avatarUrl || '',
        bio: manager.bio || '',
        tags: Array.isArray(manager.tags) ? manager.tags : [],
        activities: (db.activities || [])
          .filter((activity) => activity.publisherKey === 'pai_space' && activity.managerId === manager.id)
          .sort((a, b) => `${a.date || ''} ${a.start || ''}`.localeCompare(`${b.date || ''} ${b.start || ''}`))
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
  })
}

function toggleActivitySubscription(key) {
  const db = ensureDb()
  const user = currentUserRecord(db)
  if (!user) throw new Error('User not found')
  user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : ['chips']
  if (user.subscriptions.includes(key)) {
    user.subscriptions = user.subscriptions.filter((item) => item !== key)
  } else {
    user.subscriptions.push(key)
  }
  saveDb(db)
  return getActivitySubscriptions()
}

function subscribeAllActivitySources() {
  const db = ensureDb()
  const user = currentUserRecord(db)
  if (!user) throw new Error('User not found')
  user.subscriptions = (db.publishers || []).map((item) => item.key)
  saveDb(db)
  return getActivitySubscriptions()
}

function resetActivitySubscriptions() {
  const db = ensureDb()
  const user = currentUserRecord(db)
  if (!user) throw new Error('User not found')
  user.subscriptions = ['chips']
  saveDb(db)
  return getActivitySubscriptions()
}

function getActivities() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const subscriptions = currentUserSubscriptions(db)
  const registrations = db.activityRegistrations[userId] || []
  const schedules = db.activitySchedules[userId] || []
  return clone(db.activities
    .filter((item) => subscriptions.includes(item.publisherKey))
    .map((item) => Object.assign({}, ensureActivityInteraction(item), {
      registered: registrations.some((entry) => entry.activityId === item.id),
      scheduled: schedules.some((entry) => entry.activityId === item.id)
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return String(a.date || '').localeCompare(String(b.date || ''))
    }))
}

function getActivity(id) {
  const db = ensureDb()
  const subscriptions = currentUserSubscriptions(db)
  const userId = getCurrentUserId()
  const registrations = db.activityRegistrations[userId] || []
  const activity = db.activities.find((item) => item.id === id)
  if (!activity) return null
  ensureActivityInteraction(activity)
  return clone(Object.assign({}, activity, {
    subscribed: subscriptions.includes(activity.publisherKey),
    registered: registrations.some((item) => item.activityId === id)
  }))
}

function getActivityRegistrations() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  return clone(db.activityRegistrations[userId] || [])
}

function registerActivity(activityId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const activity = db.activities.find((item) => item.id === activityId)
  if (!activity) throw new Error('Activity not found')
  const list = db.activityRegistrations[userId] || []
  if (!list.some((item) => item.activityId === activityId)) {
    list.push({
      id: `registration-${Date.now()}`,
      activityId,
      title: activity.titleZh || activity.title,
      titleEn: activity.title || activity.titleZh,
      date: activity.date || '',
      time: activity.time || '',
      place: activity.placeZh || activity.place || '',
      placeEn: activity.place || activity.placeZh || '',
      publisherKey: activity.publisherKey,
      status: 'registered',
      createdAt: new Date().toISOString()
    })
  }
  db.activityRegistrations[userId] = list
  saveDb(db)
  return clone(list)
}

function cancelActivityRegistration(activityId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  db.activityRegistrations[userId] = (db.activityRegistrations[userId] || []).filter((item) => item.activityId !== activityId)
  saveDb(db)
  return clone(db.activityRegistrations[userId] || [])
}

function addActivityToSchedule(activityId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  const activity = db.activities.find((item) => item.id === activityId)
  if (!activity) throw new Error('Activity not found')
  const list = db.activitySchedules[userId] || []
  if (!list.some((item) => item.activityId === activityId)) {
    list.push({
      id: `activity-schedule-${Date.now()}`,
      activityId,
      title: activity.titleZh || activity.title,
      date: activity.date || '',
      start: activity.start || '',
      end: activity.end || '',
      place: activity.placeZh || activity.place || '',
      tag: activity.scheduleTag || activity.time || ''
    })
  }
  db.activitySchedules[userId] = list
  saveDb(db)
  return clone(list)
}

function toggleActivity(id, field) {
  const db = ensureDb()
  const activity = db.activities.find((item) => item.id === id)
  if (!activity) throw new Error('Activity not found')
  ensureActivityInteraction(activity)
  if (field === 'liked') {
    activity.liked = !activity.liked
    activity.likeCount = Math.max(0, activity.likeCount + (activity.liked ? 1 : -1))
  } else if (field === 'joined') {
    activity.joined = !activity.joined
    activity.joinCount = Math.max(0, activity.joinCount + (activity.joined ? 1 : -1))
  } else if (field === 'shared') {
    activity.shared = true
    activity.shareCount += 1
  } else if (['pinned', 'polished', 'saved'].includes(field)) {
    activity[field] = !activity[field]
  } else {
    activity[field] = !activity[field]
  }
  saveDb(db)
  return clone(activity)
}

function syncCloudFriendships(friends) {
  if (!friends || !friends.length) return
  const session = wx.getStorageSync(SESSION_KEY)
  const myId = session && session.userId
  if (!myId) return
  const db = ensureDb()
  let changed = false
  friends.forEach((f) => {
    const friendId = f.friend && f.friend.id
    if (!friendId || friendId === myId) return
    // 优先使用云端返回的权限对象；旧客户端只有布尔值时退化为布尔（normalize 时 true→busy）
    const myEntry = f.myPermission || Boolean(f.myShare)
    const friendEntry = f.friendPermission || Boolean(f.friendShare)
    const exists = db.friendships.find(
      (item) => item.users.includes(myId) && item.users.includes(friendId)
    )
    if (!exists) {
      db.friendships.push({
        id: f.id || uniqueId('friendship'),
        users: [myId, friendId],
        share: { [myId]: myEntry, [friendId]: friendEntry },
        createdAt: new Date().toISOString()
      })
      changed = true
    } else {
      exists.share[myId] = myEntry
      exists.share[friendId] = friendEntry
      changed = true
    }
  })
  if (changed) saveDb(db)
}

function addActivityComment(id, text) {
  const db = ensureDb()
  const user = currentUserRecord(db)
  const activity = db.activities.find((item) => item.id === id)
  if (!activity) throw new Error('Activity not found')
  activity.comments = activity.comments || []
  activity.comments.push({
    id: `comment-${Date.now()}`,
    userId: user.id,
    name: user.name,
    text,
    createdAt: new Date().toISOString()
  })
  saveDb(db)
  return clone(activity.comments)
}

// ===== 自研预约（模块 3）mock：内存实现，校验逻辑与 cloudfunctions/reservation/lib.js 的 validateOrder 等价 =====

function reservationSlotText(slot) {
  if (!slot) return ''
  return `${slot.date || ''} ${slot.start || ''}-${slot.end || ''}`.trim()
}

function decorateReservationOrder(db, order) {
  const activity = (db.activities || []).find((item) => item.id === order.activityId)
  const slot = (db.reservationSlots || []).find((item) => item.id === order.slotId)
  return Object.assign({}, order, {
    activityTitle: activity ? (activity.titleZh || activity.title || '') : '',
    activityTitleEn: activity ? (activity.title || activity.titleZh || '') : '',
    slotText: reservationSlotText(slot)
  })
}

function getReservationSlots(activityId) {
  const db = ensureDb()
  db.reservationActivities = db.reservationActivities || []
  db.reservationSlots = db.reservationSlots || []
  db.reservationOrders = db.reservationOrders || []
  const activity = (db.activities || []).find((item) => item.id === activityId)
  if (!activity) throw new Error('Activity not found')
  const config = db.reservationActivities.find((item) => item.activityId === activityId) || {}
  const slots = db.reservationSlots
    .filter((item) => item.activityId === activityId && !item.closed)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
  const userId = getCurrentUserId()
  const myOrder = userId
    ? db.reservationOrders.find((item) => item.activityId === activityId && item.userId === userId && item.status === 'booked')
    : null
  return clone({
    activityId,
    title: activity.titleZh || activity.title || '',
    titleEn: activity.title || activity.titleZh || '',
    rules: config.rules || '',
    rulesEn: config.rulesEn || '',
    slots,
    myOrder: myOrder ? Object.assign({}, myOrder, {
      slotText: reservationSlotText(db.reservationSlots.find((item) => item.id === myOrder.slotId))
    }) : null
  })
}

function submitReservation(activityId, slotId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  if (!userId) throw new Error('请先登录')
  db.reservationSlots = db.reservationSlots || []
  db.reservationOrders = db.reservationOrders || []
  const slot = db.reservationSlots.find((item) => item.id === slotId && item.activityId === activityId)
  const existing = db.reservationOrders.filter(
    (item) => item.activityId === activityId && item.userId === userId && item.status === 'booked'
  )
  // 与云端 validateOrder 等价的本地校验（mock 无事务，单线程内存直接判断）
  if (!slot) throw new Error('预约时段不存在')
  if (slot.closed) throw new Error('该时段已停止预约')
  if (existing.length) throw new Error('每人限约一次，您已有未取消的预约')
  if (Number(slot.remaining) <= 0) throw new Error('该时段名额已满')
  slot.remaining = Number(slot.remaining) - 1
  const order = {
    id: uniqueId('reservation-order'),
    activityId,
    slotId,
    userId,
    status: 'booked',
    verifyStatus: 'unused',
    createdAt: new Date().toISOString(),
    cancelledAt: null
  }
  db.reservationOrders.push(order)
  saveDb(db)
  return clone({ order: decorateReservationOrder(db, order), slot })
}

function cancelReservation(orderId) {
  const db = ensureDb()
  const userId = getCurrentUserId()
  if (!userId) throw new Error('请先登录')
  db.reservationOrders = db.reservationOrders || []
  db.reservationSlots = db.reservationSlots || []
  const order = db.reservationOrders.find((item) => item.id === orderId)
  if (!order) throw new Error('预约记录不存在')
  if (order.userId !== userId) throw new Error('只能取消自己的预约')
  if (order.status !== 'booked') throw new Error('该预约已取消')
  order.status = 'cancelled'
  order.cancelledAt = new Date().toISOString()
  const slot = db.reservationSlots.find((item) => item.id === order.slotId)
  if (slot) slot.remaining = Number(slot.remaining || 0) + 1
  saveDb(db)
  return { cancelled: true, orderId }
}

function getMyReservations() {
  const db = ensureDb()
  const userId = getCurrentUserId()
  if (!userId) throw new Error('请先登录')
  db.reservationOrders = db.reservationOrders || []
  const list = db.reservationOrders
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((item) => decorateReservationOrder(db, item))
  return clone({ list })
}

module.exports = {
  login,
  wechatLogin,
  register,
  sendSmsCode,
  bindPhone,
  logout,
  me,
  updateProfile,
  getSchedule,
  getActivitySchedule,
  upsertCourse,
  deleteCourse,
  listAiImportBatches,
  deleteAiImportBatch,
  clearCourses,
  importScheduleImage,
  searchUsers,
  getFriendships,
  getFriendProfile,
  getRequests,
  sendFriendRequest,
  acceptFriendRequest,
  acceptInvite,
  rejectFriendRequest,
  removeFriend,
  setScheduleSharing,
  setSharePermission,
  toggleShare,
  getFriendSchedule,
  matchWithFriend,
  groupFreeSlots,
  createScheduleMatch,
  getScheduleMatch,
  syncCloudFriendships,
  setCourseBuddyOptIn,
  removeCourseBuddyOptIn,
  getCourseBuddyStatus,
  getCourseBuddyCandidates,
  getBuddyScopeTerms,
  getBuddyScopes,
  getBuddyOptIn,
  setBuddyOptIn,
  removeBuddyOptIn,
  getBuddyCandidates,
  createBuddyMatchRequest,
  getBuddyMatchRequests,
  acceptBuddyMatchRequest(requestId) {
    return resolveBuddyMatchRequest(requestId, 'accepted')
  },
  rejectBuddyMatchRequest(requestId) {
    return resolveBuddyMatchRequest(requestId, 'rejected')
  },
  createCourseTeam,
  getCourseTeams,
  getCourseTeam,
  applyCourseTeam,
  acceptCourseTeamApplication(applicationId) {
    return resolveCourseTeamApplication(applicationId, 'accepted')
  },
  rejectCourseTeamApplication(applicationId) {
    return resolveCourseTeamApplication(applicationId, 'rejected')
  },
  withdrawCourseTeamApplication,
  deleteCourseTeam,
  leaveCourseTeam,
  getBuddyCenter,
  createBuddyPost,
  getBuddyPosts,
  getBuddyPost,
  applyBuddyPost,
  acceptBuddyApplication(applicationId) {
    return resolveBuddyApplication(applicationId, 'accepted')
  },
  rejectBuddyApplication(applicationId) {
    return resolveBuddyApplication(applicationId, 'rejected')
  },
  deleteBuddyPost,
  leaveBuddyPost,
  blockUser,
  reportUser,
  submitFeedback,
  getActivities,
  getActivity,
  getActivitySubscriptions,
  getCuratedActivities,
  getCompanionAds,
  trackCompanionAd,
  trackActivityClick,
  getActivityPublisher,
  getPaiManagers,
  toggleActivitySubscription,
  subscribeAllActivitySources,
  resetActivitySubscriptions,
  getActivityRegistrations,
  registerActivity,
  cancelActivityRegistration,
  addActivityToSchedule,
  toggleActivity,
  addActivityComment,
  getReservationSlots,
  submitReservation,
  cancelReservation,
  getMyReservations,
  getActivityCategories,
  resetMockDbCache
}
