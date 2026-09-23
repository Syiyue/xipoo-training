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

function create(type, maxMembers, title, locationTag = '图书馆') {
  return backend.createBuddyPost({
    type,
    title,
    maxMembers,
    startAt: '2099-07-01T12:00:00+08:00',
    endAt: '2099-07-01T14:00:00+08:00',
    locationTag,
    tags: ['安静', '固定搭子'],
    description: 'Test buddy post',
    deadline: '2099-07-01T10:00:00+08:00'
  })
}

function run() {
  login('13800000001')

  assert.throws(() => create('meal', 6, 'meal invalid'), /2 至 5/, 'meal maximum is 5')
  assert.throws(() => create('study', 6, 'study invalid'), /2 至 5/, 'study maximum is 5')
  assert.throws(() => create('sport', 11, 'sport invalid'), /2 至 10/, 'sport maximum is 10')
  assert.throws(() => create('project', 9, 'project invalid'), /2 至 8/, 'project maximum is 8')

  const meal = create('meal', 5, 'Lunch together', '中央食堂')
  create('study', 5, 'Library study')
  create('sport', 10, 'Badminton', '体育馆')
  create('project', 8, 'Competition project', '创新工场')

  const filtered = backend.getBuddyPosts({ type: 'meal', locationTag: '中央食堂' })
  assert.strictEqual(filtered.length, 1, 'type and location are hard filters')

  login('13800000002')
  let detail = backend.getBuddyPost(meal.id)
  assert.strictEqual(detail.creator.buddyWechatId, undefined, 'candidate cannot see creator WeChat before acceptance')
  backend.applyBuddyPost(meal.id, { message: 'Join lunch' })
  detail = backend.getBuddyPost(meal.id)
  assert.strictEqual(detail.myApplicationStatus, 'pending', 'application waits for creator review')

  login('13800000001')
  detail = backend.getBuddyPost(meal.id)
  assert.strictEqual(detail.applications[0].applicant.buddyWechatId, undefined, 'creator cannot see applicant WeChat before acceptance')
  backend.acceptBuddyApplication(detail.applications[0].id)

  login('13800000002')
  detail = backend.getBuddyPost(meal.id)
  assert.strictEqual(detail.isMember, true, 'accepted applicant becomes a member')
  assert(detail.members.every((member) => member.buddyWechatId), 'members can see group WeChat IDs after acceptance')

  backend.blockUser('XP1001')
  assert(!backend.getBuddyPosts().some((post) => post.id === meal.id), 'blocked creator posts are hidden')

  console.log('generic-buddy.test.js: all assertions passed')
}

run()
