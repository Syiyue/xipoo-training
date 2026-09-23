// 数据预拉取专用云函数：微信公众平台「数据预拉取」配置后，微信客户端会在
// 小程序冷启动、代码包加载的同时后台调用本函数，页面通过
// wx.getBackgroundFetchData() 直接读取结果，跳过首屏的串行云函数调用。
//
// 设计约束：
// - 只读、无入参、快速：仅聚合首屏（日程 tab）所需的 me / courses / activitySchedule。
// - 未登录（无 OPENID 或用户不存在）时返回空数据而不是报错，避免刷错误日志。
// - 响应体积需远小于预拉取 256KB 上限；课表量级（<200 条）没有问题。
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const users = db.collection('users')
const schedules = db.collection('schedules')
const activitySchedules = db.collection('activity_schedules')

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}

function defaultVisibility() {
  return { gender: false, degree: false, major: false, school: false, tags: false, bio: false }
}

// 与 user 云函数 toOwnUser 保持一致，供首屏直接复用登录后的用户形状
function toOwnUser(record) {
  if (!record) return null
  const phone = record.phone
    ? String(record.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    : ''
  return {
    id: record.xipooId,
    openid: record.openid || '',
    unionid: record.unionid || '',
    phone,
    name: record.name || 'Xipoo User',
    school: record.school || 'XJTLU',
    age: record.age || '',
    degree: record.degree || '',
    major: record.major || '',
    grade: record.grade || '',
    gender: record.gender || '',
    avatar: record.avatar || 'X',
    avatarUrl: record.avatarUrl || '',
    coverUrl: record.coverUrl || '',
    bio: record.bio || '',
    signature: record.signature || '',
    featureTags: Array.isArray(record.featureTags) ? record.featureTags : [],
    selectedTags: Array.isArray(record.selectedTags) ? record.selectedTags : [],
    profileTheme: record.profileTheme || 'mint',
    profileVisibility: Object.assign(defaultVisibility(), record.profileVisibility || {}),
    buddyWechatId: record.buddyWechatId || '',
    subscriptions: Array.isArray(record.subscriptions) ? record.subscriptions : [],
    wechatBound: Boolean(record.openid)
  }
}

function toCourse(doc) {
  const copy = Object.assign({}, doc)
  delete copy._id
  delete copy._openid
  delete copy.userId
  return copy
}

exports.main = async () => {
  const startTime = Date.now()
  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID
    if (!openid) {
      return ok({ guest: true, me: null, courses: [], activitySchedule: [] })
    }

    const found = await users.where({ openid }).limit(1).get()
    const record = found.data && found.data[0]
    if (!record || !record.xipooId) {
      return ok({ guest: true, me: null, courses: [], activitySchedule: [] })
    }

    const userId = record.xipooId
    const [coursesRes, activityRes] = await Promise.all([
      schedules.where({ userId }).limit(200).get(),
      activitySchedules.where({ userId }).limit(200).get().catch(() => ({ data: [] }))
    ])

    console.log(`[prefetch] userId=${userId} courses=${(coursesRes.data || []).length} elapsed=${Date.now() - startTime}ms`)
    return ok({
      me: toOwnUser(record),
      courses: (coursesRes.data || []).map(toCourse),
      activitySchedule: (activityRes.data || []).map(toCourse)
    })
  } catch (err) {
    // 预拉取是加速通道，失败时返回空结果让页面走正常请求兜底，不抛错。
    console.error('[prefetch] internal error', err)
    return ok({ guest: true, me: null, courses: [], activitySchedule: [] }, 'prefetch failed, fallback')
  }
}
