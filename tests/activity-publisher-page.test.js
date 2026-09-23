const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  setNavigationBarTitle() {},
  showToast() {},
  showModal() {},
  navigateTo() {}
}
global.getApp = () => ({ requireLogin: () => true, getLanguage: () => 'zh' })

let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
require('../packages/activity/pages/activityPublisher/activityPublisher')

const mock = require('../utils/mockBackend')
mock.login({ phone: '13800000001', password: '123456' })

const page = Object.assign({}, pageDefinition, {
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(updates, callback) {
    Object.keys(updates).forEach((key) => {
      if (!key.includes('.')) {
        this.data[key] = updates[key]
        return
      }
      const parts = key.split('.')
      let target = this.data
      parts.slice(0, -1).forEach((part) => {
        target[part] = target[part] || {}
        target = target[part]
      })
      target[parts[parts.length - 1]] = updates[key]
    })
    if (callback) callback()
  }
})

async function run() {
  page.onLoad({ key: 'chips' })
  await page.loadProfile()
  assert.strictEqual(page.data.loading, false)
  assert.strictEqual(page.data.publisher.key, 'chips')
  assert.strictEqual(page.data.calendarCells.length, 42)
  assert.ok(page.data.publisher.stats.length === 3)
  assert.ok(page.data.activities.length > 0)
  assert.ok(page.data.activities.every((item) => item.publisherKey === 'chips'))
  assert.ok(page.data.selectedDateActivities.length > 0, '默认月份应聚焦到有活动的日期')
  console.log('activity-publisher-page.test.js: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
