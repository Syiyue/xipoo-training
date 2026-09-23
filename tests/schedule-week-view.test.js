const assert = require('assert')

const storage = new Map([
  ['semesterStartDate', '2026-09-07'],
  ['totalWeeks', 20],
  ['weekStart', '周一']
])
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}
global.getApp = () => ({ requireLogin: () => true, getLanguage: () => 'zh' })

let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
require('../pages/schedule/schedule')

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
  },
  loadData() { return Promise.resolve() }
})

page.data.selectedDate = '2026-09-07'
page.onShow()
assert.strictEqual(page.data.currentWeek, 1)
assert.strictEqual(page.data.currentMonthText, '9月')
assert.deepStrictEqual(page.data.dateHeaders, [7, 8, 9, 10, 11, 12, 13])
// 设计规范：已登录用户首次打开时，周视图自动对齐到 09:00
assert.strictEqual(page.data.weekScrollTarget, 'week-hour-09')
assert.strictEqual(page.data.timeSlots[9].label, '09:00')
assert.strictEqual(page.data.timeSlots[9].scrollId, 'week-hour-09')

const introSteps = page.buildIntroSteps('zh')
assert.strictEqual(introSteps[2].selector, '.ai-companion-entry', '第三步挖洞高亮小章鱼（ai-companion 标签上的 class）')
assert.ok(introSteps[2].text.includes('AI'))

page.selectWeek({ currentTarget: { dataset: { week: 2 } } })
assert.strictEqual(page.data.selectedDate, '2026-09-14')
assert.strictEqual(page.data.currentMonthText, '9月')
assert.deepStrictEqual(page.data.dateHeaders, [14, 15, 16, 17, 18, 19, 20])

console.log('schedule-week-view.test.js: all assertions passed')
