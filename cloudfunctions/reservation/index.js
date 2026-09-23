/**
 * 自研预约（模块 3）云函数
 *
 * 数据模型：
 *   reservation_activities { activityId, rules, rulesEn, totalStock, createdAt, updatedAt, updatedBy }
 *   reservation_slots      { activityId, date, start, end, capacity, remaining, closed?, createdAt }
 *   reservation_orders     { activityId, slotId, openid, xipooId, status, verifyStatus, createdAt, cancelledAt }
 *
 * 写操作（submitOrder/cancelOrder）全部走 db.runTransaction，保证并发下
 * 「一人一单 + 库存不为负」；业务判断抽在 lib.js 的 validateOrder 里便于单测。
 */
const cloud = require('wx-server-sdk')
const { validateOrder } = require('./lib')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const users = db.collection('users')
const activities = db.collection('activities')
const reservationActivities = db.collection('reservation_activities')
const reservationSlots = db.collection('reservation_slots')
const reservationOrders = db.collection('reservation_orders')

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

async function currentUserId(openid) {
  const found = await users.where({ openid }).limit(1).get()
  const record = found.data && found.data[0]
  return record ? record.xipooId : null
}

function slotText(slot) {
  if (!slot) return ''
  return `${slot.date || ''} ${slot.start || ''}-${slot.end || ''}`.trim()
}

function serializeSlot(doc) {
  return {
    id: doc._id,
    activityId: doc.activityId,
    date: doc.date || '',
    start: doc.start || '',
    end: doc.end || '',
    capacity: Number(doc.capacity) || 0,
    remaining: Number(doc.remaining) || 0,
    closed: Boolean(doc.closed)
  }
}

function serializeOrder(doc) {
  return {
    id: doc._id,
    activityId: doc.activityId,
    slotId: doc.slotId,
    status: doc.status || 'booked',
    verifyStatus: doc.verifyStatus || 'unused',
    createdAt: doc.createdAt || '',
    cancelledAt: doc.cancelledAt || ''
  }
}

// 时段列表（游客可看）：规则按 reservation_activities，展示字段以 activities 主表为准
async function getSlots(openid, payload) {
  const activityId = String((payload && payload.activityId) || '').trim()
  if (!activityId) return fail('INVALID_PARAM', '缺少 activityId')

  let activity = null
  try {
    const res = await activities.doc(activityId).get()
    activity = res.data
  } catch (e) {
    return fail('NOT_FOUND', '活动不存在')
  }
  if (!activity) return fail('NOT_FOUND', '活动不存在')

  let config = null
  try {
    const res = await reservationActivities.where({ activityId }).limit(1).get()
    config = (res.data && res.data[0]) || null
  } catch (e) { /* 集合未创建时按无配置处理 */ }

  const slotsRes = await reservationSlots.where({ activityId }).limit(200).get()
  const slots = (slotsRes.data || [])
    .filter((slot) => !slot.closed)
    .map(serializeSlot)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))

  // 登录用户顺带带出自己在该活动下的未取消订单，页面直接显示「已预约」状态
  let myOrder = null
  if (openid) {
    try {
      const orderRes = await reservationOrders.where({ activityId, openid, status: 'booked' }).limit(1).get()
      const order = (orderRes.data && orderRes.data[0]) || null
      if (order) {
        const slotDoc = (slotsRes.data || []).find((slot) => slot._id === order.slotId)
        myOrder = Object.assign(serializeOrder(order), { slotText: slotText(slotDoc) })
      }
    } catch (e) { /* 查询失败不阻塞时段展示 */ }
  }

  return ok({
    activityId,
    title: activity.titleZh || activity.title || '',
    titleEn: activity.title || activity.titleZh || '',
    rules: (config && config.rules) || '',
    rulesEn: (config && config.rulesEn) || '',
    slots,
    myOrder
  })
}

// 提交预约：事务内校验（时段存在/未关闭、一人一单、库存>0）→ 扣库存 + 建单
async function submitOrder(openid, xipooId, payload) {
  const activityId = String((payload && payload.activityId) || '').trim()
  const slotId = String((payload && payload.slotId) || '').trim()
  if (!activityId || !slotId) return fail('INVALID_PARAM', '缺少 activityId 或 slotId')

  const result = await db.runTransaction(async (transaction) => {
    const slotsCol = transaction.collection('reservation_slots')
    const ordersCol = transaction.collection('reservation_orders')

    let slot = null
    try {
      const slotRes = await slotsCol.doc(slotId).get()
      slot = slotRes.data
    } catch (e) {
      slot = null
    }
    if (slot && slot.activityId !== activityId) slot = null

    const existing = await ordersCol.where({ activityId, openid, status: 'booked' }).limit(1).get()
    const check = validateOrder(existing.data || [], slot)
    if (!check.ok) return check // 未做任何写入，提交空事务即可

    await slotsCol.doc(slotId).update({ data: { remaining: _.inc(-1) } })
    const added = await ordersCol.add({
      data: {
        activityId,
        slotId,
        openid,
        xipooId,
        status: 'booked',
        verifyStatus: 'unused',
        createdAt: db.serverDate(),
        cancelledAt: null
      }
    })
    return { ok: true, orderId: added._id }
  })

  if (!result || !result.ok) {
    return fail((result && result.errorCode) || 'ACTION_FAILED', (result && result.message) || '预约失败')
  }

  const orderRes = await reservationOrders.doc(result.orderId).get()
  const slotRes = await reservationSlots.doc(slotId).get()
  return ok({
    order: Object.assign(serializeOrder(orderRes.data), { slotText: slotText(slotRes.data) }),
    slot: serializeSlot(slotRes.data)
  })
}

// 取消预约：只能取消自己的 booked 订单；事务内改状态 + 回补库存
async function cancelOrder(openid, payload) {
  const orderId = String((payload && payload.orderId) || '').trim()
  if (!orderId) return fail('INVALID_PARAM', '缺少 orderId')

  const result = await db.runTransaction(async (transaction) => {
    const ordersCol = transaction.collection('reservation_orders')
    let order = null
    try {
      const orderRes = await ordersCol.doc(orderId).get()
      order = orderRes.data
    } catch (e) {
      order = null
    }
    if (!order) return { ok: false, errorCode: 'NOT_FOUND', message: '预约记录不存在' }
    if (order.openid !== openid) return { ok: false, errorCode: 'FORBIDDEN', message: '只能取消自己的预约' }
    if (order.status !== 'booked') return { ok: false, errorCode: 'ALREADY_CANCELLED', message: '该预约已取消' }

    await ordersCol.doc(orderId).update({
      data: { status: 'cancelled', cancelledAt: db.serverDate() }
    })
    try {
      await transaction.collection('reservation_slots').doc(order.slotId).update({
        data: { remaining: _.inc(1) }
      })
    } catch (e) {
      // 时段被删也要允许取消：抛出会回滚订单状态，这里只记录日志
      console.warn('[reservation] slot remaining restore skipped:', order.slotId, e.message)
    }
    return { ok: true }
  })

  if (!result || !result.ok) {
    return fail((result && result.errorCode) || 'ACTION_FAILED', (result && result.message) || '取消失败')
  }
  return ok({ cancelled: true, orderId })
}

// 我的预约列表：联出活动标题（activities 批量 in 查询）与时段文本
async function myOrders(openid) {
  const res = await reservationOrders.where({ openid }).orderBy('createdAt', 'desc').limit(100).get()
  const orders = res.data || []
  if (!orders.length) return ok({ list: [] })

  const activityIds = [...new Set(orders.map((order) => order.activityId).filter(Boolean))]
  const slotIds = [...new Set(orders.map((order) => order.slotId).filter(Boolean))]

  const titleMap = {}
  for (let start = 0; start < activityIds.length; start += 20) {
    const batch = activityIds.slice(start, start + 20)
    try {
      const actRes = await activities.where({ _id: _.in(batch) }).limit(20).get()
      ;(actRes.data || []).forEach((item) => {
        titleMap[item._id] = { title: item.titleZh || item.title || '', titleEn: item.title || item.titleZh || '' }
      })
    } catch (e) { /* 单个批次失败不阻塞整体 */ }
  }

  const slotMap = {}
  for (let start = 0; start < slotIds.length; start += 20) {
    const batch = slotIds.slice(start, start + 20)
    try {
      const slotRes = await reservationSlots.where({ _id: _.in(batch) }).limit(20).get()
      ;(slotRes.data || []).forEach((item) => {
        slotMap[item._id] = item
      })
    } catch (e) { /* ignore */ }
  }

  const list = orders.map((order) => {
    const title = titleMap[order.activityId] || { title: '', titleEn: '' }
    return Object.assign(serializeOrder(order), {
      activityTitle: title.title,
      activityTitleEn: title.titleEn,
      slotText: slotText(slotMap[order.slotId])
    })
  })
  return ok({ list })
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const { action, payload = {} } = event || {}

    if (action === 'ping') {
      return ok({ openid, env: wxContext.ENV, time: Date.now() })
    }

    // 时段与规则展示不强制登录，游客可看
    if (action === 'getSlots') {
      return await getSlots(openid, payload)
    }

    if (!openid) return fail('NOT_LOGIN', '无法获取用户身份，请从小程序内调用')

    const xipooId = await currentUserId(openid)
    if (!xipooId) return fail('USER_NOT_FOUND', '用户不存在，请重新登录')

    switch (action) {
      case 'submitOrder':
        return await submitOrder(openid, xipooId, payload)
      case 'cancelOrder':
        return await cancelOrder(openid, payload)
      case 'myOrders':
        return await myOrders(openid)
      default:
        return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
  } catch (err) {
    console.error('[reservation cloud function error]', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
