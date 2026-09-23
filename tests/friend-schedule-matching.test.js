const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  },
  removeStorageSync(key) {
    storage.delete(key)
  }
}

const backend = require('../utils/mockBackend')

function login(phone) {
  return backend.login({ phone, password: '123456' })
}

function setSession(userId) {
  storage.set('xipoo_session', { token: `test-${userId}`, userId })
}

function run() {
  login('13800000001')

  assert.strictEqual(backend.searchUsers('XP1002').length, 1, 'exact Xipoo ID finds the user')
  assert.strictEqual(backend.searchUsers('XP10').length, 0, 'partial IDs do not return users')
  assert.strictEqual(backend.searchUsers('Luoting').length, 0, 'names are not searchable')

  let profile = backend.getFriendProfile('XP1002')
  assert.strictEqual(profile.signature.length > 0, true, 'signature is always visible to friends')
  // 可选资料字段按 visibility 标志控制展示：种子用户默认隐藏 major
  assert.strictEqual(profile.visibility.major, false, 'seed user hides major by default')

  login('13800000002')
  backend.updateProfile({
    profileVisibility: { major: true }
  })
  login('13800000001')
  profile = backend.getFriendProfile('XP1002')
  assert.strictEqual(profile.visibility.major, true, 'enabled profile fields are visible to friends')

  const preview = backend.groupFreeSlots(
    ['XP1002', 'XP1003'],
    '2026-07-01',
    '2026-07-31',
    { start: '08:00', end: '22:00' }
  )
  assert.strictEqual(preview.participants.length, 3, 'creator and two friends participate')
  const july7 = preview.days.find((day) => day.date === '2026-07-07')
  assert(july7.conflicts.length >= 3, 'weekly courses expand into July with participant details')
  const threePm = july7.hours.find((hour) => hour.label === '15:00')
  assert.strictEqual(threePm.state, 'busy', 'hour is fully busy when every participant has class')
  assert(threePm.conflicts.every((item) => item.title && item.userName), 'conflicts include user and course detail')
  assert(july7.free.every((slot) => slot.duration >= 30), 'all returned free slots are at least 30 minutes')

  // 排除「不去上的课程」后不再占用共同空闲
  const dbForExclusion = storage.get('xipoo_mock_db')
  threePm.conflicts.forEach((conflict) => {
    const course = (dbForExclusion.schedules[conflict.userId] || []).find((item) => item.id === conflict.courseId)
    assert(course, 'conflict course exists in the schedule store')
    course.excludedFromFreeTime = true
  })
  storage.set('xipoo_mock_db', dbForExclusion)
  const previewExcluded = backend.groupFreeSlots(
    ['XP1002', 'XP1003'],
    '2026-07-01',
    '2026-07-31',
    { start: '08:00', end: '22:00' }
  )
  const july7Excluded = previewExcluded.days.find((day) => day.date === '2026-07-07')
  const threePmExcluded = july7Excluded.hours.find((hour) => hour.label === '15:00')
  assert.strictEqual(threePmExcluded.state, 'available', 'excluded courses no longer block the hour')
  assert.strictEqual(threePmExcluded.conflicts.length, 0, 'excluded courses disappear from conflicts')
  assert(
    july7Excluded.free.some((slot) => slot.start <= '15:00' && slot.end >= '16:00'),
    'free slots cover the previously busy hour'
  )
  threePm.conflicts.forEach((conflict) => {
    const course = (dbForExclusion.schedules[conflict.userId] || []).find((item) => item.id === conflict.courseId)
    course.excludedFromFreeTime = false
  })
  storage.set('xipoo_mock_db', dbForExclusion)

  const db = storage.get('xipoo_mock_db')
  // 新规则：只校验「我 ↔ 每位好友」，好友之间无需互为日程联系人
  const pairIndex = db.friendships.findIndex((item) => item.users.includes('XP1002') && item.users.includes('XP1003'))
  const pair = db.friendships.splice(pairIndex, 1)[0]
  storage.set('xipoo_mock_db', db)
  const previewNoPair = backend.groupFreeSlots(['XP1002', 'XP1003'], '2026-07-01', '2026-07-02', {})
  assert.strictEqual(previewNoPair.participants.length, 3, 'friends need not be mutual contacts')
  db.friendships.push(pair)
  storage.set('xipoo_mock_db', db)

  // 但我与每位好友之间必须互相开放日程
  const myPair = db.friendships.find((item) => item.users.includes('XP1001') && item.users.includes('XP1002'))
  myPair.share.XP1002 = false
  storage.set('xipoo_mock_db', db)
  assert.throws(
    () => backend.groupFreeSlots(['XP1002', 'XP1003'], '2026-07-01', '2026-07-02', {}),
    /开放/,
    'initiator and each friend must share schedules in both directions'
  )
  myPair.share.XP1002 = true
  storage.set('xipoo_mock_db', db)

  const record = backend.createScheduleMatch({
    friendIds: ['XP1002', 'XP1003'],
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    range: { start: '08:00', end: '22:00' }
  })
  assert(record.expiresAt > record.createdAt, 'saved results receive an expiry date')

  login('13800000003')
  assert.strictEqual(backend.getScheduleMatch(record.id).id, record.id, 'participants can open shared results')
  setSession('XP9999')
  assert.throws(
    () => backend.getScheduleMatch(record.id),
    /参与者/,
    'non-participants cannot open shared results'
  )

  console.log('friend-schedule-matching.test.js: all assertions passed')
}

run()
