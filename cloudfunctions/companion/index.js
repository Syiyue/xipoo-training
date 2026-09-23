/**
 * 噗噗助手 AI 云函数：用混元大模型把模板话术润色成更自然、更贴心的文案。
 * - action=polish：单条建议文案润色（输入场景 + 变量 + 模板兜底文案）
 * - action=greeting：面板顶部的每日综合寄语（输入当日课程/活动摘要）
 * 任何异常都返回 ok:false，前端回退到模板话术，不影响主流程。
 */

const tcb = require('@cloudbase/node-sdk')

// CloudBase 已将旧 hunyuan-exp 迁移到内置 cloudbase provider。
// 使用控制台已开通的 hy3-preview；云函数运行时会使用当前环境身份鉴权，
// 不在代码、日志或客户端保存 API Key。
const MODEL_GROUP = 'cloudbase'
const MODEL_ID = 'hy3-preview'

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

// 模型实例在容器级复用，避免每次调用重复初始化
let cachedModel = null
function getModel() {
  if (!cachedModel) cachedModel = app.ai().createModel(MODEL_GROUP)
  return cachedModel
}

function ok(data) {
  return { ok: true, data }
}

function fail(code, message) {
  return { ok: false, code, message }
}

function persona(lang) {
  if (lang === 'en') {
    return [
      'You are "Pupu", a cute purple octopus AI assistant inside Xipoo, a campus schedule mini program.',
      'Personality: warm, lively, a little playful but never annoying.',
      'Rules: output ONE short reminder sentence in English, max 90 characters;',
      'no quotes, no prefix, no explanation; keep all facts (course names, times, places, names) exactly as given;',
      'one emoji at most, and it is fine to use none.'
    ].join(' ')
  }
  return [
    '你是「噗噗」，Xipoo 校园日程小程序里的 AI 小章鱼助手。',
    '性格：贴心、活泼、有一点俏皮但绝不烦人。',
    '规则：只输出一句中文提醒文案，不超过 45 字；',
    '不要引号、不要前缀、不要解释；课程名、时间、地点、人名必须原样保留；',
    '最多用 1 个 emoji，不用也可以。'
  ].join('')
}

const SCENARIO_NAMES = {
  'class-soon': { zh: '课前提醒（马上要上课）', en: 'class starting soon' },
  'classmate-together': { zh: '好友同课（好友也上这门课，可以约着一起）', en: 'a friend takes the same class' },
  'new-activity': { zh: '关注的活动方发布了新活动', en: 'a followed organizer posted a new activity' },
  'activity-soon': { zh: '活动临近提醒', en: 'an activity is coming up' },
  'needs-review': { zh: '导入的课程有待补全信息', en: 'imported classes need completion' },
  'early-class-tomorrow': { zh: '明天有早课，提醒早点休息', en: 'early class tomorrow, remind to rest' },
  'free-gap': { zh: '课间较长的空档', en: 'a long break between classes' },
  'day-overview': { zh: '早上好，今日课程总览', en: 'morning overview of today\'s classes' },
  'day-done': { zh: '今天的课结束了', en: 'all classes finished today' },
  'weekend-match': { zh: '周末邀约，去看大家的共同空闲', en: 'weekend plan, check shared free time' },
  'schedule-empty': { zh: '课表为空，引导 AI 拍照上传课表', en: 'empty schedule, invite to upload via AI' },
  'no-class-day': { zh: '今天没有课，推荐自由安排或活动', en: 'no classes today, suggest free time or activities' },
  'free-gap-activity': { zh: '课间空档正好赶上一个活动', en: 'a free gap that fits an activity today' },
  'activity-recommend': { zh: '在活动页种草推荐一个活动', en: 'recommend an upcoming activity' },
  'week-preview': { zh: '周日晚上预告下周课表', en: 'Sunday evening preview of next week' },
  'profile-incomplete': { zh: '提醒完善个人资料', en: 'remind to complete profile' },
  'subscription-hint': { zh: '引导关注活动方', en: 'invite to follow organizers' }
}

function varsText(vars) {
  return Object.keys(vars || {})
    .filter((key) => vars[key] !== undefined && vars[key] !== null && vars[key] !== '')
    .slice(0, 12)
    // 单项截断，防止超长输入烧 token
    .map((key) => `${String(key).slice(0, 24)}=${String(vars[key]).slice(0, 60)}`)
    .join('；')
}

async function polish(payload) {
  const lang = payload.lang === 'en' ? 'en' : 'zh'
  const scenario = SCENARIO_NAMES[payload.type]
  if (!scenario) return fail('INVALID_PARAM', 'unknown scenario type')
  const fallback = String(payload.fallback || '').slice(0, 120)
  const prompt = lang === 'en'
    ? `Scenario: ${scenario[payload.lang] || scenario.en}. Facts: ${varsText(payload.vars)}. Reference wording: "${fallback}". Write the reminder sentence now.`
    : `场景：${scenario.zh}。信息：${varsText(payload.vars)}。参考文案：「${fallback}」。请直接输出润色后的文案。`
  const model = getModel()
  const result = await model.generateText({
    model: MODEL_ID,
    messages: [
      { role: 'system', content: persona(lang) },
      { role: 'user', content: prompt }
    ]
  })
  const text = String((result && result.text) || '').trim().replace(/^["「]|["」]$/g, '')
  if (!text) return fail('EMPTY_RESULT', 'model returned empty text')
  return ok({ text: text.slice(0, 120) })
}

async function greeting(payload) {
  const lang = payload.lang === 'en' ? 'en' : 'zh'
  const summary = payload.summary || {}
  const facts = varsText({
    weekday: summary.weekday,
    courseCount: summary.courseCount,
    nextCourse: summary.nextCourse,
    nextTime: summary.nextTime,
    activityCount: summary.activityCount,
    activity: summary.activity,
    freeThisAfternoon: summary.freeThisAfternoon
  })
  const prompt = lang === 'en'
    ? `Give the user a one-sentence daily greeting for their schedule assistant panel (max 90 characters). Today: ${facts}. If there are classes, mention the next one; if free, encourage them; be warm.`
    : `为用户的日程助手面板写一句今日寄语（不超过 50 字）。今天的情况：${facts}。有课就提一嘴下一节，没课就鼓励一下，语气温暖。`
  const model = getModel()
  const result = await model.generateText({
    model: MODEL_ID,
    messages: [
      { role: 'system', content: persona(lang) },
      { role: 'user', content: prompt }
    ]
  })
  const text = String((result && result.text) || '').trim().replace(/^["「]|["」]$/g, '')
  if (!text) return fail('EMPTY_RESULT', 'model returned empty text')
  return ok({ text: text.slice(0, 120) })
}

function parseJsonArray(text) {
  const source = String(text || '').trim()
  const match = source.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const list = JSON.parse(match[0])
    return Array.isArray(list) ? list : null
  } catch (error) {
    return null
  }
}

async function activitySuggestions(payload) {
  const participantCount = Math.max(1, Math.min(12, Number(payload.participantCount) || 1))
  const longestSlotMinutes = Math.max(0, Math.min(660, Number(payload.longestSlotMinutes) || 0))
  const slots = (Array.isArray(payload.sharedFreeSlots) ? payload.sharedFreeSlots : [])
    .slice(0, 8)
    .map((slot) => ({
      start: String(slot.start || '').slice(0, 5),
      end: String(slot.end || '').slice(0, 5),
      durationMinutes: Math.max(0, Math.min(660, Number(slot.durationMinutes || slot.duration) || 0))
    }))
    .filter((slot) => slot.start && slot.end && slot.durationMinutes >= 30)
  if (!slots.length || longestSlotMinutes < 50) return fail('INVALID_PARAM', '暂无可推荐的共同空闲时间')
  const maximum = longestSlotMinutes - 20
  const prompt = [
    '你是面向大学生日常活动场景的轻量活动推荐助手。',
    '只能依据给定的所有人共同空闲时间推荐。活动时长不得超过最长连续时段减去20分钟。',
    '推荐消费适中、准备成本低的活动。不要使用“组队、找搭子、约伴、连玩”等措辞。',
    `参与人数：${participantCount}。日期：${String(payload.date || '').slice(0, 10)}。共同空闲：${JSON.stringify(slots)}。最长连续时长：${longestSlotMinutes}分钟。`,
    '只返回 JSON 数组，且恰好三项。每项字段为 title、reason、estimatedMinutes、category。reason 只能一句中文。'
  ].join('\n')
  const model = getModel()
  const result = await model.generateText({
    model: MODEL_ID,
    messages: [
      { role: 'system', content: '你必须只输出合法 JSON 数组，不要 markdown，不要解释。' },
      { role: 'user', content: prompt }
    ]
  })
  const list = parseJsonArray(result && result.text)
  const suggestions = (list || []).slice(0, 3).map((item, index) => ({
    id: `ai-${Date.now()}-${index + 1}`,
    title: String(item && item.title || '').slice(0, 24),
    reason: String(item && item.reason || '').slice(0, 58),
    estimatedMinutes: Math.max(30, Number(item && item.estimatedMinutes) || 0),
    category: String(item && item.category || 'leisure').slice(0, 24)
  })).filter((item) => (
    item.title && item.reason && item.estimatedMinutes <= maximum
  ))
  if (suggestions.length !== 3) return fail('INVALID_RESULT', '活动建议格式不符合要求')
  return ok({ suggestions })
}

// ===== 推广位：下发与埋点 =====

// 读取当前可投放的推广卡片（云端过滤状态与时间窗，端上只拿到必要字段）
async function listActiveAds() {
  const res = await db.collection('companion_ads')
    .where({ status: 'active' })
    .limit(50)
    .get()
  const now = new Date().toISOString()
  const ads = (res.data || [])
    .filter((ad) => (!ad.startAt || ad.startAt <= now) && (!ad.endAt || ad.endAt >= now))
    .map((ad) => ({
      id: ad.id,
      copy: ad.copy,
      copyEn: ad.copyEn || '',
      icon: ad.icon || '🐙',
      imageUrl: ad.imageUrl || '',
      action: ad.action || null,
      sceneTags: Array.isArray(ad.sceneTags) ? ad.sceneTags : [],
      dailyCapPerUser: Number(ad.dailyCapPerUser) || 1
    }))
  return ok({ ads })
}

async function trackAd(payload, openid) {
  const adId = String(payload.adId || '').slice(0, 64)
  const type = String(payload.type || '')
  if (!adId || !['impression', 'click', 'close'].includes(type)) {
    return fail('INVALID_PARAM', 'adId 或事件类型非法')
  }
  const scene = String(payload.scene || '').slice(0, 40)
  // 只存 xipooId，不落 openid；查不到用户时留空也不阻塞埋点
  let userId = ''
  try {
    const found = await db.collection('users').where({ openid }).limit(1).get()
    userId = found.data && found.data[0] ? found.data[0].xipooId : ''
  } catch (error) { /* 用户表查询失败不阻塞 */ }
  const createdAt = new Date().toISOString()
  await db.collection('companion_ad_events').add({
    data: { adId, userId, type, scene, createdAt }
  })
  if (type !== 'close') {
    const field = type === 'impression' ? 'stats.impressions' : 'stats.clicks'
    try {
      await db.collection('companion_ads').doc(adId).update({ data: { [field]: _.inc(1) } })
    } catch (error) { /* 计数失败不影响埋点 */ }
  }
  return ok({ tracked: type })
}

exports.main = async (event) => {
  const action = event && event.action
  let payload = (event && event.payload) || {}
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch (error) {
      payload = {}
    }
  }
  // 与项目其他云函数一致：仅允许小程序端登录用户调用，防止匿名刷接口烧 token
  const wxContext = app.getWXContext ? app.getWXContext() : {}
  if (!wxContext.OPENID) return fail('UNAUTHORIZED', 'login required')
  try {
    if (action === 'polish') return await polish(payload)
    if (action === 'greeting') return await greeting(payload)
    if (action === 'activitySuggestions') return await activitySuggestions(payload)
    if (action === 'ads') return await listActiveAds()
    if (action === 'track') return await trackAd(payload, wxContext.OPENID)
    return fail('INVALID_ACTION', `unsupported action: ${action}`)
  } catch (error) {
    console.error('[companion] ai error', error && error.message)
    return fail('AI_ERROR', error && error.message ? error.message : 'ai request failed')
  }
}
