const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// cloudfunctions 之间不能跨目录引用，calculateFreeTimeBitmap 在
// match/matchLib.js 与 schedule/freeTime.js 各有一份内联实现。
// 本测试防止两份实现再次漂移（历史上 schedule 的副本已分叉且无人引用）。

function extractBitmapFn(filePath) {
  const src = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  const m = src.match(/function calculateFreeTimeBitmap[\s\S]*?\n\}/)
  assert.ok(m, `calculateFreeTimeBitmap not found in ${filePath}`)
  return m[0]
}

const fromMatch = extractBitmapFn(path.join(__dirname, '..', 'cloudfunctions', 'match', 'matchLib.js'))
const fromSchedule = extractBitmapFn(path.join(__dirname, '..', 'cloudfunctions', 'schedule', 'freeTime.js'))

assert.equal(fromSchedule, fromMatch, 'calculateFreeTimeBitmap implementations have drifted')

// 行为抽查：周一 9:00-10:00 有课 → slot 0、1 被占用，slot 2 仍空闲
const { calculateFreeTimeBitmap } = require('../cloudfunctions/schedule/freeTime.js')
const bitmap = calculateFreeTimeBitmap([{ weekday: 1, start: '9:00', end: '10:00' }])
assert.equal(bitmap.length, 154)
assert.equal(bitmap[0], '0')
assert.equal(bitmap[1], '0')
assert.equal(bitmap[2], '1')

console.log('freetime-sync.test.js: all assertions passed')
