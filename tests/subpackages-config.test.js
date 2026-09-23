const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'))
const rootProjectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'project.config.json'), 'utf8'))
const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'project.config.json'), 'utf8'))

assert.deepEqual(app.pages, [
  'pages/schedule/schedule',
  'pages/schedule/ics-bridge/ics-bridge',
  'pages/activities/activities',
  'pages/friends/friends',
  'pages/profile/profile',
  'pages/login/login'
])
assert.equal(app.subPackages.length, 4)
assert.equal(app.permission, undefined)
assert.equal(app.requiredPrivateInfos, undefined)
assert.equal(rootProjectConfig.miniprogramRoot, 'main/')

const ignoredPaths = new Set(projectConfig.packOptions.ignore.map((entry) => entry.value))
for (const ignoredPath of ['cloudfunctions', '.cloudbase', '.vscode', 'shared', 'utils/cloudApi.js', 'utils/config.js']) {
  assert.ok(ignoredPaths.has(ignoredPath), `missing pack ignore: ${ignoredPath}`)
}

for (const subpackage of app.subPackages) {
  assert.ok(subpackage.root)
  assert.ok(fs.statSync(path.join(__dirname, '..', subpackage.root)).isDirectory())
  assert.ok(subpackage.pages.length > 0)
  for (const page of subpackage.pages) {
    assert.ok(page.startsWith('pages/'), `subpackage page must live under pages/: ${page}`)
    const pagePath = path.join(__dirname, '..', subpackage.root, `${page}.js`)
    assert.ok(fs.existsSync(pagePath), `missing subpackage page: ${pagePath}`)
  }
}

console.log('subpackages-config.test.js: all assertions passed')
