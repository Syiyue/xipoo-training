// 回归测试：卡片切换日程数据丢失 & 活动列表分页
// 场景：云端抖动时 mock 兜底数据不得覆盖真实课表；分页结构在云/ mock 两侧一致
const assert = require('assert')

// 仅此 Node 回归测试允许 mock，产品运行时不会设置该标记。
global.__XIPOO_TEST_ALLOW_MOCK__ = true

const storage = new Map()
let cloudShouldFail = false
let cloudBusinessError = false
let cloudData = {}

global.wx = {
  getStorageSync(key) { return storage.get(key) },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  cloud: undefined
}

const mock = require('../utils/mockBackend')
mock.login({ phone: '13800000001', password: '123456' })

const api = require('../utils/api')

function enableCloud() {
  global.wx.cloud = {
    callFunction({ name, data }) {
      return new Promise((resolve, reject) => {
        if (cloudShouldFail) return reject(new Error('network down'))
        if (cloudBusinessError) return resolve({ result: { ok: false, code: 'BIZ_ERROR', message: '请先开启该类型的找搭子开关' } })
        resolve({ result: { ok: true, data: cloudData[`${name}:${data.action}`] } })
      })
    }
  }
}

async function main() {
  // ---- 场景 1：纯 mock 模式（无云环境），mock 数据是权威数据源，不打失败标记 ----
  const mockCourses = await api.getSchedule()
  assert.ok(Array.isArray(mockCourses), 'mock 模式课表应为数组')
  assert.strictEqual(mockCourses.__cloudFailed, undefined, '纯 mock 模式不应打 __cloudFailed 标记')

  // mock 模式分页：getActivities 返回 { list, pagination }
  const page1 = await api.getActivities({ page: 1, pageSize: 2 })
  assert.ok(Array.isArray(page1.list), 'mock 分页应返回 list 数组')
  assert.ok(page1.pagination && page1.pagination.page === 1, '应返回 pagination 元信息')
  assert.strictEqual(page1.list.length, Math.min(2, page1.pagination.total), '首页条数应受 pageSize 限制')
  if (page1.pagination.totalPages > 1) {
    const page2 = await api.getActivities({ page: 2, pageSize: 2 })
    assert.strictEqual(page1.pagination.hasMore, true, '总数超过一页时 hasMore 应为 true')
    assert.notDeepStrictEqual(page1.list.map((i) => i.id), page2.list.map((i) => i.id), '第 2 页内容应与第 1 页不同')
    const last = await api.getActivities({ page: page1.pagination.totalPages, pageSize: 2 })
    assert.strictEqual(last.pagination.hasMore, false, '最后一页 hasMore 应为 false')
  }

  // ---- 场景 2：云端健康，返回真实课表（不带标记） ----
  const realCourses = [
    { id: 'c1', title: 'MTH019', date: '2026-07-22', start: '09:00', end: '10:50' },
    { id: 'c2', title: 'EAP041', date: '2026-07-23', start: '13:00', end: '14:50' }
  ]
  cloudData['schedule:listSchedules'] = realCourses
  enableCloud()
  const cloudCourses = await api.getSchedule()
  assert.deepStrictEqual(cloudCourses, realCourses, '云端健康时应返回真实课表')
  assert.strictEqual(cloudCourses.__cloudFailed, undefined, '云端成功结果不应打标记')

  // ---- 场景 3：业务错误不能误触发云端熔断，否则“未入池”会被错误伪装成空数据 ----
  cloudBusinessError = true
  await assert.rejects(
    () => api.getMatchRecommendations('study'),
    /请先开启该类型的找搭子开关/,
    '业务错误应原样交给页面处理'
  )
  await assert.rejects(
    () => api.setMatchPool('study', { enabled: true, genderFilter: 'any', selectedTags: [] }),
    /请先开启该类型的找搭子开关/,
    '入池保存失败时不能伪装为本地保存成功'
  )
  cloudBusinessError = false
  const afterBusinessError = await api.getSchedule()
  assert.deepStrictEqual(afterBusinessError, realCourses, '业务错误后云端健康请求不应被熔断')

  cloudData['match:myJoinedGroups'] = []
  assert.deepStrictEqual(await api.getMyJoinedGroups(), [], '我的小组接口应映射到 myJoinedGroups 云函数动作')

  // ---- 场景 4：云端抖动失败，熔断开启，回退 mock 必须打 __cloudFailed 标记 ----
  cloudShouldFail = true
  const fallback1 = await api.getSchedule()
  assert.strictEqual(fallback1.__cloudFailed, true, '云端失败回退必须打 __cloudFailed 标记')
  assert.ok(!Object.keys(fallback1).includes('__cloudFailed'), '标记应不可枚举，避免污染 setData/缓存')

  // 模拟 loadData 守卫：带标记的结果不得覆盖已有真实数据
  const pageState = { courses: cloudCourses }
  const guarded = fallback1.__cloudFailed ? pageState.courses : (fallback1 || [])
  assert.deepStrictEqual(guarded, realCourses, '守卫后课表应保持真实数据不丢失')

  // ---- 场景 5：快速连续切换（熔断期内多次加载），每次回退都必须带标记 ----
  for (let i = 0; i < 5; i++) {
    const fallbackN = await api.getSchedule()
    assert.strictEqual(fallbackN.__cloudFailed, true, `第 ${i + 2} 次快速切换回退仍应带标记`)
  }

  // ---- 场景 6：课程表/匹配（活动）卡片混合切换，活动接口回退同样带标记 ----
  const fallbackActs = await api.getActivities({ page: 1, pageSize: 20 })
  assert.strictEqual(fallbackActs.__cloudFailed, true, '活动列表云端失败回退也应带标记')
  assert.ok(Array.isArray(fallbackActs.list), '活动回退仍应提供可用的分页结构')

  console.log('schedule-data-guard tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
