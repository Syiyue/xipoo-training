const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const backend = require('../utils/mockBackend')
backend.login({ phone: '13800000001', password: '123456' })
backend.updateProfile({ major: '微电子', degree: '大二', signature: '保持不变' })
backend.updateProfile({ avatarUrl: 'cloud://avatars/new-avatar.jpg' })

const profile = backend.me()
assert.strictEqual(profile.avatarUrl, 'cloud://avatars/new-avatar.jpg')
assert.strictEqual(profile.major, '微电子')
assert.strictEqual(profile.degree, '大二')
assert.strictEqual(profile.signature, '保持不变')

console.log('profile-partial-update.test.js: all assertions passed')
