const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const { buildSuggestions } = require('../utils/companionAdvisor')
const backend = require('../utils/mockBackend')

function at(dateTime) {
  return new Date(dateTime)
}

function course(overrides) {
  return Object.assign({
    id: 'c1', title: 'DTS101 Lecture', courseCode: 'DTS101', courseId: 'DTS101_A',
    weekday: 1, start: '10:00', end: '12:00', place: 'TC-D-201'
  }, overrides)
}

function ad(overrides) {
  return Object.assign({
    id: 'ad-1',
    copy: '图书馆咖啡第二杯半价，今天下午就能用～',
    copyEn: 'Second coffee half price at the library cafe!',
    icon: '☕',
    sceneTags: [],
    action: null,
    dailyCapPerUser: 1
  }, overrides)
}

function context(overrides) {
  return Object.assign({
    courses: [], friendships: [], subscriptions: [], activities: [],
    sharedCourses: [], ads: [], adBlocklist: [], lang: 'zh', seed: 'test'
  }, overrides)
}

function run() {
  // ===== advisor：通用卡片只进面板，场景命中才可弹气泡 =====
  // 2026-08-10 周一 13:00：10-12 点与 15-17 点两节课 → 处于 free-gap 场景
  const courses = [
    course({ id: 'morning', start: '10:00', end: '12:00' }),
    course({ id: 'afternoon', title: 'INF102', start: '15:00', end: '17:00' })
  ]
  let suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'ad-generic' }), ad({ id: 'ad-gap', sceneTags: ['free-gap'] })]
  }), at('2026-08-10T13:00:00'))
  const generic = suggestions.find((item) => item.adId === 'ad-generic')
  const gapAd = suggestions.find((item) => item.adId === 'ad-gap')
  assert(generic && generic.isPromotion, 'generic ad injected')
  assert.strictEqual(generic.proactive, false, 'generic ad never bubbles')
  assert.strictEqual(gapAd.proactive, true, 'scene-matched ad may bubble')
  assert.strictEqual(gapAd.scene, 'free-gap', 'matched scene recorded')
  assert.strictEqual(gapAd.type, 'promotion')
  assert(gapAd.priority < suggestions.find((item) => item.type === 'free-gap').priority, 'ads rank below organic suggestions')
  assert.strictEqual(gapAd.cooldownHours, 24, 'ad has 24h cooldown')

  // 非命中场景：free-gap 卡片在上课时间也不弹
  suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'ad-gap', sceneTags: ['free-gap'] })]
  }), at('2026-08-10T10:30:00'))
  const inClassAd = suggestions.find((item) => item.adId === 'ad-gap')
  assert(inClassAd && inClassAd.proactive === false, 'scene-miss ad stays in panel only')

  // 黑名单过滤
  suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'ad-blocked' })],
    adBlocklist: ['ad-blocked']
  }), at('2026-08-10T13:00:00'))
  assert(!suggestions.find((item) => item.adId === 'ad-blocked'), 'blocked ad never appears')

  // 英文环境用 copyEn
  suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'ad-en' })],
    lang: 'en'
  }), at('2026-08-10T13:00:00'))
  assert.strictEqual(
    suggestions.find((item) => item.adId === 'ad-en').text,
    'Second coffee half price at the library cafe!',
    'en locale uses copyEn'
  )

  // 午餐时段场景
  suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'ad-lunch', sceneTags: ['lunch'] })]
  }), at('2026-08-10T12:30:00'))
  assert.strictEqual(suggestions.find((item) => item.adId === 'ad-lunch').proactive, true, 'lunch scene matches at noon')

  // 最多注入 2 张
  suggestions = buildSuggestions(context({
    courses,
    ads: [ad({ id: 'a1' }), ad({ id: 'a2' }), ad({ id: 'a3' })]
  }), at('2026-08-10T13:00:00'))
  assert.strictEqual(suggestions.filter((item) => item.isPromotion).length, 2, 'at most 2 ads injected')

  // ===== mockBackend：下发过滤与埋点计数 =====
  backend.login({ phone: '13800000001', password: '123456' })
  const db = storage.get('xipoo_mock_db')
  db.companionAds = [
    ad({ id: 'ad-on', status: 'active' }),
    ad({ id: 'ad-draft', status: 'draft' }),
    ad({ id: 'ad-expired', status: 'active', endAt: '2020-01-01T00:00:00.000Z' }),
    ad({ id: 'ad-future', status: 'active', startAt: '2999-01-01T00:00:00.000Z' })
  ]
  storage.set('xipoo_mock_db', db)

  const { ads } = backend.getCompanionAds()
  assert.deepStrictEqual(ads.map((item) => item.id), ['ad-on'], 'only active in-window ads are served')
  assert(!ads[0].stats, 'served ads do not leak internal stats')

  backend.trackCompanionAd('ad-on', 'impression', 'free-gap')
  backend.trackCompanionAd('ad-on', 'impression', '')
  backend.trackCompanionAd('ad-on', 'click', '')
  backend.trackCompanionAd('ad-on', 'close', '')
  const db2 = storage.get('xipoo_mock_db')
  const tracked = db2.companionAds.find((item) => item.id === 'ad-on')
  assert.strictEqual(tracked.stats.impressions, 2, 'impressions counted')
  assert.strictEqual(tracked.stats.clicks, 1, 'clicks counted')
  assert.strictEqual(db2.companionAdEvents.length, 4, 'all events recorded including close')
  assert.strictEqual(db2.companionAdEvents[0].userId, 'XP1001', 'event carries xipooId')
  assert.throws(() => backend.trackCompanionAd('ad-on', 'view', ''), /非法/, 'invalid event type rejected')

  console.log('companion-ads.test.js: all assertions passed')
}

run()
