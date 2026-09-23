const assert = require('assert')

const storage = new Map()
let cloudCalls = 0
let cloudHandler = async () => ({ result: { ok: true, data: { text: '混元生成的文案' } } })

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  cloud: {
    callFunction(options) {
      cloudCalls += 1
      return cloudHandler(options)
    }
  }
}

const companionAi = require('../utils/companionAi')

async function run() {
  // polish 成功：返回混元文案并缓存
  const first = await companionAi.polishSuggestion({
    type: 'class-soon',
    vars: { course: 'DTS101', minutes: 15 },
    fallback: '模板文案',
    lang: 'zh'
  })
  assert.strictEqual(first, '混元生成的文案', 'polish returns AI text')
  assert.strictEqual(cloudCalls, 1, 'one cloud call made')

  // 同参数命中缓存，不再调用云函数
  const second = await companionAi.polishSuggestion({
    type: 'class-soon',
    vars: { course: 'DTS101', minutes: 15 },
    fallback: '模板文案',
    lang: 'zh'
  })
  assert.strictEqual(second, '混元生成的文案', 'cached text returned')
  assert.strictEqual(cloudCalls, 1, 'cache hit avoids another cloud call')
  assert.strictEqual(
    companionAi.getCachedPolish('class-soon', { course: 'DTS101', minutes: 15 }, 'zh'),
    '混元生成的文案',
    'getCachedPolish reads the cache'
  )

  // 不同语言 / 不同变量是不同缓存项
  cloudHandler = async () => ({ result: { ok: true, data: { text: 'AI line in English' } } })
  const en = await companionAi.polishSuggestion({
    type: 'class-soon',
    vars: { course: 'DTS101', minutes: 15 },
    fallback: 'fallback',
    lang: 'en'
  })
  assert.strictEqual(en, 'AI line in English', 'language variants cached separately')
  assert.strictEqual(cloudCalls, 2)

  // 云端失败：静默返回 null，调用方回退模板
  cloudHandler = async () => ({ result: { ok: false, message: 'token exhausted' } })
  const failed = await companionAi.polishSuggestion({
    type: 'free-gap',
    vars: { gap: '2小时' },
    fallback: '模板',
    lang: 'zh'
  })
  assert.strictEqual(failed, null, 'cloud failure falls back to null')

  // wx.cloud 不可用：同样静默
  const savedCloud = wx.cloud
  delete wx.cloud
  const noCloud = await companionAi.polishSuggestion({
    type: 'weekend-match',
    vars: {},
    fallback: '模板',
    lang: 'zh'
  })
  assert.strictEqual(noCloud, null, 'missing cloud returns null')
  wx.cloud = savedCloud

  // greeting：按日期+摘要缓存
  cloudHandler = async () => ({ result: { ok: true, data: { text: '周一加油呀' } } })
  const g1 = await companionAi.dailyGreeting('2026-08-10', { courseCount: 3 }, 'zh')
  assert.strictEqual(g1, '周一加油呀', 'greeting returns AI text')
  const callsBefore = cloudCalls
  const g2 = await companionAi.dailyGreeting('2026-08-10', { courseCount: 3 }, 'zh')
  assert.strictEqual(g2, '周一加油呀', 'greeting cache hit')
  assert.strictEqual(cloudCalls, callsBefore, 'greeting cache avoids duplicate calls')
  const g3 = await companionAi.dailyGreeting('2026-08-11', { courseCount: 3 }, 'zh')
  assert.strictEqual(cloudCalls, callsBefore + 1, 'new day triggers a fresh greeting')

  console.log('companion-ai.test.js: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
