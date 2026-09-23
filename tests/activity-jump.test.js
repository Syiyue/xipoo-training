const assert = require('assert')

const { isJumpActivity, buildJumpTarget } = require('../utils/activityJump')

// mock 环境（trackActivityClick 落库验证）
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}
const backend = require('../utils/mockBackend')

function run() {
  // ===== isJumpActivity =====
  assert(!isJumpActivity(null), 'null is not a jump activity')
  assert(!isJumpActivity({ jumpType: 'none' }), 'none stays in-app')
  assert(!isJumpActivity({ jumpType: 'quickReservation' }), 'missing appId/path is not jumpable')
  assert(isJumpActivity({
    jumpType: 'registrationTool',
    targetShortLink: '#小程序://报名工具/diQKBEbq9vjI7To'
  }), 'registration tool short link is jumpable')
  assert(isJumpActivity({
    jumpType: 'quickReservation',
    targetShortLink: '#小程序://快预约/exampleActivity'
  }), 'quick reservation short link is jumpable')
  assert(isJumpActivity({
    jumpType: 'quickReservation',
    targetAppId: 'wx1234567890abcdef',
    targetPath: 'pages/detail/detail'
  }), 'full config is jumpable')
  assert(isJumpActivity({
    jumpType: 'otherMiniProgram',
    targetAppId: 'wx1234567890abcdef',
    targetPath: 'pages/index/index'
  }), 'otherMiniProgram is jumpable')

  // ===== buildJumpTarget =====
  const base = {
    jumpType: 'quickReservation',
    targetAppId: 'wx1234567890abcdef',
    targetPath: 'pages/detail/detail'
  }
  assert.strictEqual(buildJumpTarget(null), null, 'no target for non-jump activity')
  assert.strictEqual(buildJumpTarget({ jumpType: 'none', targetAppId: 'wx1', targetPath: 'p' }), null, 'none never builds a target')

  let target = buildJumpTarget({
    jumpType: 'registrationTool',
    targetShortLink: '  #小程序://报名工具/diQKBEbq9vjI7To  '
  })
  assert.deepStrictEqual(target, { shortLink: '#小程序://报名工具/diQKBEbq9vjI7To' }, 'short link is trimmed')

  target = buildJumpTarget(Object.assign({}, base, {
    targetShortLink: '#小程序://快预约/exampleActivity'
  }))
  assert.deepStrictEqual(target, { shortLink: '#小程序://快预约/exampleActivity' }, 'short link takes priority over appId/path')

  target = buildJumpTarget(base)
  assert.strictEqual(target.appId, 'wx1234567890abcdef')
  assert.strictEqual(target.path, 'pages/detail/detail')
  assert.strictEqual(target.extraData, undefined, 'no params means no extraData')

  // JSON 参数 → extraData
  target = buildJumpTarget(Object.assign({}, base, { activityParams: '{"activityId":"123"}' }))
  assert.deepStrictEqual(target.extraData, { activityId: '123' }, 'JSON params become extraData')
  assert.strictEqual(target.path, 'pages/detail/detail', 'JSON params do not touch path')

  // query 串参数 → 拼到 path
  target = buildJumpTarget(Object.assign({}, base, { activityParams: 'activityId=123&source=xipoo' }))
  assert.strictEqual(target.path, 'pages/detail/detail?activityId=123&source=xipoo', 'query string appended with ?')
  target = buildJumpTarget(Object.assign({}, base, {
    targetPath: 'pages/detail/detail?from=home',
    activityParams: 'activityId=123'
  }))
  assert.strictEqual(target.path, 'pages/detail/detail?from=home&activityId=123', 'query string appended with & when path has query')

  // ===== mock 点击上报 =====
  backend.login({ phone: '13800000001', password: '123456' })
  backend.trackActivityClick('act-1', 'quickReservation')
  backend.trackActivityClick('act-1', 'quickReservation')
  backend.trackActivityClick('act-2', '')
  const db = storage.get('xipoo_mock_db')
  const clicks = (db.activityClicks || []).filter((c) => c.activityId === 'act-1')
  assert.strictEqual(clicks.length, 2, 'two clicks recorded for act-1')
  assert.strictEqual(clicks[0].jumpType, 'quickReservation', 'jumpType stored')
  assert(clicks[0].date && clicks[0].createdAt, 'date fields stored for range filter')

  console.log('activity-jump.test.js: all assertions passed')
}

run()
