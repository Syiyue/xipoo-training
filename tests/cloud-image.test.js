const assert = require('assert')
const { resolveCloudImage } = require('../packages/activity/common/cloudImage')
const { resolveCloudImage: resolvePageCloudImage } = require('../utils/cloudImage')

async function run() {
  delete global.wx

  const localRecord = { coverUrl: '/images/activity.png' }
  assert.strictEqual(await resolveCloudImage(localRecord, 'coverUrl'), localRecord)
  assert.strictEqual(await resolveCloudImage({ coverUrl: '' }, 'coverUrl').then(value => value.coverUrl), '')

  const invalidPath = { coverUrl: '"C:/Users/Lenovo/Desktop/poster.png"' }
  const sanitized = await resolveCloudImage(invalidPath, 'coverUrl')
  assert.notStrictEqual(sanitized, invalidPath)
  assert.strictEqual(sanitized.coverUrl, '')
  assert.strictEqual((await resolvePageCloudImage(invalidPath, 'coverUrl')).coverUrl, '')

  const unavailableRecord = { coverUrl: 'cloud://env.cover/image.png' }
  assert.strictEqual(await resolveCloudImage(unavailableRecord, 'coverUrl'), unavailableRecord)

  global.wx = {
    cloud: {
      getTempFileURL({ fileList }) {
        assert.deepStrictEqual(fileList, ['cloud://env.cover/image.png'])
        return Promise.resolve({
          fileList: [{ fileID: fileList[0], tempFileURL: 'https://temp.example.com/image.png' }]
        })
      }
    }
  }
  const resolved = await resolveCloudImage(unavailableRecord, 'coverUrl')
  assert.notStrictEqual(resolved, unavailableRecord)
  assert.strictEqual(resolved.coverUrl, 'https://temp.example.com/image.png')

  global.wx.cloud.getTempFileURL = () => Promise.reject(new Error('network unavailable'))
  assert.strictEqual(await resolveCloudImage(unavailableRecord, 'coverUrl'), unavailableRecord)

  delete global.wx
  console.log('cloud-image.test.js: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
