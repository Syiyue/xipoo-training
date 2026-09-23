// 语音录入日程：api.parseScheduleText 与 mapOcrCourses 的 voice 来源支持
// 场景：voice 来源可辨识；按周重复的课程（有 weekday 无 date）不误报缺日期；OCR 默认行为不变
const assert = require('assert')

const storage = new Map()
let cloudData = {}
let cloudShouldFail = false

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  cloud: undefined
}

const api = require('../utils/api')

function enableCloud() {
  global.wx.cloud = {
    callFunction({ name, data }) {
      return new Promise((resolve, reject) => {
        if (cloudShouldFail) return reject(new Error('network down'))
        resolve({ result: { ok: true, data: cloudData[`${name}:${data.action}`] } })
      })
    }
  }
}

async function main() {
  // ---- mapOcrCourses：默认 source 仍为 ocr，行为不变 ----
  const ocrItems = [{
    course_code: 'DTS101',
    activity_type: 'Lecture',
    date: '2026-09-07',
    start_time: '10:00',
    end_time: '12:00',
    room: 'TC-D-201',
    weeks_text: '第1到16周'
  }]
  const ocrCourses = api.mapOcrCourses(ocrItems, 'job-1')
  assert.strictEqual(ocrCourses.length, 1)
  assert.strictEqual(ocrCourses[0].source, 'ocr', '默认 source 应为 ocr')
  assert.ok(ocrCourses[0].id.startsWith('ocr-'), '默认 id 前缀应为 ocr-')
  assert.strictEqual(ocrCourses[0].needsReview, false, '完整 OCR 课程不需要复核')

  // ---- mapOcrCourses：voice 来源 + 按周重复课程（weekday 无 date） ----
  const voiceItems = [{
    course_code: 'CCT009',
    activity_type: 'Tutorial',
    weekday: 3,
    start_time: '14:00',
    end_time: '16:00',
    room: 'MB106',
    weeks_text: '第1到16周'
  }]
  const voiceCourses = api.mapOcrCourses(voiceItems, 'voice-123', 'voice')
  assert.strictEqual(voiceCourses[0].source, 'voice', 'source 应可标记为 voice')
  assert.ok(voiceCourses[0].id.startsWith('voice-'), 'voice 课程 id 前缀应为 voice-')
  assert.strictEqual(voiceCourses[0].weekday, 3, '无 date 时应保留模型给出的 weekday')
  assert.strictEqual(voiceCourses[0].date, '', '按周课程不应编造 date')
  assert.deepStrictEqual(voiceCourses[0].missingFields, [], '有 weekday 的按周课程不应误报缺日期')
  assert.strictEqual(voiceCourses[0].needsReview, false)

  // ---- parseScheduleText：无云环境时返回空数组 ----
  const noCloud = await api.parseScheduleText('周一上午10点 DTS101')
  assert.deepStrictEqual(noCloud, [], '无云环境应返回空数组')

  // ---- parseScheduleText：空文本直接返回空数组（不调云函数） ----
  enableCloud()
  const empty = await api.parseScheduleText('   ')
  assert.deepStrictEqual(empty, [], '空文本应返回空数组')

  // ---- parseScheduleText：云端返回课程数组，经 voice 归一化 ----
  cloudData['schedule:parseScheduleText'] = { courses: voiceItems }
  const parsed = await api.parseScheduleText('周三下午2点到4点，CCT009 的 Tutorial，教室 MB106，第1到16周')
  assert.strictEqual(parsed.length, 1, '应返回一门课')
  assert.strictEqual(parsed[0].source, 'voice')
  assert.strictEqual(parsed[0].courseCode, 'CCT009')
  assert.strictEqual(parsed[0].weekday, 3)
  assert.ok(String(parsed[0].importBatchId).startsWith('voice-'), '批次号应以 voice- 开头')
  assert.strictEqual(parsed[0].week_set.length, 16, 'weeks_text 应解析为 16 周')

  // ---- parseScheduleText：云端返回空课程数组 ----
  cloudData['schedule:parseScheduleText'] = { courses: [] }
  const none = await api.parseScheduleText('今天天气不错')
  assert.deepStrictEqual(none, [], '未识别出课程时应返回空数组')

  console.log('voice-schedule-import tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
