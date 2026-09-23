const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const settings = fs.readFileSync(path.join(root, 'packages/schedule/pages/settings/settings.js'), 'utf8')
const schedule = fs.readFileSync(path.join(root, 'pages/schedule/schedule.js'), 'utf8')

assert(settings.includes("const cachedCourses = app.getCached && app.getCached('schedules')"), 'history detail should render cached courses first')
assert(settings.includes('api.getSchedule().then((courses)'), 'course refresh should run independently')
assert(settings.includes('api.getAiImportVerificationImage(batch).then(async (verification)'), 'verification image should load independently')
assert(settings.includes('_importDetailRequestToken'), 'stale detail requests should not overwrite the current record')
assert(schedule.includes("verificationImagePath: this._aiImportImagePath || ''"), 'recognition result should show the local source image immediately')
assert(schedule.includes('正在生成核验标注图…'), 'recognition result should explain annotated-image loading')
assert(schedule.includes('禁止回退到主课程周次'), 'expanded sessions must not inherit parent teaching weeks')

console.log('ai-import-loading.test.js: all assertions passed')
