const assert = require('assert')

const { PAI_SPACE_KEY, filterByCategoryKey, categoryDisplayName } = require('../utils/activityCategories')

// mock 环境（与 tests/activity-jump.test.js 相同风格）
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}
const backend = require('../utils/mockBackend')

function run() {
  // ===== mock 分类种子：scope 过滤 + sort 排序 =====
  const all = backend.getActivityCategories()
  assert.strictEqual(all.list.length, 7, 'all enabled categories returned')

  const paispace = backend.getActivityCategories('paispace')
  assert.strictEqual(paispace.list.length, 5, 'paispace scope has 5 seeds')
  assert.deepStrictEqual(
    paispace.list.map((c) => c.key),
    ['taiji', 'boardgame', 'startup', 'salon', 'venue'],
    'paispace categories sorted by sort asc'
  )

  const global = backend.getActivityCategories('global')
  assert.strictEqual(global.list.length, 2, 'global scope has 2 seeds')
  assert(global.list.every((c) => c.scope === 'global'), 'scope filter works')

  // 停用的分类不下发
  const db = storage.get('xipoo_mock_db')
  db.activityCategories.find((c) => c.key === 'venue').enabled = false
  const afterDisable = backend.getActivityCategories('paispace')
  assert.strictEqual(afterDisable.list.length, 4, 'disabled category hidden')
  db.activityCategories.find((c) => c.key === 'venue').enabled = true

  // ===== filterByCategoryKey（paiSpace 页的过滤纯函数） =====
  backend.login({ phone: '13800000001', password: '123456' })
  const profile = backend.getActivityPublisher(PAI_SPACE_KEY)
  assert(profile && Array.isArray(profile.activities), 'publisher profile returns activities')
  assert(profile.activities.length >= 2, 'mock has at least 2 pai_space activities')

  const boardgame = filterByCategoryKey(profile.activities, 'boardgame')
  assert.strictEqual(boardgame.length, 1, 'boardgame filter hits exactly one activity')
  assert.strictEqual(boardgame[0].id, 'activity-paispace-boardgame-night', 'correct activity matched')
  assert.strictEqual(
    filterByCategoryKey(profile.activities, '').length,
    profile.activities.length,
    'empty key returns all'
  )
  assert.strictEqual(filterByCategoryKey(profile.activities, 'taiji').length, 0, 'no-match category is empty')
  assert.strictEqual(filterByCategoryKey(null, 'x').length, 0, 'null list safe')

  // ===== categoryDisplayName 双语 =====
  const taiji = paispace.list[0]
  assert.strictEqual(categoryDisplayName(taiji, 'zh'), '太极拳', 'zh name')
  assert.strictEqual(categoryDisplayName(taiji, 'en'), 'Tai Chi', 'en name')
  assert.strictEqual(categoryDisplayName({ key: 'x', nameZh: '', nameEn: '' }, 'zh'), 'x', 'fallback to key')

  console.log('paispace-categories.test.js: all assertions passed')
}

run()
