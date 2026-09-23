/**
 * courseIcs 云函数 — 课程表导出 iCalendar (.ics) + 云存储上传
 *
 * 流程：
 *   ① 接收 courses 数组 → 参数校验
 *   ② generateIcsLocal 生成标准 ICS（UTC 世界统一格式）
 *   ③ 写入 /tmp 临时文件
 *   ④ cloud.uploadFile 上传到微信云存储
 *   ⑤ cloud.getTempFileURL 获取 HTTPS 公开下载链接
 *   ⑥ 返回 { fileID, downloadUrl, courseCount }
 *
 * 调用：
 *   wx.cloud.callFunction({ name: 'courseIcs', data: { courses: [...] } })
 *
 * 返回：
 *   { ok: true, data: { fileID, downloadUrl, cloudPath, courseCount } }
 */

var cloud = require('wx-server-sdk')
var fs = require('fs')
var generateCourseIcs = require('./generateIcsLocal').generateCourseIcs

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// Basic abuse protection. This is intentionally conservative and local to a
// warm function instance; platform-level rate limiting should still be enabled
// in production where available.
var recentCalls = new Map()
var RATE_WINDOW_MS = 60 * 1000
var RATE_LIMIT = 10

// ─── 参数校验 ────────────────────────────────────────

function validateCourse(course, index) {
  var errors = []
  var prefix = '第 ' + (index + 1) + ' 门课程'
  if (!course || typeof course !== 'object') {
    return { valid: false, errors: [prefix + ': 课程数据无效'] }
  }
  if (!course.title || !String(course.title).trim()) {
    errors.push(prefix + ': 缺少课程名称')
  }
  var w = Number(course.weekday)
  if (!Number.isInteger(w) || w < 1 || w > 7) {
    errors.push(prefix + ': weekday 必须为 1-7')
  }
  if (!course.startTime || !/^\d{1,2}:\d{2}$/.test(String(course.startTime))) {
    errors.push(prefix + ': startTime 格式错误')
  }
  if (!course.endTime || !/^\d{1,2}:\d{2}$/.test(String(course.endTime))) {
    errors.push(prefix + ': endTime 格式错误')
  }
  var wt = String(course.weekType || 'all').toLowerCase()
  if (['all', 'odd', 'even'].indexOf(wt) === -1) {
    errors.push(prefix + ': weekType 只能为 all/odd/even')
  }
  var ws = Number(course.weekStart)
  var we = Number(course.weekEnd)
  if (!Number.isInteger(ws) || ws < 1) errors.push(prefix + ': weekStart 必须为正整数')
  if (!Number.isInteger(we) || we < 1) errors.push(prefix + ': weekEnd 必须为正整数')
  if (Number.isInteger(ws) && Number.isInteger(we) && ws > we) {
    errors.push(prefix + ': weekStart > weekEnd')
  }
  return { valid: errors.length === 0, errors: errors }
}

function validateCourses(courses) {
  if (!Array.isArray(courses)) return { valid: false, errors: ['courses 必须是数组'] }
  if (courses.length === 0) return { valid: false, errors: ['课程列表不能为空'] }
  if (courses.length > 200) return { valid: false, errors: ['单次最多导出 200 门'] }

  var allErrors = []
  courses.forEach(function (course, i) {
    var r = validateCourse(course, i)
    if (!r.valid) allErrors = allErrors.concat(r.errors)
  })
  return { valid: allErrors.length === 0, errors: allErrors }
}

// ─── 云函数入口 ──────────────────────────────────────

exports.main = async function (event, context) {
  var t0 = Date.now()

  try {
    var wxContext = cloud.getWXContext ? cloud.getWXContext() : {}
    var openid = wxContext && wxContext.OPENID
    if (!openid) return { ok: false, errorCode: 'NOT_LOGIN', message: '请先登录后导出课表' }
    var now = Date.now()
    var previous = recentCalls.get(openid) || []
    previous = previous.filter(function (timestamp) { return now - timestamp < RATE_WINDOW_MS })
    if (previous.length >= RATE_LIMIT) {
      return { ok: false, errorCode: 'RATE_LIMITED', message: '导出请求过于频繁，请稍后再试' }
    }
    previous.push(now)
    recentCalls.set(openid, previous)
    // ── 解析请求 ──
    var courses
    if (Array.isArray(event.courses)) {
      courses = event.courses
    } else if (event.body) {
      var b = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
      courses = b.courses
    } else if (Array.isArray(event)) {
      courses = event
    } else {
      return { ok: false, errorCode: 'INVALID_PARAM', message: '请求格式错误' }
    }

    // ── 校验 ──
    var v = validateCourses(courses)
    if (!v.valid) {
      return { ok: false, errorCode: 'VALIDATION_ERROR', message: '校验失败', errors: v.errors }
    }

    // ── ① 生成 ICS 文本 ──
    var ics = generateCourseIcs(courses)
    console.log('[courseIcs] ICS 生成完成, ' + ics.length + ' 字符')

    // ── ② 写入临时文件 ──
    var tmpName = 'xipoo_' + Date.now() + '.ics'
    var tmpPath = '/tmp/' + tmpName
    fs.writeFileSync(tmpPath, ics, 'utf-8')

    // ── ③ 上传云存储 ──
    // 关键：显式声明 Content-Type 为 text/calendar + UTF-8。
    // 否则 COS 按 .ics 默认返回 application/octet-stream，iOS WebView/WKWebView
    // 会把 .ics 当纯文本渲染（源码乱码展示），且不会唤起 Safari 的日历导入弹窗。
    var uploadRes = await cloud.uploadFile({
      cloudPath: 'ics-exports/' + tmpName,
      fileContent: fs.readFileSync(tmpPath),
      // 兼容不同 wx-server-sdk / COS SDK 对 header 键名大小写的处理差异，
      // 同时写大小写两种 key，确保任意版本都能正确识别 Content-Type。
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'Content-Type': 'text/calendar; charset=utf-8'
      }
    })
    if (!uploadRes || !uploadRes.fileID) {
      throw new Error('云存储上传失败')
    }
    var fileID = uploadRes.fileID
    console.log('[courseIcs] 上传成功, 用户=' + String(openid).slice(0, 4) + '..., 文件大小=' + Buffer.byteLength(ics, 'utf8'))

    // ── ④ 获取 HTTPS 下载链接 ──
    var urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
    var downloadUrl = ''
    if (urlRes && urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) {
      downloadUrl = urlRes.fileList[0].tempFileURL
    }

    // ── ⑤ 清理临时文件 ──
    try { fs.unlinkSync(tmpPath) } catch (_) {}

    console.log('[courseIcs] 完成, 课程=' + courses.length + ', 耗时=' + (Date.now() - t0) + 'ms')

    return {
      ok: true,
      data: {
        fileID: fileID,
        downloadUrl: downloadUrl,
        cloudPath: 'ics-exports/' + tmpName,
        contentType: 'text/calendar; charset=utf-8',
        courseCount: courses.length
      }
    }
  } catch (err) {
    console.error('[courseIcs] 失败:', err)
    return {
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || '服务器内部错误'
    }
  }
}
