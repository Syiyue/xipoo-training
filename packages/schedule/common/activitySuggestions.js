const { minutes } = require('./decisionView')

function pick(pool, offset) {
  return pool[offset % pool.length]
}

function timeOfDay(slot) {
  if (!slot) return 'unknown'
  const start = minutes(slot.start)
  if (start < 12 * 60) return 'morning'
  if (start < 17 * 60) return 'afternoon'
  return 'evening'
}

function normalizeSuggestion(item, index) {
  const estimatedMinutes = Math.max(30, Number(item && item.estimatedMinutes) || 0)
  return {
    id: String(item && item.id || `activity-${index + 1}`),
    title: String(item && item.title || '').slice(0, 24),
    reason: String(item && item.reason || '').slice(0, 58),
    estimatedMinutes,
    category: String(item && item.category || 'leisure').slice(0, 24)
  }
}

function validSuggestions(items, longestMinutes) {
  const list = (Array.isArray(items) ? items : []).map(normalizeSuggestion)
    .filter((item) => item.title && item.reason && item.estimatedMinutes <= Math.max(0, longestMinutes - 20))
  return list.length === 3 ? list : null
}

function getActivitySuggestions(context, variant = 0) {
  const slots = Array.isArray(context && context.sharedFreeSlots) ? context.sharedFreeSlots : []
  const longest = Number(context && context.longestSlotMinutes) || 0
  const participantCount = Math.max(1, Number(context && context.participantCount) || 1)
  const slot = slots.slice().sort((a, b) => Number(b.duration) - Number(a.duration))[0]
  // 至少预留 20 分钟缓冲；不足 50 分钟时不给出勉强可执行的活动建议。
  if (!slot || longest < 50) return []
  const relaxed = longest < 120
  const duration = Math.max(30, Math.min(longest - 20, relaxed ? 40 : (longest >= 300 ? 240 : (longest >= 180 ? 150 : 90))))
  const group = participantCount <= 2 ? '两人' : (participantCount === 3 ? '三人' : `${participantCount}人`)
  const period = timeOfDay(slot)
  const pools = relaxed
    ? [
        ['校园散步', `${group}有一小段共同时间，适合轻松走走聊聊天。`, 'walk'],
        ['买杯饮品', '时间不长，选择校内或附近饮品店更从容。', 'cafe'],
        ['短时乒乓球', '不需要复杂准备，适合在有限时间里活动一下。', 'sport']
      ]
    : longest < 180
      ? [
          ['咖啡或简餐', `${group}有约${Math.floor(longest / 60)}小时共同时间，安排一顿简餐比较合适。`, 'food'],
          ['校园散步', '留出一点缓冲后，仍能轻松完成一段校园散步。', 'walk'],
          ['乒乓球或羽毛球', '时间足够进行一场轻量运动，不会太赶。', 'sport']
        ]
      : longest < 300
        ? [
            ['桌游下午', `${group}有连续${Math.floor(longest / 60)}小时，适合完整玩一局桌游。`, 'boardgame'],
            ['羽毛球', '连续时间够用，运动后还能留出整理和返程缓冲。', 'sport'],
            ['看电影', period === 'evening' ? '傍晚时间适合安排一场电影和简单交流。' : '时段充足，可以选择一场电影作为主活动。', 'movie']
          ]
        : longest < 480
          ? [
              ['羽毛球加晚餐', `${group}有${Math.floor(longest / 60)}小时连续时间，运动后安排晚餐也不会匆忙。`, 'sport-food'],
              ['探店加桌游', '可在同一片区域完成用餐和桌游，行程节奏比较轻松。', 'food-boardgame'],
              ['商圈闲逛', '连续时间较长，适合逛店、用餐和轻娱乐组合。', 'leisure']
            ]
          : [
              ['展览加用餐', '全天共同时间充足，可以从容安排展览和用餐。', 'exhibition'],
              ['城市公园半日', '可安排步行、公园和用餐，仍能留出返程缓冲。', 'outdoor'],
              ['城区轻旅行', `${group}有较完整的日间时间，适合安排多环节休闲活动。`, 'city']
            ]
  return [0, 1, 2].map((index) => {
    const current = pick(pools, index + variant)
    return normalizeSuggestion({
      id: `local-${variant}-${index + 1}`,
      title: current[0],
      reason: current[1],
      estimatedMinutes: duration,
      category: current[2]
    }, index)
  })
}

module.exports = { getActivitySuggestions, validSuggestions, normalizeSuggestion }
