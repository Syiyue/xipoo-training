/**
 * 噗噗助手 AI 文案通道：调用 companion 云函数（混元大模型）生成/润色文案。
 * - 结果按 key 持久化缓存，同一场景不重复消耗 token
 * - 任何失败都静默返回 null，调用方回退到模板话术
 */

const CACHE_KEY = 'xipoo_companion_ai_cache'
const MAX_CACHE_ENTRIES = 150

function readCache() {
  try {
    return wx.getStorageSync(CACHE_KEY) || {}
  } catch (error) {
    return {}
  }
}

function writeCache(cache) {
  try {
    const keys = Object.keys(cache)
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys
        .sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
        .slice(0, keys.length - MAX_CACHE_ENTRIES)
        .forEach((key) => delete cache[key])
    }
    wx.setStorageSync(CACHE_KEY, cache)
  } catch (error) {
    // 存储失败不影响功能
  }
}

function polishKey(type, vars, lang) {
  return `polish:${lang === 'en' ? 'en' : 'zh'}:${type}:${JSON.stringify(vars || {})}`
}

function greetingKey(dateKeyStr, summary, lang) {
  return `greeting:${lang === 'en' ? 'en' : 'zh'}:${dateKeyStr}:${JSON.stringify(summary || {})}`
}

function getCachedPolish(type, vars, lang) {
  const hit = readCache()[polishKey(type, vars, lang)]
  return hit && hit.t ? hit.t : null
}

function getCachedGreeting(dateKeyStr, summary, lang) {
  const hit = readCache()[greetingKey(dateKeyStr, summary, lang)]
  return hit && hit.t ? hit.t : null
}

function callCompanion(action, payload) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('cloud unavailable'))
  }
  return wx.cloud.callFunction({
    name: 'companion',
    data: { action, payload }
  }).then((res) => {
    const result = (res && res.result) || {}
    if (!result.ok) throw new Error(result.message || 'companion ai failed')
    return result.data
  })
}

/**
 * 润色单条建议文案。命中缓存直接返回；失败返回 null（前端用模板兜底）。
 */
async function polishSuggestion(options) {
  const type = options.type
  const vars = options.vars || {}
  const lang = options.lang === 'en' ? 'en' : 'zh'
  const cached = getCachedPolish(type, vars, lang)
  if (cached) return cached
  try {
    const data = await callCompanion('polish', {
      type,
      vars,
      fallback: String(options.fallback || '').slice(0, 120),
      lang
    })
    const text = data && data.text ? String(data.text).trim() : ''
    if (!text) return null
    const cache = readCache()
    cache[polishKey(type, vars, lang)] = { t: text, ts: Date.now() }
    writeCache(cache)
    return text
  } catch (error) {
    return null
  }
}

/**
 * 面板顶部每日寄语。同一天同一上下文只生成一次。
 */
async function dailyGreeting(dateKeyStr, summary, lang) {
  const cached = getCachedGreeting(dateKeyStr, summary, lang)
  if (cached) return cached
  try {
    const data = await callCompanion('greeting', { summary: summary || {}, lang: lang === 'en' ? 'en' : 'zh' })
    const text = data && data.text ? String(data.text).trim() : ''
    if (!text) return null
    const cache = readCache()
    cache[greetingKey(dateKeyStr, summary, lang)] = { t: text, ts: Date.now() }
    writeCache(cache)
    return text
  } catch (error) {
    return null
  }
}

module.exports = {
  polishSuggestion,
  dailyGreeting,
  getCachedPolish,
  getCachedGreeting
}
