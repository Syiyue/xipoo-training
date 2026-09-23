const assert = require('assert')

const storage = new Map()
global.wx = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  },
  removeStorageSync(key) {
    storage.delete(key)
  }
}

const backend = require('../utils/mockBackend')

function login(phone) {
  return backend.login({ phone, password: '123456' })
}

function courseIdFor(userId) {
  return `course-${userId.toLowerCase()}-cct007`
}

function enableBuddy(userId, wechat, tags) {
  return backend.setCourseBuddyOptIn(courseIdFor(userId), {
    buddyWechatId: wechat,
    tags,
    availabilityStart: '16:00',
    availabilityEnd: '18:00',
    bio: `${userId} buddy profile`,
    consent: true
  })
}

async function run() {
  login('13800000001')
  enableBuddy('XP1001', 'sien_xipoo', ['作业', '项目组队'])

  let candidates = backend.getCourseBuddyCandidates(courseIdFor('XP1001'))
  assert.strictEqual(candidates.length, 2, 'only opted-in exact-course users should be visible')
  assert(candidates.every((item) => item.profile.buddyWechatId), 'visible candidates expose buddy WeChat ID')

  const db = storage.get('xipoo_mock_db')
  const jingyiCourse = db.schedules.XP1003[0]
  const originalStart = jingyiCourse.start
  jingyiCourse.start = '14:00'
  storage.set('xipoo_mock_db', db)
  candidates = backend.getCourseBuddyCandidates(courseIdFor('XP1001'))
  assert.strictEqual(candidates.length, 1, 'different class time must not enter the candidate pool')
  jingyiCourse.start = originalStart
  storage.set('xipoo_mock_db', db)

  const teamA = backend.createCourseTeam({
    courseId: courseIdFor('XP1001'),
    title: 'CCT007 project team A',
    goal: 'Finish the term project',
    tags: ['项目组队'],
    maxMembers: 2,
    deadline: '2099-01-01T00:00:00+08:00',
    requirements: 'Weekly progress review'
  })

  login('13800000003')
  const teamB = backend.createCourseTeam({
    courseId: courseIdFor('XP1003'),
    title: 'CCT007 project team B',
    goal: 'Prepare for the final',
    tags: ['考试'],
    maxMembers: 3,
    deadline: '2099-01-01T00:00:00+08:00',
    requirements: ''
  })

  login('13800000002')
  assert.strictEqual(
    backend.searchUsers('XP1003')[0].buddyWechatId,
    undefined,
    'general user search must not expose buddy WeChat ID'
  )
  backend.applyCourseTeam(teamA.id, { message: 'Join A' })
  backend.applyCourseTeam(teamB.id, { message: 'Join B' })

  login('13800000001')
  const ownedTeam = backend.getCourseTeams(courseIdFor('XP1001')).find((item) => item.id === teamA.id)
  backend.acceptCourseTeamApplication(ownedTeam.applications[0].id)
  const filledTeam = backend.getCourseTeam(teamA.id)
  assert.strictEqual(filledTeam.status, 'full', 'team closes when member limit is reached')
  assert.strictEqual(filledTeam.memberCount, 2, 'member limit includes creator')

  login('13800000002')
  const applicantTeams = backend.getCourseTeams(courseIdFor('XP1002'))
  assert.strictEqual(
    applicantTeams.find((item) => item.id === teamB.id).myApplicationStatus,
    'withdrawn',
    'acceptance withdraws other applications for the same course'
  )

  backend.blockUser('XP1003')
  candidates = backend.getCourseBuddyCandidates(courseIdFor('XP1002'))
  assert(!candidates.some((item) => item.id === 'XP1003'), 'blocked users are mutually hidden')

  backend.reportUser('XP1003', { reason: 'inappropriate profile' })
  assert(
    storage.get('xipoo_mock_db').riskEvents.some((item) => item.type === 'user_report'),
    'reports create a risk-control event'
  )

  backend.removeCourseBuddyOptIn(courseIdFor('XP1002'))
  assert.throws(
    () => backend.getCourseBuddyCandidates(courseIdFor('XP1002')),
    /开启/,
    'leaving the pool immediately removes matching access'
  )

  console.log('buddy-matching.test.js: all assertions passed')
}

run()
