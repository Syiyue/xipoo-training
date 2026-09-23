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
  backend.login({ phone, password: '123456' })
}

function enable(scope, wechat, tags = ['项目组队', '复习']) {
  return backend.setBuddyOptIn(scope.scopeKey, {
    buddyWechatId: wechat,
    tags,
    availabilityStart: '15:00',
    availabilityEnd: '18:00',
    bio: 'multi-scope buddy profile',
    consent: true
  })
}

function scope(scopes, type, value) {
  return scopes.find((item) => (
    item.scopeType === type &&
    (!value || item.courseFamily === value || item.courseCode === value || item.section === value)
  ))
}

login('13800000001')
const scopes = backend.getBuddyScopes('2025-26-S2')
const entFamily = scope(scopes, 'course_family', 'ENT')
const ent103 = scope(scopes, 'course_code', 'ENT103')
const ent104 = scope(scopes, 'course_code', 'ENT104')
const ent103Session2 = scopes.find((item) => item.scopeType === 'course_session' && item.courseCode === 'ENT103' && item.section === 'SESSION 2')
const ent103Session1 = scopes.find((item) => item.scopeType === 'course_session' && item.courseCode === 'ENT103' && item.section === 'SESSION 1')

assert(entFamily && ent103 && ent104 && ent103Session1 && ent103Session2, 'scope catalog contains ENT hierarchy')
const familyOptIn = enable(entFamily, 'sien_ent')
assert.strictEqual(familyOptIn.scopeVerified, true, 'ENT learner is verified for ENT family')

login('13800000002')
const codeOptIn = enable(ent103, 'luoting_ent103')
assert.strictEqual(codeOptIn.scopeVerified, true, 'ENT103 learner is verified for course scope')

login('13800000003')
const unverifiedCodeOptIn = enable(ent103, 'jingyi_ent103')
assert.strictEqual(unverifiedCodeOptIn.scopeVerified, false, 'user may freely select an unverified course scope')

login('13800000001')
let candidates = backend.getBuddyCandidates(entFamily.scopeKey)
assert.deepStrictEqual(
  candidates.map((item) => item.profile.id).sort(),
  ['XP1002', 'XP1003'],
  'ENT parent scope discovers ENT103 child users'
)
assert(candidates.every((item) => !item.contactVisible), 'parent-to-child contacts require acceptance')
assert(
  candidates.find((item) => item.profile.id === 'XP1002').score >
  candidates.find((item) => item.profile.id === 'XP1003').score,
  'verified candidate receives ranking priority'
)

const requestTarget = candidates.find((item) => item.profile.id === 'XP1002')
backend.createBuddyMatchRequest({
  fromOptInId: familyOptIn.id,
  toOptInId: requestTarget.profile.optInId,
  message: 'ENT project buddy'
})

login('13800000002')
const incoming = backend.getBuddyMatchRequests()
assert.strictEqual(incoming.length, 1, 'child-scope user receives parent request')
backend.acceptBuddyMatchRequest(incoming[0].id)

login('13800000001')
candidates = backend.getBuddyCandidates(entFamily.scopeKey)
assert(candidates.find((item) => item.profile.id === 'XP1002').profile.buddyWechatId, 'accepted request opens WeChat')

login('13800000002')
enable(ent103Session1, 'luoting_session1')
login('13800000001')
enable(ent103Session2, 'sien_session2')
candidates = backend.getBuddyCandidates(ent103Session2.scopeKey)
assert(!candidates.some((item) => item.profile.scope.scopeKey === ent103Session1.scopeKey), 'different sessions do not mix')

assert.throws(() => backend.createBuddyPost({
  type: 'sport',
  scopeKey: ent103.scopeKey,
  title: 'ENT sports team',
  maxMembers: 6,
  startAt: '2099-07-01T12:00:00+08:00',
  endAt: '2099-07-01T14:00:00+08:00',
  locationTag: '体育馆',
  tags: ['运动'],
  deadline: '2099-07-01T10:00:00+08:00'
}), /2 至 5/, 'course scopes cap all teams at five')

const db = storage.get('xipoo_mock_db')
db.schedules.XP1001.push(Object.assign({}, db.schedules.XP1001.find((item) => item.courseCode === 'ENT103'), {
  id: 'course-xp1001-ent103-old-term',
  term: '2024-25-S2'
}))
storage.set('xipoo_mock_db', db)
assert(backend.getBuddyScopes('2024-25-S2').some((item) => item.courseCode === 'ENT103'), 'historical terms can be selected')
assert.notStrictEqual(
  backend.getBuddyScopes('2024-25-S2').find((item) => item.courseCode === 'ENT103').scopeKey,
  ent103.scopeKey,
  'same course is isolated by term'
)

console.log('multi-scope-buddy.test.js: all assertions passed')
