/**
 * 噗噗助手话术表：每个场景多条文案轮换，支持 {{var}} 占位符。
 * - priority: 数值越大越优先展示
 * - proactive: 是否允许主动弹气泡（false 只在面板里展示）
 * - cooldownHours: 同一 dedupeKey 主动弹出的最小间隔（0 = 每次新 key 都可弹）
 * - icon: 面板卡片图标
 * 新增场景时在 docs/ai-companion.md 同步登记。
 */

const LINES = {
  'class-soon': {
    priority: 100,
    proactive: true,
    cooldownHours: 0,
    icon: '⏰',
    zh: [
      '「{{course}}」还有 {{minutes}} 分钟就开始啦，教室在 {{place}}，现在过去刚刚好～',
      '噗噗提醒：{{minutes}} 分钟后是「{{course}}」，地点 {{place}}，别迟到哦！',
      '马上要上「{{course}}」了（{{place}}），收拾一下出发吧～',
      '{{minutes}} 分钟后上课：「{{course}}」，书本水杯别落下！',
      '「{{course}}」还有 {{minutes}} 分钟就开始啦，别迟到哦～'
    ],
    en: [
      '"{{course}}" starts in {{minutes}} min at {{place}} — time to head over!',
      'Pupu reminder: "{{course}}" in {{minutes}} min ({{place}}). Don\'t be late!',
      '"{{course}}" starts in {{minutes}} min — don\'t be late!'
    ]
  },
  'classmate-together': {
    priority: 90,
    proactive: true,
    cooldownHours: 0,
    icon: '🧑‍🤝‍🧑',
    zh: [
      '这节「{{course}}」，{{friend}} 也一起上！要不要约着一起去？',
      '噗噗发现 {{friend}} 也在上「{{course}}」，可以搭个伴呀～',
      '「{{course}}」有熟人！{{friend}} 和你同一节，下课还能一起走。'
    ],
    en: [
      '{{friend}} is in your "{{course}}" class too — go together?',
      'Pupu spotted {{friend}} in "{{course}}" as well. Buddy up!'
    ]
  },
  'new-activity': {
    priority: 80,
    proactive: true,
    cooldownHours: 72,
    icon: '📣',
    zh: [
      '你关注的{{publisher}}发新活动啦：「{{activity}}」，{{date}} 举行，去看看？',
      '噗噗播报：{{publisher}}有新活动「{{activity}}」（{{date}}），别错过报名！',
      '新活动上线～{{publisher}}的「{{activity}}」定在{{date}}，感兴趣就 mark 一下。'
    ],
    en: [
      '{{publisher}} posted a new event: "{{activity}}" on {{date}}. Check it out!',
      'New from {{publisher}}: "{{activity}}" ({{date}}). Don\'t miss it!'
    ]
  },
  'activity-soon': {
    priority: 70,
    proactive: true,
    cooldownHours: 24,
    icon: '🎪',
    zh: [
      '「{{activity}}」{{day}}就要开始啦，地点{{place}}，记得留出时间～',
      '倒计时提醒：{{day}}的「{{activity}}」，噗噗已经帮你记着了！',
      '「{{activity}}」{{day}}开始，别忘了哦～'
    ],
    en: [
      '"{{activity}}" is {{day}} at {{place}} — save the time!',
      'Countdown: "{{activity}}" {{day}}. Pupu is keeping track for you.',
      '"{{activity}}" is {{day}} — don\'t forget!'
    ]
  },
  'needs-review': {
    priority: 65,
    proactive: true,
    cooldownHours: 24,
    icon: '📝',
    zh: [
      '上次导入的课表还有 {{count}} 节课缺信息，抽空补全一下吧～',
      '噗噗整理课表时发现 {{count}} 节课需要确认，点我去补全。'
    ],
    en: [
      '{{count}} imported classes are missing details — tap to complete them.',
      'Pupu found {{count}} classes needing confirmation. Finish them up?'
    ]
  },
  'early-class-tomorrow': {
    priority: 60,
    proactive: true,
    cooldownHours: 0,
    icon: '🌙',
    zh: [
      '明天 {{time}} 就有「{{course}}」，今晚早点休息哦，晚安～',
      '噗噗查了下：明早 {{time}} 有课，别熬夜啦！'
    ],
    en: [
      '"{{course}}" at {{time}} tomorrow morning — get some rest tonight!',
      'Heads up: first class tomorrow is at {{time}}. Don\'t stay up late!'
    ]
  },
  'free-gap': {
    priority: 50,
    proactive: true,
    cooldownHours: 6,
    icon: '☕',
    zh: [
      '接下来空 {{gap}}，去喝杯咖啡还是图书馆坐会儿？',
      '「{{nextCourse}}」之前还有 {{gap}} 的空档，放松一下刚刚好。',
      '现在是自由活动时间～{{gap}} 后才是下一节课。'
    ],
    en: [
      'You have {{gap}} free — coffee break or library?',
      '{{gap}} until "{{nextCourse}}". Perfect time to recharge.'
    ]
  },
  'day-overview': {
    priority: 45,
    proactive: true,
    cooldownHours: 0,
    icon: '🌤️',
    zh: [
      '早上好呀！今天有 {{count}} 节课，噗噗帮你盯着时间。',
      '今天一共 {{count}} 节课，加油！课间记得喝水哦～',
      '新的一天开始啦，{{count}} 节课安排好了，有需要随时戳我。'
    ],
    en: [
      'Good morning! {{count}} classes today — Pupu is watching the clock for you.',
      '{{count}} classes on today\'s schedule. You\'ve got this!'
    ]
  },
  'day-done': {
    priority: 40,
    proactive: true,
    cooldownHours: 0,
    icon: '🎉',
    zh: [
      '今天的课都上完啦，辛苦辛苦！剩下的时间都是你自己的。',
      '课程打卡完成～晚上好好放松一下！',
      '下课啦！对了，「{{activity}}」快开始了，有兴趣可以去看看。'
    ],
    en: [
      'All classes done for today — the rest of the day is yours!',
      'Classes wrapped up! By the way, "{{activity}}" is starting soon.'
    ]
  },
  'weekend-match': {
    priority: 35,
    proactive: true,
    cooldownHours: 24,
    icon: '🗓️',
    zh: [
      '周末要到啦，去看看你和朋友们哪天都有空吧～',
      '想约人出去玩？噗噗可以帮你算大家的共同空闲哦！'
    ],
    en: [
      'Weekend is coming — see when you and your friends are all free!',
      'Planning a hangout? Pupu can find everyone\'s shared free time.'
    ]
  },
  'friends-warmth': {
    priority: 38,
    proactive: true,
    cooldownHours: 24,
    icon: '💜',
    zh: [
      '你已经和 {{count}} 位同学连上啦。分享一点日程，约见就会更容易一些～',
      '有人一起惦记时间，生活就多一点从容。去看看大家最近的安排吧～'
    ],
    en: [
      'You are connected with {{count}} classmates. A little schedule sharing makes plans easier.',
      'It feels good to have people to make time for. See what your friends are up to.'
    ]
  },
  'schedule-empty': {
    priority: 30,
    proactive: true,
    cooldownHours: 12,
    icon: '📷',
    zh: [
      '还没有课表哦～点我拍张照，10 秒帮你生成整学期课表！',
      '噗噗的触手闲不住啦，快上传课表，让我帮你安排每一天！'
    ],
    en: [
      'No schedule yet — tap me, snap a photo, and get your timetable in 10 seconds!',
      'Pupu\'s tentacles are idle! Upload your schedule and let me organize your days.'
    ]
  },
  'no-class-day': {
    priority: 55,
    proactive: true,
    cooldownHours: 0,
    icon: '🌈',
    zh: [
      '今天没有课！自由安排的一天，要不去活动页看看有什么好玩的？',
      '噗噗播报：今天 0 节课～出去玩还是泡图书馆，你说了算！',
      '今天没课哦，「{{activity}}」可以考虑一下～'
    ],
    en: [
      'No classes today! A free day — check out what\'s happening on the Activities page?',
      'Pupu report: 0 classes today. Your time, your call!',
      'No classes today — how about "{{activity}}"?'
    ]
  },
  'free-gap-activity': {
    priority: 56,
    proactive: true,
    cooldownHours: 6,
    icon: '🎯',
    zh: [
      '接下来空 {{gap}}，「{{activity}}」就在今天，正好去逛逛！',
      '空档 {{gap}} 别浪费～「{{activity}}」今天有场次，约吗？'
    ],
    en: [
      'You have {{gap}} free — "{{activity}}" is on today. Perfect fit!',
      '{{gap}} to spare — "{{activity}}" happens today. Go check it out!'
    ]
  },
  'activity-recommend': {
    priority: 52,
    proactive: true,
    cooldownHours: 24,
    icon: '💡',
    zh: [
      '给你种草：「{{activity}}」{{day}}举行，地点{{place}}～',
      '噗噗严选：{{day}}的「{{activity}}」，感兴趣就报个名？',
      '给你种草：「{{activity}}」{{day}}举行，别错过哦～',
      '这场「{{activity}}」和你的{{reason}}很搭，{{day}}去看看？'
    ],
    en: [
      'Pupu picks: "{{activity}}" {{day}} at {{place}}.',
      'Worth a look: "{{activity}}" {{day}} — grab a spot?',
      'Pupu picks: "{{activity}}" {{day}}. Don\'t miss it!',
      '"{{activity}}" fits your {{reason}} well. Take a look {{day}}.'
    ]
  },
  'week-preview': {
    priority: 45,
    proactive: true,
    cooldownHours: 0,
    icon: '🗓️',
    zh: [
      '下周一共 {{count}} 节课，最早 {{time}} 开始。今晚早点休息，新的一周冲鸭！',
      '噗噗看了眼下周课表：{{count}} 节课在等你，提前规划起来吧～'
    ],
    en: [
      'Next week: {{count}} classes, earliest at {{time}}. Rest up tonight — you\'ve got this!',
      'Pupu peeked at next week: {{count}} classes ahead. Plan early!'
    ]
  },
  'profile-incomplete': {
    priority: 25,
    proactive: false,
    cooldownHours: 72,
    icon: '✏️',
    zh: [
      '你的资料还差点意思～补全专业和签名，好友一眼认出你。',
      '噗噗小贴士：完善个人资料，共享日程、找搭子都更顺利哦。'
    ],
    en: [
      'Your profile is almost there — add your major and bio so friends recognize you.',
      'Pupu tip: a complete profile makes sharing and buddy matching smoother.'
    ]
  },
  'subscription-hint': {
    priority: 25,
    proactive: false,
    cooldownHours: 72,
    icon: '🔔',
    zh: [
      '还没关注活动方哦～关注之后，新活动噗噗第一时间告诉你。',
      '活动页藏着不少宝藏主办方，关注几个试试？'
    ],
    en: [
      'No organizers followed yet — follow some and Pupu will ping you about new events.',
      'There are great organizers on the Activities page. Follow a few?'
    ]
  }
}

/** 模板占位符替换；缺失变量时该条文案不可用（由 pickLine 过滤）。 */
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (
    vars && vars[key] !== undefined && vars[key] !== '' ? String(vars[key]) : match
  ))
}

function templateVars(template) {
  const found = []
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => { found.push(key); return _ })
  return found
}

function hashSeed(text) {
  let hash = 0
  const str = String(text || '')
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * 从场景话术里挑一条：先按可用变量过滤（如教室为空就不选带 {{place}} 的），
 * 再按 seed 稳定选取，避免同一场景每次刷新文案乱跳。
 */
function pickLine(type, lang, vars, seed) {
  const def = LINES[type]
  if (!def) return ''
  const pool = def[lang === 'en' ? 'en' : 'zh'] || def.zh
  const usable = pool.filter((line) => templateVars(line).every((key) => (
    vars && vars[key] !== undefined && vars[key] !== null && vars[key] !== ''
  )))
  const candidates = usable.length ? usable : pool
  return fill(candidates[hashSeed(seed) % candidates.length], vars || {})
}

/**
 * 环境气泡：不需要任何上下文的轻松碎嘴，按时段取用。
 * 只用于端上随机冒泡，不走 AI、不参与冷却。
 */
const AMBIENT = {
  morning: {
    zh: [
      '早上好呀，今天也要元气满满～',
      '噗噗刚伸了个懒腰，你呢？',
      '早！喝口水再开始新的一天吧',
      '咕噜咕噜，早上好的泡泡送给你'
    ],
    en: [
      'Good morning! Make today count~',
      'Pupu just had a big stretch. You?',
      'Morning! Hydrate before the day begins.'
    ]
  },
  afternoon: {
    zh: [
      '咕噜咕噜～噗噗在吐泡泡玩',
      '困了就站起来活动一下哦',
      '下午好！劳逸结合效率更高',
      '记得喝水！噗噗的贴心提醒',
      '偷偷告诉你：噗噗的触手有八只，数过的'
    ],
    en: [
      'Glug glug~ Pupu is blowing bubbles.',
      'Sleepy? Stand up and stretch a bit.',
      'Good afternoon! Balance work and rest.',
      'Hydration check! A caring reminder from Pupu.'
    ]
  },
  evening: {
    zh: [
      '晚上好～今天辛苦了',
      '晚饭吃什么好呢，噗噗帮你纠结一下',
      '夜幕降临，噗噗还在岗哦',
      '今天的你也辛苦了，给自己点个赞'
    ],
    en: [
      'Good evening — you did great today.',
      'What\'s for dinner? Pupu is deliberating too.',
      'Night falls, Pupu is still on duty.'
    ]
  }
}

function ambientLine(hour, lang) {
  const part = hour < 11 ? 'morning' : (hour < 18 ? 'afternoon' : 'evening')
  const pool = (AMBIENT[part] && AMBIENT[part][lang === 'en' ? 'en' : 'zh']) || AMBIENT.afternoon.zh
  return pool[Math.floor(Math.random() * pool.length)]
}

module.exports = {
  LINES,
  AMBIENT,
  ambientLine,
  fill,
  pickLine
}
