/**
 * 噗噗助手建议引擎：读取课程 / 活动订阅 / 好友上下文，产出场景化建议。
 * 纯函数、不依赖 wx，方便单测；时间由调用方传入。
 * 场景话术见 utils/companionLines.js，场景清单见 docs/ai-companion.md。
 */

const { LINES, pickLine } = require('./companionLines')
const { normalizeCourseWeeks } = require('./courseWeeks')

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toMinutes(time) {
  const parts = String(time || '00:00').split(':')
  return Number(parts[0]) * 60 + Number(parts[1] || 0)
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

/** 日期对应的教学周（1-based）；学期外返回 null。与日程页 weekNumberForDate 口径一致，但不截断到学期内。 */
function teachingWeekOf(dateStr, semesterStart, totalWeeks) {
  if (!semesterStart) return null
  const start = new Date(`${semesterStart}T00:00:00`)
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return null
  const week = Math.floor((target - start) / (7 * 24 * 3600 * 1000)) + 1
  const total = Number(totalWeeks) || 20
  if (week < 1 || week > total) return null
  return week
}

function courseOccursOn(course, date, semester) {
  if (course.date === date) return true
  if (!course.weekday) return false
  const target = new Date(`${date}T00:00:00`)
  const weekday = target.getDay() === 0 ? 7 : target.getDay()
  if (Number(course.weekday) !== weekday) return false
  // 与日程页 courseBelongsToWeek 一致：声明了教学周的课程只在教学周内重复，
  // 学期开始前/结束后的日期不算有课（否则假期里也会提示「今天 N 节课」）
  const weeks = normalizeCourseWeeks(course)
  if (weeks.length && semester && semester.start) {
    const week = teachingWeekOf(date, semester.start, semester.total)
    return week !== null && weeks.includes(week)
  }
  if (course.termStartDate && date < course.termStartDate) return false
  if (course.termEndDate && date > course.termEndDate) return false
  return true
}

/** 某天实际要上的课（「不去上」的课程不参与提醒），按开始时间排序。 */
function coursesOnDate(courses, date, semester) {
  return (courses || [])
    .filter((course) => !course.excludedFromFreeTime)
    .filter((course) => courseOccursOn(course, date, semester))
    .filter((course) => course.start && course.end)
    .slice()
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
}

function formatGap(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}分钟`
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`
}

function dayLabel(dateStr, now, lang) {
  const today = dateKey(now)
  const tomorrow = dateKey(addDays(now, 1))
  if (dateStr === today) return lang === 'en' ? 'today' : '今天'
  if (dateStr === tomorrow) return lang === 'en' ? 'tomorrow' : '明天'
  return dateStr
}

function activityText(item) {
  return [
    item && item.title, item && item.titleZh, item && item.titleEn,
    item && item.type, item && item.typeZh, item && item.typeEn,
    item && item.host, item && item.hostZh, item && item.hostEn,
    item && item.desc, item && item.descZh, item && item.descEn,
    ...((item && item.tags) || []), ...((item && item.tagsZh) || []), ...((item && item.tagsEn) || [])
  ].filter(Boolean).join(' ').toLowerCase()
}

// 只使用用户主动填写的专业和标签，在端上做轻量匹配；不上传资料给推荐接口。
function profileKeywords(me) {
  if (!me) return []
  const values = [me.major, ...(me.featureTags || []), ...(me.tags || []), ...(me.selectedTags || [])]
  return Array.from(new Set(values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 2 && value.length <= 40)))
}

function majorSignals(major) {
  const value = String(major || '').toLowerCase()
  if (/计算机|软件|人工智能|电子|通信|芯片|半导体|computer|software|ai|mse|electronic/.test(value)) {
    return ['ai', '人工智能', '编程', '技术', '科技', '芯片', '半导体', '创新']
  }
  if (/商|金融|经济|管理|business|finance|econom/.test(value)) {
    return ['创业', '商业', '金融', '管理', '职业', 'career', 'business']
  }
  if (/设计|艺术|传媒|建筑|design|art|media|architecture/.test(value)) {
    return ['设计', '艺术', '展览', '摄影', '创意', 'design', 'art']
  }
  if (/生物|医学|健康|心理|bio|medical|health|psych/.test(value)) {
    return ['健康', '医疗', '心理', '生命', 'health', 'wellbeing']
  }
  return []
}

function pickProfileActivity(activities, me, today) {
  const keywords = profileKeywords(me)
  const signals = majorSignals(me && me.major)
  const future = (activities || []).filter((item) => item && item.id && item.date && item.date >= today)
  if (!future.length) return null
  const scored = future.map((item) => {
    const text = activityText(item)
    const tagHit = keywords.some((keyword) => text.includes(keyword))
    const majorHit = !tagHit && signals.some((signal) => text.includes(signal))
    return {
      item,
      score: (tagHit ? 20 : 0) + (majorHit ? 10 : 0),
      reason: tagHit ? '兴趣标签' : (majorHit ? '专业方向' : '')
    }
  })
  scored.sort((left, right) => (
    right.score - left.score || String(left.item.date).localeCompare(String(right.item.date))
  ))
  return scored[0]
}

/**
 * context: {
 *   courses, friendships, subscriptions, activities,
 *   sharedCourses: [{ friendId, friendName, course }],
 *   lang, seed
 * }
 * now: Date
 * 返回按优先级降序的建议数组。
 */
function buildSuggestions(context, now) {
  const lang = context.lang === 'en' ? 'en' : 'zh'
  const today = dateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const suggestions = []

  const push = (type, vars, extra) => {
    const def = LINES[type]
    if (!def) return
    const options = extra || {}
    suggestions.push({
      type,
      icon: def.icon,
      priority: def.priority,
      proactive: def.proactive !== false,
      cooldownHours: def.cooldownHours || 0,
      vars: vars || {},
      text: pickLine(type, lang, vars || {}, `${context.seed || ''}|${type}|${options.dedupe || today}`),
      dedupeKey: `${type}:${options.dedupe || today}`,
      action: options.action || null
    })
  }

  const courses = Array.isArray(context.courses) ? context.courses : []
  const friendships = Array.isArray(context.friendships) ? context.friendships : []
  const subscriptions = Array.isArray(context.subscriptions) ? context.subscriptions : []
  const activities = Array.isArray(context.activities) ? context.activities : []
  const sharedCourses = Array.isArray(context.sharedCourses) ? context.sharedCourses : []

  // 当前命中的场景（供推广卡片 sceneTags 匹配）
  const activeScenes = new Set()
  if (nowMinutes >= 11 * 60 && nowMinutes <= 13 * 60) activeScenes.add('lunch')
  if (nowMinutes >= 17 * 60 && nowMinutes <= 19 * 60 + 30) activeScenes.add('dinner')

  // 1. 课表为空：引导 AI 上传
  if (!courses.length) {
    push('schedule-empty', {}, {
      dedupe: 'empty',
      action: { kind: 'ai-import' }
    })
    return suggestions.sort((a, b) => b.priority - a.priority)
  }

  const todayCourses = coursesOnDate(courses, today, context.semester)

  // 2. 课前提醒：45 分钟内开课
  const upcoming = todayCourses.find((course) => {
    const diff = toMinutes(course.start) - nowMinutes
    return diff > 0 && diff <= 45
  })
  if (upcoming) {
    activeScenes.add('class-soon')
    push('class-soon', {
      course: upcoming.title || upcoming.courseCode || '',
      place: upcoming.place || '',
      minutes: toMinutes(upcoming.start) - nowMinutes
    }, {
      dedupe: `${upcoming.id}:${today}`,
      action: { kind: 'switchTab', url: '/pages/schedule/schedule' }
    })
  }

  // 3. 好友同课（sharedCourses 由调用方异步补全）
  sharedCourses.forEach((item) => {
    push('classmate-together', {
      course: item.course.title || item.course.courseCode || '',
      friend: item.friendName
    }, {
      dedupe: `${item.course.id}:${item.friendId}:${today}`,
      action: { kind: 'navigate', url: `/packages/schedule/pages/friendSchedule/friendSchedule?friendId=${item.friendId}` }
    })
  })

  // 4. 当前正处于课间空档（≥60 分钟）
  if (!upcoming) {
    const current = todayCourses.find((course) => (
      toMinutes(course.start) <= nowMinutes && nowMinutes < toMinutes(course.end)
    ))
    if (!current) {
      const next = todayCourses.find((course) => toMinutes(course.start) > nowMinutes)
      if (next) {
        const previous = todayCourses.filter((course) => toMinutes(course.end) <= nowMinutes).pop()
        if (previous) {
          const gap = toMinutes(next.start) - nowMinutes
          if (gap >= 60) {
            activeScenes.add('free-gap')
            const gapText = lang === 'en' ? `${Math.floor(gap / 60)}h${gap % 60 ? ` ${gap % 60}m` : ''}` : formatGap(gap)
            const todayActivity = activities.find((item) => item.date === today)
            if (todayActivity) {
              // 空档正好配今天的活动：比干巴巴的「空档提醒」更有用
              push('free-gap-activity', {
                gap: gapText,
                activity: todayActivity.titleZh || todayActivity.title || ''
              }, {
                dedupe: `${next.id}:${todayActivity.id}:${today}`,
                action: { kind: 'navigate', url: `/packages/activity/pages/activityDetail/activityDetail?id=${todayActivity.id}` }
              })
            } else {
              push('free-gap', {
                gap: gapText,
                nextCourse: next.title || next.courseCode || ''
              }, {
                dedupe: `${next.id}:${today}`
              })
            }
          }
        }
      }
    }
  }

  // 5. 今日课程总览（上午）
  if (nowMinutes < 12 * 60 && todayCourses.length > 0) {
    push('day-overview', { count: todayCourses.length }, {
      dedupe: today,
      action: { kind: 'switchTab', url: '/pages/schedule/schedule' }
    })
  }

  // 6. 今日课程结束
  if (todayCourses.length > 0 && nowMinutes < 22 * 60) {
    const lastEnd = Math.max(...todayCourses.map((course) => toMinutes(course.end)))
    if (lastEnd <= nowMinutes) {
      activeScenes.add('day-done')
      const soonActivity = activities.find((item) => item.date && item.date >= today)
      push('day-done', soonActivity ? { activity: soonActivity.titleZh || soonActivity.title || '' } : {}, {
        dedupe: today,
        action: soonActivity
          ? { kind: 'navigate', url: `/packages/activity/pages/activityDetail/activityDetail?id=${soonActivity.id}` }
          : null
      })
    }
  }

  // 7. 关注的活动方有新活动（未来 10 天内举办）
  const activityHorizon = dateKey(addDays(now, 10))
  subscriptions
    .filter((item) => item.subscribed && item.latestActivityDate && item.latestActivityDate >= today && item.latestActivityDate <= activityHorizon)
    .slice(0, 2)
    .forEach((publisher) => {
      push('new-activity', {
        publisher: publisher.nameZh || publisher.name || '',
        activity: publisher.latestActivityTitle,
        date: publisher.latestActivityDate
      }, {
        dedupe: `${publisher.key}:${publisher.latestActivityDate}`,
        action: { kind: 'navigate', url: `/packages/activity/pages/activityPublisher/activityPublisher?key=${publisher.key}` }
      })
    })

  // 8. 已订阅活动临近（48 小时内）
  activities
    .filter((item) => item.date && item.date >= today && item.date <= dateKey(addDays(now, 2)))
    .slice(0, 2)
    .forEach((activity) => {
      push('activity-soon', {
        activity: activity.titleZh || activity.title || '',
        day: dayLabel(activity.date, now, lang),
        place: activity.place || ''
      }, {
        dedupe: `${activity.id}:${today}`,
        action: { kind: 'navigate', url: `/packages/activity/pages/activityDetail/activityDetail?id=${activity.id}` }
      })
    })

  // 9. 明天早课（20 点后提醒）
  if (nowMinutes >= 20 * 60) {
    const tomorrow = dateKey(addDays(now, 1))
    const tomorrowCourses = coursesOnDate(courses, tomorrow, context.semester)
    const first = tomorrowCourses[0]
    if (first && toMinutes(first.start) <= 10 * 60) {
      push('early-class-tomorrow', {
        time: first.start,
        course: first.title || first.courseCode || ''
      }, {
        dedupe: tomorrow
      })
    }
  }

  // 10. AI 导入有待补全课程
  const reviewCount = courses.filter((course) => course.needsReview).length
  if (reviewCount > 0) {
    push('needs-review', { count: reviewCount }, {
      dedupe: today,
      action: { kind: 'navigate', url: '/packages/schedule/pages/settings/settings?focus=aiImports' }
    })
  }

  // 11. 周末共同空闲（周四/周五提示）
  const weekday = now.getDay()
  if ((weekday === 4 || weekday === 5) && friendships.length > 0) {
    activeScenes.add('weekend')
    push('weekend-match', {}, {
      dedupe: today,
      action: { kind: 'navigate', url: '/packages/schedule/pages/match/match' }
    })
  }

  // 今天没课（18 点前提示），顺带安利一个今天的活动
  if (courses.length > 0 && todayCourses.length === 0 && nowMinutes < 18 * 60) {
    const todayActivity = activities.find((item) => item.date === today)
    push('no-class-day', todayActivity ? { activity: todayActivity.titleZh || todayActivity.title || '' } : {}, {
      dedupe: today,
      action: todayActivity
        ? { kind: 'navigate', url: `/packages/activity/pages/activityDetail/activityDetail?id=${todayActivity.id}` }
        : { kind: 'switchTab', url: '/pages/activities/activities' }
    })
  }

  // 活动页专属：种草一个 7 天内的活动
  if (context.page === 'activities') {
    const horizon = dateKey(addDays(now, 7))
    const recommendation = pickProfileActivity(
      activities.filter((item) => item.date && item.date <= horizon),
      context.me,
      today
    )
    const candidate = recommendation && recommendation.item
    if (candidate) {
      push('activity-recommend', {
        activity: candidate.titleZh || candidate.title || '',
        day: dayLabel(candidate.date, now, lang),
        place: candidate.place || '',
        reason: recommendation.reason
      }, {
        dedupe: `${candidate.id}:${today}`,
        action: { kind: 'navigate', url: `/packages/activity/pages/activityDetail/activityDetail?id=${candidate.id}` }
      })
    }
  }

  // 共享页除了功能引导，也给已有联系人一个不打扰的暖心提示。
  if (context.page === 'friends' && friendships.length > 0) {
    push('friends-warmth', { count: friendships.length }, { dedupe: today })
  }

  // 周日晚上：下周课表预览
  if (now.getDay() === 0 && nowMinutes >= 18 * 60 && courses.length > 0) {
    let count = 0
    let earliest = null
    for (let i = 1; i <= 7; i += 1) {
      const dayCourses = coursesOnDate(courses, dateKey(addDays(now, i)), context.semester)
      count += dayCourses.length
      if (!earliest && dayCourses.length) earliest = dayCourses[0]
    }
    if (count > 0) {
      push('week-preview', { count, time: earliest ? earliest.start : '' }, { dedupe: today })
    }
  }

  // 资料完善提示（仅面板）
  const me = context.me
  if (me && (!me.major || !me.signature)) {
    push('profile-incomplete', {}, {
      dedupe: today,
      action: { kind: 'navigate', url: '/packages/account/pages/editProfile/editProfile' }
    })
  }

  // 订阅引导（仅面板）
  if (subscriptions.length > 0 && !subscriptions.some((item) => item.subscribed)) {
    push('subscription-hint', {}, {
      dedupe: today,
      action: { kind: 'switchTab', url: '/pages/activities/activities' }
    })
  }

  // 12. 推广卡片（后台投放）：场景命中才可主动弹气泡，通用卡片只进面板；
  // 永远排在有机建议之后（priority 20），close 黑名单在端上过滤
  const adBlocklist = new Set(Array.isArray(context.adBlocklist) ? context.adBlocklist : [])
  const ads = (Array.isArray(context.ads) ? context.ads : [])
    .filter((ad) => ad && ad.id && ad.copy && !adBlocklist.has(ad.id))
    .slice(0, 2)
  ads.forEach((ad) => {
    const sceneTags = Array.isArray(ad.sceneTags) ? ad.sceneTags : []
    const hitScene = sceneTags.find((tag) => activeScenes.has(tag)) || ''
    suggestions.push({
      type: 'promotion',
      icon: ad.icon || '🐙',
      priority: 20,
      proactive: Boolean(hitScene),
      cooldownHours: 24,
      vars: {},
      text: (lang === 'en' && ad.copyEn) ? ad.copyEn : ad.copy,
      dedupeKey: `promotion:${ad.id}:${today}`,
      action: ad.action || null,
      adId: ad.id,
      isPromotion: true,
      scene: hitScene
    })
  })

  // 按所在页面过滤场景：活动页只推活动相关、好友页只推搭子相关、
  // 日程页只推课程相关，避免在活动页弹「今天 N 节课」这类跨页打扰。
  // 推广卡片（isPromotion）不受页面限制；profile 页不过滤。
  const PAGE_TYPES = {
    schedule: ['schedule-empty', 'class-soon', 'classmate-together', 'free-gap', 'free-gap-activity',
      'day-overview', 'day-done', 'early-class-tomorrow', 'needs-review', 'no-class-day', 'week-preview'],
    activities: ['schedule-empty', 'activity-recommend', 'activity-soon', 'new-activity', 'subscription-hint'],
    friends: ['schedule-empty', 'classmate-together', 'weekend-match', 'friends-warmth']
  }
  const allowlist = context.page ? PAGE_TYPES[context.page] : null
  const filtered = allowlist
    ? suggestions.filter((item) => item.isPromotion || allowlist.includes(item.type))
    : suggestions

  return filtered.sort((a, b) => b.priority - a.priority)
}

module.exports = {
  buildSuggestions,
  pickProfileActivity,
  coursesOnDate,
  courseOccursOn,
  dateKey,
  toMinutes
}
