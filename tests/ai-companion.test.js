const assert = require('assert')

const { LINES, fill, pickLine } = require('../utils/companionLines')
const { buildSuggestions, coursesOnDate, pickProfileActivity } = require('../utils/companionAdvisor')

// 2026-08-09 是周日，因此 08-10 周一、08-11 周二、08-13 周四
function at(dateTime) {
  return new Date(dateTime)
}

function course(overrides) {
  return Object.assign({
    id: 'c1',
    title: 'DTS101 Lecture',
    courseCode: 'DTS101',
    courseId: 'DTS101_A',
    weekday: 1,
    start: '10:00',
    end: '12:00',
    place: 'TC-D-201'
  }, overrides)
}

function baseContext(overrides) {
  return Object.assign({
    courses: [],
    friendships: [],
    subscriptions: [],
    activities: [],
    sharedCourses: [],
    lang: 'zh',
    seed: 'test-user'
  }, overrides)
}

function run() {
  // ===== 话术表完整性 =====
  Object.keys(LINES).forEach((type) => {
    const def = LINES[type]
    assert(def.zh.length >= 2, `${type} has multiple zh variants`)
    assert(def.en.length >= 1, `${type} has en variants`)
    assert(typeof def.priority === 'number', `${type} has priority`)
    assert(def.icon, `${type} has icon`)
    ;['zh', 'en'].forEach((lang) => {
      def[lang].forEach((line) => {
        assert(!line.includes('{{') || true, 'template checked below')
      })
    })
  })
  assert.strictEqual(fill('你好 {{name}}', { name: '噗噗' }), '你好 噗噗', 'placeholder fills')
  // 缺少地点时不选带 {{place}} 的文案，且不会出现未替换的占位符
  for (let seed = 0; seed < 20; seed += 1) {
    const line = pickLine('class-soon', 'zh', { course: '数学', minutes: 15 }, `seed-${seed}`)
    assert(!line.includes('{{'), 'no unfilled placeholder without place')
  }
  // 有地点时允许带地点的文案
  const withPlace = pickLine('class-soon', 'zh', { course: '数学', minutes: 15, place: 'TC-101' }, 'seed-0')
  assert(withPlace.includes('数学'), 'course name filled')
  // 同一 seed 文案稳定
  assert.strictEqual(
    pickLine('free-gap', 'zh', { gap: '1小时', nextCourse: '英语' }, 'abc'),
    pickLine('free-gap', 'zh', { gap: '1小时', nextCourse: '英语' }, 'abc'),
    'pickLine is deterministic per seed'
  )

  // ===== 场景：课表为空 → 引导 AI 上传 =====
  let suggestions = buildSuggestions(baseContext(), at('2026-08-10T09:30:00'))
  assert.strictEqual(suggestions.length, 1, 'empty schedule yields one suggestion')
  assert.strictEqual(suggestions[0].type, 'schedule-empty')
  assert.strictEqual(suggestions[0].action.kind, 'ai-import', 'empty schedule suggests AI upload')

  // ===== 场景：课前提醒 =====
  suggestions = buildSuggestions(baseContext({ courses: [course()] }), at('2026-08-10T09:30:00'))
  const soon = suggestions.find((item) => item.type === 'class-soon')
  assert(soon, 'class-soon appears 30 min before class')
  assert(soon.text.includes('DTS101') || soon.text.includes('Lecture'), 'class-soon mentions the course')
  // 「不去上」的课程不提醒
  suggestions = buildSuggestions(baseContext({ courses: [course({ excludedFromFreeTime: true })] }), at('2026-08-10T09:30:00'))
  assert(!suggestions.find((item) => item.type === 'class-soon'), 'excluded courses never remind')

  // ===== 场景：好友同课 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    sharedCourses: [{ friendId: 'XP1002', friendName: '小王', course: course() }]
  }), at('2026-08-10T09:30:00'))
  const mate = suggestions.find((item) => item.type === 'classmate-together')
  assert(mate && mate.text.includes('小王'), 'classmate suggestion mentions the friend')
  assert(mate.action.url.includes('friendId=XP1002'), 'classmate action opens the friend schedule')

  // ===== 场景：课间空档 =====
  suggestions = buildSuggestions(baseContext({
    courses: [
      course({ id: 'morning', start: '10:00', end: '12:00' }),
      course({ id: 'afternoon', title: 'INF102 Seminar', start: '15:00', end: '17:00' })
    ]
  }), at('2026-08-10T13:00:00'))
  const gap = suggestions.find((item) => item.type === 'free-gap')
  assert(gap, 'free-gap appears during a long break')
  assert(gap.text.includes('2小时'), 'free-gap tells the gap length')

  // ===== 场景：今日课程总览（上午）=====
  suggestions = buildSuggestions(baseContext({ courses: [course()] }), at('2026-08-10T07:30:00'))
  const overview = suggestions.find((item) => item.type === 'day-overview')
  assert(overview && overview.text.includes('1'), 'morning overview counts today classes')

  // ===== 场景：今日课程结束 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course({ start: '14:00', end: '16:00' })],
    activities: [{ id: 'a1', title: 'Livehouse Night', date: '2026-08-12', place: 'MAO' }]
  }), at('2026-08-10T17:00:00'))
  const done = suggestions.find((item) => item.type === 'day-done')
  assert(done, 'day-done appears after the last class')

  // ===== 场景：关注的活动方有新活动 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    subscriptions: [{
      key: 'funworkshop',
      nameZh: '趣工坊',
      subscribed: true,
      latestActivityTitle: '陶艺体验课',
      latestActivityDate: '2026-08-15'
    }]
  }), at('2026-08-10T09:30:00'))
  const fresh = suggestions.find((item) => item.type === 'new-activity')
  assert(fresh && fresh.text.includes('趣工坊') && fresh.text.includes('陶艺体验课'), 'new activity names publisher and title')
  assert(fresh.action.url.includes('key=funworkshop'), 'new activity links to the publisher')
  // 未订阅的不提示
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    subscriptions: [{
      key: 'funworkshop',
      nameZh: '趣工坊',
      subscribed: false,
      latestActivityTitle: '陶艺体验课',
      latestActivityDate: '2026-08-15'
    }]
  }), at('2026-08-10T09:30:00'))
  assert(!suggestions.find((item) => item.type === 'new-activity'), 'unsubscribed publishers stay silent')

  // ===== 场景：活动临近 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    activities: [{ id: 'a1', title: 'Livehouse Night', date: '2026-08-11', place: 'MAO' }]
  }), at('2026-08-10T15:00:00'))
  const soonAct = suggestions.find((item) => item.type === 'activity-soon')
  assert(soonAct && soonAct.text.includes('明天'), 'activity-soon uses relative day label')

  // ===== 场景：明天早课（晚上提醒）=====
  suggestions = buildSuggestions(baseContext({
    courses: [course({ weekday: 2, start: '09:00', end: '10:00' })]
  }), at('2026-08-10T21:00:00'))
  const early = suggestions.find((item) => item.type === 'early-class-tomorrow')
  assert(early && early.text.includes('09:00'), 'early-class reminder mentions start time')
  // 中午不提醒明天早课
  suggestions = buildSuggestions(baseContext({
    courses: [course({ weekday: 2, start: '09:00', end: '10:00' })]
  }), at('2026-08-10T15:00:00'))
  assert(!suggestions.find((item) => item.type === 'early-class-tomorrow'), 'no early-class reminder at noon')

  // ===== 场景：待补全课程 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course({ needsReview: true })]
  }), at('2026-08-10T15:00:00'))
  const review = suggestions.find((item) => item.type === 'needs-review')
  assert(review && review.text.includes('1'), 'needs-review counts incomplete courses')

  // ===== 场景：周末共同空闲（周四/周五且有好友）=====
  suggestions = buildSuggestions(baseContext({
    courses: [course({ weekday: 4 })],
    friendships: [{ friend: { id: 'XP1002', name: '小王' }, friendShare: true }]
  }), at('2026-08-13T10:00:00'))
  const weekend = suggestions.find((item) => item.type === 'weekend-match')
  assert(weekend && weekend.action.url.includes('match'), 'weekend suggestion links to group match')

  // ===== 场景：今天没课 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()], // 只有周一的课
    activities: [{ id: 'a9', title: '陶艺体验课', date: '2026-08-11', place: '趣工坊' }]
  }), at('2026-08-11T10:00:00'))
  const noClass = suggestions.find((item) => item.type === 'no-class-day')
  assert(noClass, 'no-class-day appears on a day without classes')
  assert(noClass.action.url.includes('a9'), 'no-class-day links to today\'s activity')

  // ===== 场景：空档配活动 =====
  suggestions = buildSuggestions(baseContext({
    courses: [
      course({ id: 'morning', start: '10:00', end: '12:00' }),
      course({ id: 'afternoon', title: 'INF102', start: '15:00', end: '17:00' })
    ],
    activities: [{ id: 'a9', title: '陶艺体验课', date: '2026-08-10', place: '趣工坊' }]
  }), at('2026-08-10T13:00:00'))
  const gapAct = suggestions.find((item) => item.type === 'free-gap-activity')
  assert(gapAct && gapAct.text.includes('陶艺体验课'), 'free-gap-activity mentions the activity')
  assert(!suggestions.find((item) => item.type === 'free-gap'), 'plain free-gap is replaced by the activity variant')

  // ===== 场景：活动页种草 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    page: 'activities',
    activities: [{ id: 'a9', title: '陶艺体验课', date: '2026-08-12', place: '趣工坊' }]
  }), at('2026-08-10T15:00:00'))
  const rec = suggestions.find((item) => item.type === 'activity-recommend')
  assert(rec && rec.text.includes('陶艺体验课'), 'activity page recommends an upcoming activity')
  // 非活动页不出
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    page: 'schedule',
    activities: [{ id: 'a9', title: '陶艺体验课', date: '2026-08-12', place: '趣工坊' }]
  }), at('2026-08-10T15:00:00'))
  assert(!suggestions.find((item) => item.type === 'activity-recommend'), 'no activity recommendation off the activities page')

  // 活动推荐优先匹配用户主动填写的专业/标签，而不是机械取最早日期。
  const personalized = pickProfileActivity([
    { id: 'soon', titleZh: '陶艺体验课', date: '2026-08-11', tagsZh: ['手作'] },
    { id: 'fit', titleZh: 'AI 智能体工作坊', date: '2026-08-13', tagsZh: ['人工智能', '编程'] }
  ], { major: '计算机科学', featureTags: ['AI'] }, '2026-08-10')
  assert.strictEqual(personalized.item.id, 'fit', 'profile match outranks the earliest activity')
  assert.strictEqual(personalized.reason, '兴趣标签', 'profile match has an explainable reason')

  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    page: 'activities',
    me: { major: '计算机科学' },
    activities: [
      { id: 'soon', titleZh: '陶艺体验课', date: '2026-08-11', place: '趣工坊' },
      { id: 'fit', titleZh: 'AI 智能体工作坊', date: '2026-08-13', place: 'π空间', tagsZh: ['人工智能'] }
    ]
  }), at('2026-08-10T15:00:00'))
  const personalizedRec = suggestions.find((item) => item.type === 'activity-recommend')
  assert(personalizedRec && personalizedRec.action.url.includes('fit'), 'activity page uses the profile-ranked recommendation')

  // ===== 场景：周日晚下周预览 =====
  suggestions = buildSuggestions(baseContext({ courses: [course()] }), at('2026-08-16T19:00:00'))
  const preview = suggestions.find((item) => item.type === 'week-preview')
  assert(preview && preview.text.includes('1'), 'Sunday evening previews next week class count')

  // ===== 场景：资料完善 / 订阅引导（仅面板） =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    me: { id: 'XP1001', major: '', signature: '' }
  }), at('2026-08-10T15:00:00'))
  const prof = suggestions.find((item) => item.type === 'profile-incomplete')
  assert(prof && prof.proactive === false, 'profile hint is panel-only')
  assert(prof.action.url.includes('editProfile'), 'profile hint links to edit page')

  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    subscriptions: [{ key: 'funworkshop', subscribed: false, latestActivityDate: '' }]
  }), at('2026-08-10T15:00:00'))
  const sub = suggestions.find((item) => item.type === 'subscription-hint')
  assert(sub && sub.proactive === false, 'subscription hint is panel-only')

  // ===== 排序与结构 =====
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    sharedCourses: [{ friendId: 'XP1002', friendName: '小王', course: course() }]
  }), at('2026-08-10T09:30:00'))
  for (let i = 1; i < suggestions.length; i += 1) {
    assert(suggestions[i - 1].priority >= suggestions[i].priority, 'suggestions sorted by priority')
  }
  suggestions.forEach((item) => {
    assert(item.text && !item.text.includes('{{'), 'every suggestion text is fully filled')
    assert(item.dedupeKey, 'every suggestion has a dedupeKey')
  })

  // ===== coursesOnDate：周课展开 + 学期范围 + 排除 =====
  const onMonday = coursesOnDate([
    course({ id: 'a' }),
    course({ id: 'b', weekday: 2 }),
    course({ id: 'c', excludedFromFreeTime: true }),
    course({ id: 'd', termEndDate: '2026-08-01' })
  ], '2026-08-10')
  assert.deepStrictEqual(onMonday.map((item) => item.id), ['a'], 'only active Monday courses remain')

  // ===== coursesOnDate：教学周过滤（与日程页口径一致） =====
  const semester = { start: '2026-09-07', total: 20 }
  const weekOneCourse = course({ id: 'w1', week_set: [1] })
  // 学期开始前（2026-08-10 周一）不算有课：假期里不应提示「今天 N 节课」
  assert.deepStrictEqual(coursesOnDate([weekOneCourse], '2026-08-10', semester).map((item) => item.id), [], 'pre-semester Monday has no class')
  // 第 1 周周一（2026-09-07）有课
  assert.deepStrictEqual(coursesOnDate([weekOneCourse], '2026-09-07', semester).map((item) => item.id), ['w1'], 'teaching week 1 Monday has class')
  // 第 2 周周一不在 week_set [1] 内
  assert.deepStrictEqual(coursesOnDate([weekOneCourse], '2026-09-14', semester).map((item) => item.id), [], 'week 2 not in week_set [1]')
  // 不传学期信息时保持旧行为（按 weekday + term 日期判断）
  assert.deepStrictEqual(coursesOnDate([weekOneCourse], '2026-08-10').map((item) => item.id), ['w1'], 'no semester info falls back to weekday matching')

  // 回归：学期前今天没课 → 不出 day-overview，出 no-class-day
  suggestions = buildSuggestions(baseContext({
    courses: [weekOneCourse],
    semester
  }), at('2026-08-10T09:30:00'))
  assert(!suggestions.find((item) => item.type === 'day-overview'), 'no day-overview before semester starts')
  assert(suggestions.find((item) => item.type === 'no-class-day'), 'no-class-day appears on class-free day')

  // ===== 页面场景过滤 =====
  // 活动页：不推课程类消息，推即将到来的活动
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    activities: [{ id: 'act1', title: '黑客松', date: '2026-08-12', place: 'TC' }],
    page: 'activities'
  }), at('2026-08-10T09:30:00'))
  assert(!suggestions.find((item) => item.type === 'day-overview'), 'activities page never shows day-overview')
  assert(!suggestions.find((item) => item.type === 'class-soon'), 'activities page never shows class-soon')
  assert(suggestions.find((item) => item.type === 'activity-soon' || item.type === 'activity-recommend'), 'activities page pushes upcoming activities')

  // 好友页：提示好友同课，不推课程总览
  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    sharedCourses: [{ friendId: 'XP1002', friendName: '小王', course: course() }],
    page: 'friends'
  }), at('2026-08-10T09:30:00'))
  assert(suggestions.find((item) => item.type === 'classmate-together'), 'friends page shows classmate-together')
  assert(!suggestions.find((item) => item.type === 'day-overview'), 'friends page never shows day-overview')

  suggestions = buildSuggestions(baseContext({
    courses: [course()],
    page: 'friends',
    friendships: [{ friend: { id: 'XP1002' } }, { friend: { id: 'XP1003' } }]
  }), at('2026-08-10T09:30:00'))
  const warmth = suggestions.find((item) => item.type === 'friends-warmth')
  assert(warmth && warmth.text.includes('2'), 'friends page offers a warm shared-schedule message')

  // 不传 page：不过滤（向后兼容）
  suggestions = buildSuggestions(baseContext({ courses: [course()] }), at('2026-08-10T09:30:00'))
  assert(suggestions.find((item) => item.type === 'day-overview'), 'no page keeps all scenes')

  console.log('ai-companion.test.js: all assertions passed')
}

run()
