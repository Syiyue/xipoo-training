const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const backend = require('../utils/mockBackend')
const { ambientLine, AMBIENT } = require('../utils/companionLines')

function run() {
  // ===== 接受邀请时配置共享时间范围 =====
  backend.login({ phone: '13800000001', password: '123456' })
  // 种子数据里三人已互为好友，先拆掉 XP1001-XP1002 / XP1001-XP1003 的关系再测接受流程
  const db0 = storage.get('xipoo_mock_db')
  db0.friendships = db0.friendships.filter((item) => !(
    item.users.includes('XP1001') && (item.users.includes('XP1002') || item.users.includes('XP1003'))
  ))
  storage.set('xipoo_mock_db', db0)

  backend.sendFriendRequest('XP1002')

  backend.login({ phone: '13800000002', password: '123456' })
  const requests = backend.getRequests()
  const req = requests.find((item) => item.fromUser && item.fromUser.id === 'XP1001')
  assert(req, 'request received')

  backend.acceptFriendRequest(req.id, 'detail', { startDate: '2026-09-01', endDate: '2026-12-31' })
  const friendships = backend.getFriendships()
  const rel = friendships.find((item) => item.friend.id === 'XP1001')
  assert(rel, 'friendship created')
  assert.strictEqual(rel.myPermission.level, 'detail', 'grant level stored')
  assert.strictEqual(rel.myPermission.startDate, '2026-09-01', 'share range start stored')
  assert.strictEqual(rel.myPermission.endDate, '2026-12-31', 'share range end stored')

  // 不带范围的旧调用保持兼容
  backend.login({ phone: '13800000001', password: '123456' })
  backend.sendFriendRequest('XP1003')
  backend.login({ phone: '13800000003', password: '123456' })
  const req2 = backend.getRequests().find((item) => item.fromUser && item.fromUser.id === 'XP1001')
  backend.acceptFriendRequest(req2.id, 'busy')
  const rel2 = backend.getFriendships().find((item) => item.friend.id === 'XP1001')
  assert.strictEqual(rel2.myPermission.startDate, '', 'no range by default')

  // ===== 环境气泡文案 =====
  ;['zh', 'en'].forEach((lang) => {
    [8, 13, 20].forEach((hour) => {
      const line = ambientLine(hour, lang)
      assert(line && line.length > 0 && line.length < 60, `ambient line for ${lang}@${hour}`)
    })
  })
  assert(AMBIENT.morning.zh.includes(ambientLine(9, 'zh')), 'morning pool used')
  assert(AMBIENT.afternoon.zh.includes(ambientLine(13, 'zh')), 'afternoon pool used')
  assert(AMBIENT.evening.zh.includes(ambientLine(20, 'zh')), 'evening pool used')

  console.log('share-range-ambient.test.js: all assertions passed')
}

run()
