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

const mock = require('../utils/mockBackend')

function login(phone) {
  mock.login({ phone, password: '123456' })
}

login('13800000001')
mock.resetActivitySubscriptions()

let subscriptions = mock.getActivitySubscriptions()
assert.strictEqual(subscriptions.find((item) => item.key === 'chips').subscribed, true)
assert.strictEqual(subscriptions.find((item) => item.key === 'xec').subscribed, false)
assert.ok(mock.getActivities().every((item) => item.publisherKey === 'chips'))

mock.toggleActivitySubscription('xec')
subscriptions = mock.getActivitySubscriptions()
assert.strictEqual(subscriptions.find((item) => item.key === 'xec').subscribed, true)
assert.ok(mock.getActivities().some((item) => item.id === 'activity-sports-night'))

const activityId = 'activity-sports-night'
mock.registerActivity(activityId)
mock.addActivityToSchedule(activityId)
mock.toggleActivity(activityId, 'liked')

let activity = mock.getActivities().find((item) => item.id === activityId)
assert.strictEqual(activity.registered, true)
assert.strictEqual(activity.scheduled, true)
assert.strictEqual(activity.liked, true)

mock.cancelActivityRegistration(activityId)
activity = mock.getActivities().find((item) => item.id === activityId)
assert.strictEqual(activity.registered, false)
assert.strictEqual(activity.scheduled, true)

mock.toggleActivitySubscription('xec')
assert.ok(!mock.getActivities().some((item) => item.id === activityId))

const xecProfile = mock.getActivityPublisher('xec')
assert.strictEqual(xecProfile.publisher.key, 'xec')
assert.strictEqual(xecProfile.publisher.subscribed, false)
assert.ok(xecProfile.activities.some((item) => item.id === activityId), '门面应展示该活动方全部活动，不受当前用户订阅状态影响')

const chipsProfile = mock.getActivityPublisher('chips')
assert.ok(chipsProfile.publisher.coverUrl)
assert.ok(chipsProfile.publisher.taglineZh)
assert.ok(chipsProfile.activities.every((item) => item.publisherKey === 'chips'))

console.log('activity-subscriptions.test.js: all assertions passed')
