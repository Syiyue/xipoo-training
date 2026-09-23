const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}

const { isCompanionEnabled, setCompanionEnabled, ENABLED_KEY } = require('../utils/companionSettings')

function run() {
  // 默认开启（storage 无记录）
  assert.strictEqual(isCompanionEnabled(), true, 'companion is enabled by default')

  // 关闭后持久化
  setCompanionEnabled(false)
  assert.strictEqual(storage.get(ENABLED_KEY), 0, 'disabled state persisted')
  assert.strictEqual(isCompanionEnabled(), false, 'disabled state reads back')

  // 重新开启
  setCompanionEnabled(true)
  assert.strictEqual(isCompanionEnabled(), true, 're-enable works')

  // storage 读取异常时安全默认为开启
  const original = wx.getStorageSync
  wx.getStorageSync = () => { throw new Error('storage broken') }
  assert.strictEqual(isCompanionEnabled(), true, 'storage failure falls back to enabled')
  wx.getStorageSync = original

  console.log('companion-settings.test.js: all assertions passed')
}

run()
