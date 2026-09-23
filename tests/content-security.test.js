// 内容安全接入回归测试
// 场景：msgSecCheck/imgSecCheck 返回 87014 时拦截并返回统一文案；
//       其他错误（超时/系统忙等）放行，避免微信侧故障导致全站写入不可用
const assert = require('assert')
const fs = require('fs')
const path = require('path')

// ---- mock wx-server-sdk（云函数内的 wx-server-sdk 依赖在云端环境才有） ----
let msgSecCheckErr = null
let imgSecCheckErr = null
let lastMsgSecCheckParams = null

const fakeCloud = {
  openapi: {
    security: {
      async msgSecCheck(params) {
        lastMsgSecCheckParams = params
        if (msgSecCheckErr) throw msgSecCheckErr
        return { errCode: 0 }
      },
      async imgSecCheck() {
        if (imgSecCheckErr) throw imgSecCheckErr
        return { errCode: 0 }
      }
    }
  },
  async downloadFile() {
    return { fileContent: Buffer.from('fake-image') }
  }
}

const Module = require('module')
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeCloud
  return originalLoad.apply(this, arguments)
}

const secCheck = require('../cloudfunctions/user/secCheck')

async function main() {
  // ---- 1. 文本违规（87014）→ 拦截 ----
  msgSecCheckErr = { errCode: 87014, errMsg: 'risky content' }
  assert.strictEqual(await secCheck.isTextRisky('openid-1', ['违规昵称'], 1), true, '87014 应判定违规')

  const resp = secCheck.contentRisky()
  assert.strictEqual(resp.ok, false, '拦截响应 ok=false')
  assert.strictEqual(resp.errorCode, 'CONTENT_RISKY', '统一错误码 CONTENT_RISKY')
  assert.ok(resp.message.includes('违规信息'), '文案仅提示含违规信息')
  assert.ok(!resp.message.includes('87014'), '文案不得暴露错误码细节')

  // ---- 2. msgSecCheck v2 参数约定 ----
  msgSecCheckErr = null
  await secCheck.isTextRisky('openid-1', ['正常文本'], 3)
  assert.strictEqual(lastMsgSecCheckParams.version, 2, '应使用 version=2')
  assert.strictEqual(lastMsgSecCheckParams.openid, 'openid-1', '应传 openid')
  assert.strictEqual(lastMsgSecCheckParams.scene, 3, '应传 scene')

  // ---- 3. 接口故障（非 87014）→ 放行 ----
  msgSecCheckErr = { errCode: -1, errMsg: 'system error' }
  assert.strictEqual(await secCheck.isTextRisky('openid-1', ['任意文本'], 2), false, '系统错误应放行')
  msgSecCheckErr = new Error('network timeout')
  assert.strictEqual(await secCheck.isTextRisky('openid-1', ['任意文本'], 2), false, '网络异常应放行')
  msgSecCheckErr = null

  // ---- 4. 空内容不调用接口 ----
  lastMsgSecCheckParams = null
  assert.strictEqual(await secCheck.isTextRisky('openid-1', ['', '  ', null, undefined], 2), false, '空内容直接放行')
  assert.strictEqual(lastMsgSecCheckParams, null, '空内容不应调用 msgSecCheck')

  // ---- 5. joinParts 拼接与截断 ----
  assert.strictEqual(secCheck.joinParts(['a', '', 'b', null]), 'a\nb', '忽略空值并以换行拼接')
  const long = secCheck.joinParts(['x'.repeat(3000)])
  assert.strictEqual(long.length, 2500, '超长截断到 2500 字')

  // ---- 6. 图片检测 ----
  assert.strictEqual(await secCheck.isImageRisky('https://example.com/a.jpg'), false, '非 cloud:// 不检测')
  imgSecCheckErr = { errCode: 87014, errMsg: 'risky image' }
  assert.strictEqual(await secCheck.isImageRisky('cloud://env/avatars/a.jpg'), true, '87014 图片应判定违规')
  imgSecCheckErr = { errCode: 87015, errMsg: 'query timeout' }
  assert.strictEqual(await secCheck.isImageRisky('cloud://env/avatars/a.jpg'), false, '图片接口超时应放行')
  imgSecCheckErr = null

  // ---- 7. 6 个云函数的 secCheck.js 副本保持一致 ----
  const canonical = fs.readFileSync(path.join(__dirname, '../cloudfunctions/user/secCheck.js'), 'utf8')
  for (const fn of ['buddy', 'match', 'activity', 'friend', 'schedule']) {
    const copy = fs.readFileSync(path.join(__dirname, `../cloudfunctions/${fn}/secCheck.js`), 'utf8')
    assert.strictEqual(copy, canonical, `${fn}/secCheck.js 应与 user/secCheck.js 一致`)
  }

  // ---- 8. 各云函数 action 覆盖核对（源码级别） ----
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  const buddySrc = read('cloudfunctions/buddy/index.js')
  for (const action of ['createBuddyPost', 'createCourseTeam', 'applyBuddyPost', 'applyCourseTeam',
    'createBuddyMatchRequest', 'setCourseBuddyOptIn', 'setBuddyOptIn', 'submitFeedback', 'reportUser']) {
    assert.ok(buddySrc.includes(action), `buddy 应覆盖 ${action}`)
  }
  const matchSrc = read('cloudfunctions/match/index.js')
  assert.ok(matchSrc.includes('createPost') && matchSrc.includes('joinPost'), 'match 应覆盖 createPost/joinPost')
  const activitySrc = read('cloudfunctions/activity/index.js')
  assert.ok(activitySrc.includes('commentActivity'), 'activity 应覆盖 commentActivity')
  const friendSrc = read('cloudfunctions/friend/index.js')
  assert.ok(friendSrc.includes('sendRequest') && friendSrc.includes('setFriendNote'), 'friend 应覆盖 sendRequest/setFriendNote')
  const scheduleSrc = read('cloudfunctions/schedule/index.js')
  assert.ok(scheduleSrc.includes('upsertSchedule') && scheduleSrc.includes('upsertSchedulesBatch'), 'schedule 应覆盖 upsert 系列')
  for (const fn of ['user', 'buddy', 'match', 'activity', 'friend', 'schedule']) {
    assert.ok(read(`cloudfunctions/${fn}/index.js`).includes("require('./secCheck')"), `${fn}/index.js 应引用 secCheck`)
    const cfg = JSON.parse(read(`cloudfunctions/${fn}/config.json`))
    assert.ok(cfg.permissions && cfg.permissions.openapi.includes('security.msgSecCheck'), `${fn} config.json 应声明 msgSecCheck 权限`)
    assert.ok(cfg.permissions.openapi.includes('security.imgSecCheck'), `${fn} config.json 应声明 imgSecCheck 权限`)
  }

  console.log('content-security.test.js: all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
