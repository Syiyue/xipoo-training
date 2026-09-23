const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'cloudfunctions/activityAdmin/index.js'), 'utf8')
const document = fs.readFileSync(path.join(root, 'docs/admin-data-api.md'), 'utf8')

// 新接口必须经过 action 分发和明确的权限检查，不能只靠后台页面隐藏入口。
for (const action of ['getRegistrationOverview', 'listUsers', 'listActivityRegistrations']) {
  assert.ok(source.includes(`case '${action}'`), `${action} 应接入云函数 action 分发`)
  assert.ok(document.includes(`\`${action}\``), `${action} 应写入后台接口文档`)
}

assert.ok(source.includes("return fail(ERROR_CODES.FORBIDDEN, '仅总管理员可查看注册用户')"), '用户目录必须仅总管理员可见')
assert.ok(source.includes('canReadActivityData(account)'), '报名数据必须校验活动方范围')
assert.ok(source.includes('canManagePublisher(account, key)'), '活动方门面保存必须校验管理范围')
assert.ok(source.includes('sanitizeAdminUser(user)'), '用户响应必须经过脱敏处理')
assert.ok(document.includes('不要在列表或详情接口中增加'), '文档应禁止在接口中增加敏感字段')
assert.ok(document.includes('不含 openid、手机号、微信号等敏感字段'), '文档应声明敏感字段验收要求')

console.log('activity-admin-data-api.test.js: all assertions passed')
