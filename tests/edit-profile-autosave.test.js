const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  showToast() {},
  showLoading() {},
  hideLoading() {}
}

const app = { globalData: {} }
global.getApp = () => app
let definition
global.Page = (value) => { definition = value }

const api = require('../utils/api')
const originalUpdateProfile = api.updateProfile
api.updateProfile = async (changes) => Object.assign({ id: 'u-1' }, changes)
require('../packages/account/pages/editProfile/editProfile')

const page = Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(update) {
    Object.keys(update).forEach((key) => {
      if (!key.includes('.')) {
        this.data[key] = update[key]
        return
      }
      const parts = key.split('.')
      let target = this.data
      parts.slice(0, -1).forEach((part) => {
        target[part] = target[part] || {}
        target = target[part]
      })
      target[parts[parts.length - 1]] = update[key]
    })
  }
})

page.data.user = { id: 'u-1', name: 'Willson', major: '微电子', tags: [] }
page.data.originalUser = { id: 'u-1', name: 'Willson', major: '', tags: [] }
const editingUser = page.data.user

async function run() {
  await page.autoSaveProfile()
  assert.strictEqual(page.data.user, editingUser)
  assert.strictEqual(page.data.user.major, '微电子')
  assert.strictEqual(page.data.originalUser.major, '微电子')

  page.onAvatarUpdated({ detail: { avatarUrl: 'cloud://avatars/new-avatar.jpg' } })
  assert.strictEqual(page.data.user.major, '微电子')
  assert.strictEqual(page.data.user.avatarUrl, 'cloud://avatars/new-avatar.jpg')
  assert.strictEqual(page.data.originalUser.major, '微电子')
  console.log('edit-profile-autosave.test.js: all assertions passed')
}

run().finally(() => { api.updateProfile = originalUpdateProfile })
