const assert = require('assert')

const { isNativeReservation, isJumpActivity } = require('../utils/activityJump')
const { validateOrder } = require('../cloudfunctions/reservation/lib')

// mock 环境（与 tests/activity-jump.test.js 相同风格）
const storage = new Map()
global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) }
}
const backend = require('../utils/mockBackend')

function run() {
  // ===== isNativeReservation =====
  assert(!isNativeReservation(null), 'null is not native reservation')
  assert(!isNativeReservation({ jumpType: 'none' }), 'none is not native reservation')
  assert(!isNativeReservation({ jumpType: 'quickReservation' }), 'quickReservation is third-party jump')
  assert(isNativeReservation({ jumpType: 'nativeReservation' }), 'nativeReservation detected')
  assert(!isJumpActivity({ jumpType: 'nativeReservation' }), 'nativeReservation is NOT a third-party jump')

  // ===== lib.validateOrder（云函数事务内的纯判断） =====
  assert.strictEqual(validateOrder([], null).errorCode, 'SLOT_NOT_FOUND', 'missing slot rejected')
  assert.strictEqual(validateOrder([], { remaining: 3, closed: true }).errorCode, 'SLOT_CLOSED', 'closed slot rejected')
  assert.strictEqual(
    validateOrder([{ status: 'booked' }], { remaining: 3 }).errorCode,
    'ALREADY_BOOKED',
    'one active order per user per activity'
  )
  assert.strictEqual(
    validateOrder([{ status: 'cancelled' }], { remaining: 3 }).ok,
    true,
    'cancelled order does not block rebooking'
  )
  assert.strictEqual(validateOrder([], { remaining: 0 }).errorCode, 'SLOT_FULL', 'full slot rejected')
  assert.strictEqual(validateOrder([], { remaining: 2 }).ok, true, 'valid order passes')

  // ===== mock 层：时段查询 / 扣库存 / 一人一单 / 库存 0 / 取消回补 / myOrders =====
  backend.login({ phone: '13800000001', password: '123456' })
  const db = storage.get('xipoo_mock_db')
  db.activities.push({
    id: 'act-res-1',
    titleZh: '皮划艇体验课',
    title: 'Kayak Taster',
    publisherKey: 'chips',
    jumpType: 'nativeReservation',
    date: '2026-09-01'
  })
  db.reservationActivities = [{
    activityId: 'act-res-1',
    rules: '每人限约一次，请提前 10 分钟到场',
    rulesEn: 'One booking per person',
    totalStock: 7
  }]
  db.reservationSlots = [
    { id: 'slot-a', activityId: 'act-res-1', date: '2026-09-01', start: '10:00', end: '11:00', capacity: 5, remaining: 5 },
    { id: 'slot-b', activityId: 'act-res-1', date: '2026-09-01', start: '14:00', end: '15:00', capacity: 2, remaining: 0 },
    { id: 'slot-c', activityId: 'act-res-1', date: '2026-09-02', start: '10:00', end: '11:00', capacity: 1, remaining: 1, closed: true }
  ]
  db.reservationOrders = []

  // 查时段：closed 时段不下发，满员时段仍展示（remaining=0）
  const view = backend.getReservationSlots('act-res-1')
  assert.strictEqual(view.title, '皮划艇体验课', 'activity title from main table')
  assert.strictEqual(view.rules, '每人限约一次，请提前 10 分钟到场', 'rules returned')
  assert.strictEqual(view.slots.length, 2, 'closed slot hidden')
  assert.strictEqual(view.myOrder, null, 'no order yet')

  // 提交成功扣库存
  const booked = backend.submitReservation('act-res-1', 'slot-a')
  assert.strictEqual(booked.order.status, 'booked', 'order booked')
  assert.strictEqual(booked.order.verifyStatus, 'unused', 'default verifyStatus')
  assert.strictEqual(booked.order.slotText, '2026-09-01 10:00-11:00', 'slotText joined')
  assert.strictEqual(booked.slot.remaining, 4, 'stock decremented')

  // 一人一单拦截（即使换时段也不行）
  assert.throws(() => backend.submitReservation('act-res-1', 'slot-b'), /每人限约一次/, 'second booking blocked')

  // 库存为 0 拦截（换一个用户）
  backend.login({ phone: '13800000002', password: '123456' })
  assert.throws(() => backend.submitReservation('act-res-1', 'slot-b'), /名额已满/, 'full slot blocked')
  // 已关闭时段拦截
  assert.throws(() => backend.submitReservation('act-res-1', 'slot-c'), /停止预约|不存在/, 'closed slot blocked')

  // myOrders 内容（user1 视角）
  backend.login({ phone: '13800000001', password: '123456' })
  const mine = backend.getMyReservations()
  assert.strictEqual(mine.list.length, 1, 'one order for user1')
  assert.strictEqual(mine.list[0].activityTitle, '皮划艇体验课', 'activity title joined')
  assert.strictEqual(mine.list[0].activityTitleEn, 'Kayak Taster', 'english title joined')
  assert.strictEqual(mine.list[0].slotText, '2026-09-01 10:00-11:00', 'slot text joined')
  assert.strictEqual(mine.list[0].status, 'booked', 'status booked')

  // 取消回补库存
  const orderId = mine.list[0].id
  const cancelled = backend.cancelReservation(orderId)
  assert.strictEqual(cancelled.cancelled, true, 'cancel ok')
  const slotA = db.reservationSlots.find((s) => s.id === 'slot-a')
  assert.strictEqual(slotA.remaining, 5, 'stock restored after cancel')
  const after = backend.getMyReservations()
  assert.strictEqual(after.list[0].status, 'cancelled', 'order marked cancelled')
  // 重复取消拦截
  assert.throws(() => backend.cancelReservation(orderId), /已取消/, 'double cancel blocked')

  // 取消后可重新预约
  const rebooked = backend.submitReservation('act-res-1', 'slot-a')
  assert.strictEqual(rebooked.slot.remaining, 4, 'rebook after cancel works')

  // getSlots 带出我的未取消订单
  const view2 = backend.getReservationSlots('act-res-1')
  assert(view2.myOrder && view2.myOrder.id === rebooked.order.id, 'myOrder returned in getSlots')
  assert.strictEqual(view2.myOrder.slotText, '2026-09-01 10:00-11:00', 'myOrder slot text joined')

  console.log('reservation.test.js: all assertions passed')
}

run()
