// 日程共享权限模型回归测试
// 场景：none/busy/title/detail 四级权限、旧布尔值迁移为 busy、地点默认关闭、
//       私密日程过滤、共同空闲计算的 allowFreeTimeCalc 校验、邀请接受默认 busy
const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const backend = require('../utils/mockBackend')

function login(phone) {
  return backend.login({ phone, password: '123456' })
}

function run() {
  // ---- 1. 旧布尔 share=true 迁移为 busy：只返回忙闲，不含课程名称/地点 ----
  login('13800000001')
  const friendships = backend.getFriendships()
  assert(friendships.length >= 2, 'seed friendships loaded')
  const withXP1002 = friendships.find((item) => item.friend.id === 'XP1002')
  assert.strictEqual(withXP1002.friendPermission.level, 'busy', 'legacy boolean true migrates to busy')
  assert.strictEqual(withXP1002.myPermission.level, 'busy', 'my legacy share migrates to busy')
  assert.strictEqual(withXP1002.friendShare, true, 'legacy boolean view kept for compat')

  const busySchedule = backend.getFriendSchedule('XP1002')
  assert(busySchedule.length > 0, 'busy level still returns schedule entries')
  assert(busySchedule.every((c) => c.title === undefined), 'busy level strips course titles')
  assert(busySchedule.every((c) => c.place === undefined), 'busy level strips places')
  assert(busySchedule.every((c) => c.start && c.end && c.busy === true), 'busy level keeps time range and busy flag')

  // ---- 2. 对方升级为 title：返回课程名称和时间，不含地点 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'title' })
  login('13800000001')
  const titleSchedule = backend.getFriendSchedule('XP1002')
  assert(titleSchedule.every((c) => typeof c.title === 'string'), 'title level returns course titles')
  assert(titleSchedule.every((c) => c.place === undefined), 'title level strips places')

  // ---- 3. detail 默认不含地点，showLocation 开启后返回地点 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'detail' })
  login('13800000001')
  const detailNoLoc = backend.getFriendSchedule('XP1002')
  assert(detailNoLoc.every((c) => c.place === ''), 'detail level hides places when showLocation=false')
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'detail', showLocation: true })
  login('13800000001')
  const detailWithLoc = backend.getFriendSchedule('XP1002')
  assert(detailWithLoc.some((c) => c.place && c.place.length > 0), 'detail + showLocation returns places')

  // ---- 4. 私密日程任何级别都不返回 ----
  const db = storage.get('xipoo_mock_db')
  db.schedules.XP1002.push({
    id: 'course-xp1002-private', title: 'Private Appointment', date: '2026-06-20',
    start: '20:00', end: '21:00', place: 'Somewhere', private: true
  })
  storage.set('xipoo_mock_db', db)
  const afterPrivate = backend.getFriendSchedule('XP1002')
  assert(!afterPrivate.some((c) => c.id === 'course-xp1002-private'), 'private courses are never shared')
  db.schedules.XP1002 = db.schedules.XP1002.filter((c) => c.id !== 'course-xp1002-private')
  storage.set('xipoo_mock_db', db)

  // ---- 5. none：拒绝访问 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'none' })
  login('13800000001')
  assert.throws(() => backend.getFriendSchedule('XP1002'), /开放/, 'none level denies schedule access')
  const profile = backend.getFriendProfile('XP1002')
  assert.strictEqual(profile.friendPermission.level, 'none', 'profile exposes friendPermission none')
  assert.strictEqual(profile.friendScheduleShared, false, 'legacy boolean false for none')

  // ---- 6. 共同空闲计算：互相开放（非 none）即可，无需完整日程 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'busy' })
  login('13800000001')
  const preview = backend.groupFreeSlots(['XP1002'], '2026-07-01', '2026-07-02', { start: '08:00', end: '22:00' })
  assert.strictEqual(preview.participants.length, 2, 'busy level is enough for free time calculation')

  // ---- 7. allowFreeTimeCalc=false 拒绝参与计算 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'busy', allowFreeTimeCalc: false })
  login('13800000001')
  assert.throws(
    () => backend.groupFreeSlots(['XP1002'], '2026-07-01', '2026-07-02', {}),
    /共同空闲/,
    'allowFreeTimeCalc=false blocks free time calculation'
  )
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'busy', allowFreeTimeCalc: true })

  // ---- 8. 共享邀请：接受后默认 busy，双方都不是完整日程 ----
  // 种子数据中 XP1001 与 XP1003 已是联系人，先临时移除该关系再测试邀请流
  const db8 = storage.get('xipoo_mock_db')
  const idx13 = db8.friendships.findIndex((item) => item.users.includes('XP1001') && item.users.includes('XP1003'))
  const removed13 = db8.friendships.splice(idx13, 1)[0]
  storage.set('xipoo_mock_db', db8)
  login('13800000003')
  backend.sendFriendRequest('XP1001', '一起算空闲时间')
  login('13800000001')
  const requests = backend.getRequests()
  const req = requests.find((item) => item.from === 'XP1003')
  assert(req, 'invitation received')
  backend.acceptFriendRequest(req.id)
  const newFriendship = backend.getFriendships().find((item) => item.friend.id === 'XP1003')
  assert.strictEqual(newFriendship.myPermission.level, 'busy', 'accepter grants busy by default')
  assert.strictEqual(newFriendship.friendPermission.level, 'busy', 'inviter defaults to busy, not full schedule')
  const grantedSchedule = backend.getFriendSchedule('XP1003')
  assert(grantedSchedule.every((c) => c.title === undefined), 'new contact shares busy status only')

  // ---- 9. 微信邀请直达 acceptInvite：指定授予等级 ----
  const db9 = storage.get('xipoo_mock_db')
  const idx12 = db9.friendships.findIndex((item) => item.users.includes('XP1001') && item.users.includes('XP1002'))
  const removed12 = db9.friendships.splice(idx12, 1)[0]
  storage.set('xipoo_mock_db', db9)
  login('13800000002')
  backend.acceptInvite('XP1001', 'title')
  const viaInvite = backend.getFriendProfile('XP1001')
  assert.strictEqual(viaInvite.myPermission.level, 'title', 'acceptInvite honors chosen grant level')

  // ---- 10. 共享有效期过滤 ----
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'detail', showLocation: true, startDate: '2026-06-16', endDate: '2026-06-16' })
  login('13800000001')
  const ranged = backend.getFriendSchedule('XP1002')
  assert(ranged.length > 0 && ranged.every((c) => !c.date || (c.date >= '2026-06-16' && c.date <= '2026-06-16')), 'share date range filters courses outside the window')
  login('13800000002')
  backend.setSharePermission('XP1001', { level: 'busy', showLocation: false, startDate: '', endDate: '' })

  console.log('schedule-share-permission.test.js: all assertions passed')
}

run()
