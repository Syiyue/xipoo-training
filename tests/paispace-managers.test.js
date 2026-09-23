const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}
const backend = require('../utils/mockBackend')

backend.login({ phone: '13800000001', password: '123456' })
const db = storage.get('xipoo_mock_db')
db.spaceManagers = [{
  id: 'manager-1',
  username: 'private-login',
  password: 'private-password',
  displayName: '林主理人',
  bio: '关注青年社群与公共空间',
  tags: ['策展', '社群'],
  enabled: true
}]
const paiActivities = db.activities.filter((item) => item.publisherKey === 'pai_space')
assert(paiActivities.length >= 2, 'mock has pai space activities')
paiActivities[0].managerId = 'manager-1'
paiActivities[1].managerId = 'manager-1'

const managers = backend.getPaiManagers().list
assert.strictEqual(managers.length, 1, 'enabled manager is public')
assert.strictEqual(managers[0].displayName, '林主理人')
assert.strictEqual(managers[0].activities.length, 2, 'manager activities are linked')
assert(!Object.prototype.hasOwnProperty.call(managers[0], 'username'), 'public manager excludes username')
assert(!Object.prototype.hasOwnProperty.call(managers[0], 'password'), 'public manager excludes password')
assert.deepStrictEqual(
  managers[0].activities.map((item) => item.date),
  managers[0].activities.map((item) => item.date).slice().sort(),
  'manager activities are automatically sorted by date'
)

const admin = fs.readFileSync(path.join(root, 'admin', 'web', 'index.html'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions', 'activity', 'index.js'), 'utf8')
const paiSpace = fs.readFileSync(path.join(root, 'packages', 'activity', 'pages', 'paiSpace', 'paiSpace.wxml'), 'utf8')
const activitiesPage = fs.readFileSync(path.join(root, 'pages', 'activities', 'activities.js'), 'utf8')
const publisherPage = fs.readFileSync(path.join(root, 'packages', 'activity', 'pages', 'activityPublisher', 'activityPublisher.js'), 'utf8')
assert(admin.includes('type="hidden" id="actTargetAppId"'), 'legacy appId is hidden')
assert(admin.includes('type="hidden" id="actTargetPath"'), 'legacy target path is hidden')
assert(admin.includes('type="hidden" id="actActivityParams"'), 'legacy activity params are hidden')
assert(admin.includes('id="mgrActivityChoices"'), 'admin manager window binds activities')
assert(cloud.includes("case 'listPaiManagers'"), 'public manager action is dispatched')
assert(paiSpace.includes('bindtap="showActivities"'), 'activity count is interactive')
assert(paiSpace.includes('bindtap="toggleManagers"'), 'manager count is interactive')
assert(paiSpace.includes('bindtap="showContentTypes"'), 'content type count is interactive')
assert(activitiesPage.includes("key === 'pai_space'"), 'pai space cards use the dedicated profile')
assert(publisherPage.includes("redirectTo({ url: '/packages/activity/pages/paiSpace/paiSpace'"), 'legacy pai publisher URLs redirect to the dedicated profile')

console.log('paispace-managers.test.js: all assertions passed')
