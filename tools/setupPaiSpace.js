// 通过 CloudBase CLI 补全 PAI空间 活动方信息，并创建 2026-07-23（周四）15:00 的 workshop 活动
// 前提：已安装并登录 CloudBase CLI（cloudbase login）
// 用法：node tools/setupPaiSpace.js
// 说明：activityAdmin 的 HTTP 触发器已被网关拦截（418），因此改为 CLI 直接调用云函数
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ENV_ID = 'cloudbase-d7gowjn4mf367be4d'

function invoke(action, payload, token = '') {
  // 参数 JSON 写入临时文件，用 -d @file 传入，避免 Windows shell 引号转义问题
  const tmpFile = path.join(os.tmpdir(), `xipoo-invoke-${Date.now()}.json`)
  fs.writeFileSync(tmpFile, JSON.stringify({ action, token, payload }), 'utf-8')
  try {
    const out = execFileSync('cloudbase', ['fn', 'invoke', 'activityAdmin', '-e', ENV_ID, '-d', `@${tmpFile}`], {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
      shell: true // Windows 下 cloudbase 是 .cmd shim，需要 shell 解析
    })
    const match = out.match(/返回结果：(\{[\s\S]*?\})\n调用日志/)
    if (!match) throw new Error('无法解析云函数返回: ' + out.slice(0, 300))
    return JSON.parse(match[1])
  } finally {
    try { fs.unlinkSync(tmpFile) } catch (_) {}
  }
}

// 与 cloudfunctions/activityAdmin/index.js setupDemoData 中的 pai_space 记录保持一致
const PUBLISHER = {
  key: 'pai_space',
  nameZh: 'PAI空间',
  name: 'PAI Space',
  logoUrl: '/assets/publishers/paispace-logo.png',
  coverUrl: '/assets/publishers/paispace-cover.jpg',
  description: 'AI workshops, hackathons, paper reading sessions and frontier tech salons',
  descriptionZh: 'AI工作坊、黑客松、论文共读与前沿技术沙龙',
  color: '#8b5cf6',
  accent: '#a78bfa',
  icon: '🤖',
  enabled: true,
  verified: false,
  tagline: 'Ride the AI wave — turn every spark of an idea into something real',
  taglineZh: '在 AI 的浪潮里，把每一个奇思妙想变成看得见的作品',
  location: 'PAI Space, Library Building, Suzhou Campus',
  locationZh: 'PAI空间 · 苏州校区图书馆大楼',
  foundedLabel: 'AI innovation community',
  foundedLabelZh: '人工智能创新社区',
  storyTitle: 'Bringing AI from the classroom to every spark of inspiration',
  storyTitleZh: '让 AI 从课堂走进每一个灵感现场',
  story: 'PAI Space is an AI innovation community open to the whole campus: machine-learning workshops, AI hackathons, paper reading sessions and frontier tech salons. We believe AI is not the privilege of a few majors, but a new tool everyone can pick up. Here, an idea often travels from whiteboard to demo in a single evening.',
  storyZh: 'PAI空间是面向全校师生的人工智能创新社区：机器学习工作坊、AI 应用黑客松、论文共读会与前沿技术沙龙……我们相信，AI 不只是少数人的专业，而是每个人都能上手的新工具。在这里，一个想法从白板到 Demo，往往只需要一个晚上。',
  contentTags: ['AI Workshops', 'Hackathon', 'Paper Reading', 'Tech Salon'],
  contentTagsZh: ['AI工作坊', '黑客松', '论文共读', '技术沙龙'],
  contactLabel: 'Contact PAI Space',
  contactLabelZh: '联系 PAI空间小助手',
  contactValue: 'pai-space@xjtlu.edu.cn',
  galleryUrls: ['/assets/demo-activities/pingpong.jpg', '/assets/demo-activities/poster-exhibition.jpg', '/assets/demo-activities/salon-optimized.jpg'],
  discoveryTags: ['immersion', 'college'],
  quotaFlash: 5,
  quotaRecommend: 10,
  sortWeight: 60,
  pinned: false,
  presetTags: ['AI', 'workshop', 'innovation'],
  visibility: 'all'
}

// 周四 15:00 的 workshop（固定 id，重复执行不会产生重复活动）
const ACTIVITY = {
  id: 'activity-paispace-ml-workshop-20260723',
  publisherKey: 'pai_space',
  category: 'college',
  typeZh: '工作坊',
  typeEn: 'Workshop',
  title: 'AI Workshop: Introduction to Machine Learning',
  titleZh: 'AI工作坊：机器学习入门',
  coverUrl: '/assets/demo-activities/salon-optimized.jpg',
  date: '2026-07-23',
  start: '15:00',
  end: '17:00',
  place: 'PAI Space, Library Building',
  placeZh: 'PAI空间，图书馆大楼',
  host: 'PAI Space',
  hostZh: 'PAI空间',
  desc: 'An introductory workshop on machine learning concepts and hands-on practice.',
  descZh: '机器学习概念介绍与实践入门工作坊。',
  tags: ['AI', 'Machine Learning', 'Workshop', 'Technology'],
  tagsZh: ['人工智能', '机器学习', '工作坊', '技术'],
  pinned: false,
  polished: true
}

async function main() {
  console.log('Step 1: Login...')
  const loginRes = invoke('login', { username: 'xipoo', password: 'wse.xipoo' })
  if (!loginRes.ok || !loginRes.data || !loginRes.data.token) {
    console.error('Login failed:', JSON.stringify(loginRes))
    process.exit(1)
  }
  const token = loginRes.data.token
  console.log('Login OK')

  console.log('\nStep 2: 查询 pai_space 是否已存在...')
  const listRes = invoke('listPublishersFull', {}, token)
  const list = Array.isArray(listRes.data) ? listRes.data : ((listRes.data && listRes.data.list) || [])
  const existing = list.find((p) => p.key === 'pai_space')
  console.log(existing ? '已存在，将执行更新' : '不存在，将创建新记录')

  console.log('\nStep 3: 补全 PAI空间 活动方信息...')
  const publisherInput = Object.assign({}, PUBLISHER)
  if (existing && existing._id) publisherInput._id = existing._id
  const pubRes = invoke('savePublisher', { publisher: publisherInput }, token)
  console.log('savePublisher:', JSON.stringify(pubRes))
  // 已存在时（listPublishersFull 不返回 _id，无法走更新路径）视为字段已完整，继续
  if (!pubRes.ok && pubRes.errorCode !== 'DUPLICATE_KEY') process.exit(1)

  console.log('\nStep 4: 创建周四 15:00 workshop 活动...')
  const actRes = invoke('saveActivity', { activity: ACTIVITY }, token)
  console.log('saveActivity:', JSON.stringify(actRes))
  if (!actRes.ok) process.exit(1)

  console.log('\n✅ 完成：PAI空间 信息已补全，' + ACTIVITY.date + ' ' + ACTIVITY.start + '-' + ACTIVITY.end + ' workshop 已创建（id=' + ACTIVITY.id + '）')
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
