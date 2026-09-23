const assert = require('assert')

const storage = new Map()
const events = []
let definition

global.Component = (value) => { definition = value }
global.wx = {
  getSystemInfoSync() {
    return { windowWidth: 375, windowHeight: 667, statusBarHeight: 24 }
  },
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  pageScrollTo(options) { if (options.success) options.success() },
  showModal(options) { options.success({ confirm: true }) },
  createSelectorQuery() {
    return {
      select() { return this },
      boundingClientRect(callback) { callback(null); return this },
      exec() {}
    }
  }
}

require('../components/intro-guide/intro-guide')

const guide = Object.assign({}, definition.methods, {
  properties: {
    lang: 'zh',
    storageKey: 'introGuideScheduleDone',
    steps: []
  },
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(update) { Object.assign(this.data, update) },
  triggerEvent(name) { events.push(name) }
})

guide.showHoleAndBubble({ top: 120, left: 300, width: 48, height: 44 })
assert.ok(guide.data.bubbleLeft >= 10)
assert.ok(guide.data.bubbleLeft + 280 <= 375)
assert.match(guide.data.bubbleArrowLeft, /^\d+rpx$/)

guide.onMaskTap()
assert.strictEqual(storage.get('introGuideScheduleDone'), true)
// 全局完成标记只在所有分页引导都完成后才写入
assert.strictEqual(storage.get('introGuideFinished'), undefined)
assert.deepStrictEqual(events, ['exit'])

storage.set('introGuideActivitiesDone', true)
storage.set('introGuideFriendsDone', true)
guide.markFinished()
assert.strictEqual(storage.get('introGuideFinished'), true)

console.log('intro-guide.test.js: all assertions passed')
