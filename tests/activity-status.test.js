const assert = require('assert')

const {
  STATUS_DEFS,
  computeActivityStatus,
  withActivityStatus
} = require('../utils/activityStatus')

const NOW = new Date('2026-08-10T09:00:00')

function run() {
  // 色值规范（模块 5）
  assert.strictEqual(STATUS_DEFS.open.color, '#07c160')
  assert.strictEqual(STATUS_DEFS.full.color, '#e64340')
  assert.strictEqual(STATUS_DEFS.soon.color, '#ff9c00')
  assert.strictEqual(STATUS_DEFS.ended.color, '#e04343')

  // date + start/end 形态
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-20', start: '14:00', end: '16:00' }, NOW),
    'open',
    'future activity is open for registration'
  )
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-10', start: '20:00', end: '22:00' }, NOW),
    'soon',
    'starts within 24h'
  )
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-09', start: '14:00', end: '16:00' }, NOW),
    'ended',
    'past activity is ended'
  )
  // 已满员优先于即将开始
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-10', start: '20:00', end: '22:00', capacity: 30, registrationCount: 30 }, NOW),
    'full',
    'capacity reached means full'
  )
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-20', capacity: 30, registrationCount: 29 }, NOW),
    'open',
    'one seat left is still open'
  )
  // 已结束优先于已满员
  assert.strictEqual(
    computeActivityStatus({ date: '2026-08-09', capacity: 10, registrationCount: 10 }, NOW),
    'ended',
    'ended beats full'
  )

  // startAt/endAt（ISO）形态
  assert.strictEqual(
    computeActivityStatus({ startAt: '2026-08-10T20:00:00', endAt: '2026-08-10T22:00:00' }, NOW),
    'soon',
    'ISO shape: starts within 24h'
  )
  assert.strictEqual(
    computeActivityStatus({ startAt: '2026-08-20T14:00:00', endAt: '2026-08-20T16:00:00' }, NOW),
    'open',
    'ISO shape: future open'
  )

  // 显式 status 字段
  assert.strictEqual(computeActivityStatus({ status: 'closed', date: '2026-08-20' }, NOW), 'ended', 'explicit closed maps to ended')

  // 无时间信息默认报名中
  assert.strictEqual(computeActivityStatus({}, NOW), 'open', 'no time info defaults to open')

  // withActivityStatus 双语
  const zh = withActivityStatus({ date: '2026-08-20', start: '14:00', end: '16:00' }, 'zh', NOW)
  assert.strictEqual(zh.statusKey, 'open')
  assert.strictEqual(zh.statusText, '报名中')
  const en = withActivityStatus({ date: '2026-08-09' }, 'en', NOW)
  assert.strictEqual(en.statusKey, 'ended')
  assert.strictEqual(en.statusText, 'Ended')

  console.log('activity-status.test.js: all assertions passed')
}

run()
