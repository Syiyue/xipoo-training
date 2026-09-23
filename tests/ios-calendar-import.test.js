const assert = require('assert')
const fs = require('fs')
const path = require('path')

const schedulePage = fs.readFileSync(path.join(__dirname, '../pages/schedule/schedule.js'), 'utf8')
const bridgeJs = fs.readFileSync(path.join(__dirname, '../pages/schedule/ics-bridge/ics-bridge.js'), 'utf8')
const bridgeWxml = fs.readFileSync(path.join(__dirname, '../pages/schedule/ics-bridge/ics-bridge.wxml'), 'utf8')

assert(schedulePage.includes("fileType: 'ics'"), 'iOS must open the downloaded ICS file')
assert(schedulePage.includes('showMenu: true'), 'iOS document preview must expose the system share menu')
assert(schedulePage.includes("/pages/schedule/ics-bridge/ics-bridge?icsUrl="), 'iOS must retain a Safari-link fallback')
assert(!bridgeWxml.includes('<web-view'), 'the fallback page must not rely on a web-view opening Safari')
assert(bridgeJs.includes('wx.setClipboardData'), 'the fallback page must copy the actual ICS HTTPS link')

console.log('ios-calendar-import.test.js: all assertions passed')
