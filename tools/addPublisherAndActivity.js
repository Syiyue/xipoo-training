const cloud = require('wx-server-sdk')

cloud.init({
  env: 'cloudbase-d7gowjn4mf367be4d'
})

const db = cloud.database()

async function addPublisher() {
  const publisherData = {
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
    visibility: 'all',
    createdBy: 'admin',
    updatedBy: 'admin',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }

  try {
    const exist = await db.collection('activity_publishers').where({ key: 'pai_space' }).count()
    if (exist.total > 0) {
      console.log('Publisher pai_space already exists, updating...')
      const res = await db.collection('activity_publishers').where({ key: 'pai_space' }).update({ data: publisherData })
      console.log('Publisher updated:', res)
    } else {
      const res = await db.collection('activity_publishers').add({ data: publisherData })
      console.log('Publisher created:', res)
    }
  } catch (e) {
    console.error('Error adding publisher:', e)
    throw e
  }
}

async function addActivity() {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7
  const thursday = new Date(today)
  thursday.setDate(today.getDate() + daysUntilThursday)
  
  const dateStr = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`
  
  const activityData = {
    id: `activity-${Date.now()}`,
    publisherKey: 'pai_space',
    category: 'college',
    typeZh: '工作坊',
    typeEn: 'Workshop',
    title: 'AI Workshop: Introduction to Machine Learning',
    titleZh: 'AI工作坊：机器学习入门',
    coverUrl: '/assets/demo-activities/salon-optimized.jpg',
    time: `${dateStr} 15:00-17:00`,
    date: dateStr,
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
    scheduleTag: `${dateStr} 15:00-17:00 AI工作坊：机器学习入门`,
    pinned: false,
    polished: true,
    shareCount: 0,
    likeCount: 0,
    joinCount: 0,
    comments: [],
    updatedBy: 'admin',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }

  try {
    const res = await db.collection('activities').doc(activityData.id).set({ data: activityData })
    console.log('Activity created:', res)
    console.log('Date:', dateStr)
  } catch (e) {
    console.error('Error adding activity:', e)
    throw e
  }
}

async function main() {
  console.log('Adding PAI Space publisher...')
  await addPublisher()
  
  console.log('\nAdding new workshop activity...')
  await addActivity()
  
  console.log('\nDone!')
}

main().catch(e => {
  console.error('Main error:', e)
  process.exit(1)
})
