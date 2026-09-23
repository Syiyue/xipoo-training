/**
 * 自研预约（模块 3）：事务内的业务校验抽成纯函数，方便 Node 单测。
 * validateOrder 只做判断，不碰数据库；云函数在 runTransaction 里调用它，
 * 通过后再做 remaining-1 与创建订单两个写操作。
 */

/**
 * 校验用户能否对指定时段下单。
 * @param {Array} orders 该用户在该活动下的已有订单（事务内查出）
 * @param {Object|null} slot 目标时段文档
 * @returns {{ok: boolean, errorCode?: string, message?: string}}
 */
function validateOrder(orders, slot) {
  if (!slot) {
    return { ok: false, errorCode: 'SLOT_NOT_FOUND', message: '预约时段不存在' }
  }
  if (slot.closed) {
    return { ok: false, errorCode: 'SLOT_CLOSED', message: '该时段已停止预约' }
  }
  const hasActiveOrder = (orders || []).some((order) => order && order.status === 'booked')
  if (hasActiveOrder) {
    return { ok: false, errorCode: 'ALREADY_BOOKED', message: '每人限约一次，您已有未取消的预约' }
  }
  if (Number(slot.remaining) <= 0) {
    return { ok: false, errorCode: 'SLOT_FULL', message: '该时段名额已满' }
  }
  return { ok: true }
}

module.exports = {
  validateOrder
}
