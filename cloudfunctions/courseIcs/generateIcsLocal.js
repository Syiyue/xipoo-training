/**
 * generateIcsLocal.js — iCalendar (RFC 5545) 生成器（云函数最终版）
 *
 * 日历兼容关键：
 *   ① UTC 绝对时间 — DTSTART/DTEND 用 Z 后缀（北京时间减 8 小时转 UTC，
 *      中国无夏令时，偏移恒定）。系统日历据此正确显示北京本地时间与 UTC 标签，
 *      不再数值互换；00:00–07:59 的课程会跨日回退到前一天。
 *   ② 确定性 UID — 纯课程数据 + termStart，同一课程重复导入时会更新而非叠加
 *   ③ SEQUENCE:0 + TRANSP:OPAQUE
 *   ④ RRULE 仅 COUNT
 *
 * 输入：courses [{title,weekday,weekStart,weekEnd,weekType,startTime,endTime,termStart,...}]
 * 输出：标准 .ics 文本 (UTF-8, CRLF 行尾)
 */

var PRODID = '-//Xipoo//Course Schedule//ZH'

// ─── 工具函数 ────────────────────────────────────────
function hash(str) {
  var h = 5381
  for (var i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h = h & h }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}
function pDate(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate())
  var s = String(v || '').trim(); if (!s) return null
  var d = new Date(s.replace(/\//g, '-') + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addD(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r }
function fDt(d) { return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') }
function fTm(t) { var p = String(t || '00:00').split(':'); return String(parseInt(p[0], 10) || 0).padStart(2, '0') + String(parseInt(p[1], 10) || 0).padStart(2, '0') + '00' }
function fSt() { var n = new Date(); return '' + n.getUTCFullYear() + String(n.getUTCMonth() + 1).padStart(2, '0') + String(n.getUTCDate()).padStart(2, '0') + 'T' + String(n.getUTCHours()).padStart(2, '0') + String(n.getUTCMinutes()).padStart(2, '0') + String(n.getUTCSeconds()).padStart(2, '0') + 'Z' }
function esc(v) { return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '') }

// ─── 确定性 UID ──────────────────────────────────────
function uid(c, ts) {
  return hash([
    esc(c.title || 'course'), esc(c.location || c.place || ''),
    esc(c.teacher || ''), esc(c.courseCode || ''), c.weekday,
    c.startTime || c.start, c.endTime || c.end,
    c.weekStart, c.weekEnd, c.weekType || 'all',
    fDt(ts)
  ].join('|')) + '-0@xipoo'
}

// OCR 导入有时会按教学周展开相同课程。每条记录随后都会带上相同的
// weekStart/weekEnd；若原样导出，iOS 日历会把它们显示为并排的多个事件。
// 只合并所有日历字段完全相同的记录，保留不同地点、教师或时段的课程。
function dedupeCourses(courses) {
  var seen = Object.create(null)
  return courses.filter(function (c) {
    var key = [
      c.title, c.location || c.place || '', c.teacher || '', c.courseCode || '',
      c.termStart || '', c.weekday, c.startTime || c.start || '', c.endTime || c.end || '',
      c.weekStart, c.weekEnd, c.weekType || 'all'
      , Array.isArray(c.weekSet) ? c.weekSet.join(',') : ''
    ].map(function (value) { return String(value || '').trim().toLowerCase() }).join('\u001f')
    if (seen[key]) return false
    seen[key] = true
    return true
  })
}

// ─── RRULE（仅 COUNT） ───────────────────────────────
function rrule(wt, ws, we) {
  var t = (wt || 'all').toLowerCase()
  var s = Number(ws) || 1, e = Number(we) || s
  var iv = (t === 'odd' || t === 'even') ? 2 : 1
  var ct = iv === 1 ? (e - s + 1) : (Math.floor((e - s) / iv) + 1)
  return ct <= 1 ? '' : 'FREQ=WEEKLY;INTERVAL=' + iv + ';COUNT=' + ct
}
function isContiguousWeeks(weeks) {
  return weeks.length < 2 || weeks.every(function (w, i) { return i === 0 || w === weeks[i - 1] + 1 })
}
function isParityWeeks(weeks) {
  return weeks.length > 1 && weeks.every(function (w, i) { return i === 0 || w - weeks[i - 1] === 2 })
}

// 本地北京时间 "HH:MM" + 本地日期 → UTC 绝对时间（中国无夏令时，恒定 -8 小时）。
// 返回 { day: 可能跨日回落后的本地基础日, s: 'HHMMSS' }，供 DTSTART/DTEND 带 Z 后缀使用。
function toUtc(baseDate, time) {
  var p = String(time || '00:00').split(':')
  var h = parseInt(p[0], 10) || 0
  var m = parseInt(p[1], 10) || 0
  var mins = h * 60 + m - 480 // 北京时间 → UTC，减 8 小时
  var day = new Date(baseDate)
  if (mins < 0) {
    mins += 1440
    day.setDate(day.getDate() - 1)
  }
  var uh = Math.floor(mins / 60)
  var um = mins % 60
  return { day: day, s: String(uh).padStart(2, '0') + String(um).padStart(2, '0') + '00' }
}

// ─── VEVENT ──────────────────────────────────────────
function vevent(c, ts) {
  var wd = Number(c.weekday) || 1
  var ws = Number(c.weekStart) || 1, we = Number(c.weekEnd) || ws
  var fd = addD(ts, (ws - 1) * 7 + (wd - 1))
  var st = c.startTime || c.start || '09:00'
  var et = c.endTime || c.end || '10:00'

  // ★ UTC 绝对时间（Z 后缀）：北京时间减 8 小时 → UTC。
  //   系统日历据此显示正确的北京本地时间与 UTC 标签，不再出现数值互换。
  var us = toUtc(fd, st)
  var ue = toUtc(fd, et)
  var dts = fDt(us.day) + 'T' + us.s + 'Z'
  var dte = fDt(ue.day) + 'T' + ue.s + 'Z'

  var sum = esc(c.title || '未命名课程')
  var loc = esc(c.location || c.place || '')
  var weeks = Array.isArray(c.weekSet) ? c.weekSet.map(Number).filter(function (w) { return Number.isInteger(w) && w >= 1 }).sort(function (a, b) { return a - b }) : []
  var rr = (!weeks.length || isContiguousWeeks(weeks) || isParityWeeks(weeks)) ? rrule(c.weekType, ws, we) : ''

  var dp = []
  if (c.teacher) dp.push('教师: ' + c.teacher)
  if (c.courseCode) dp.push('课程代码: ' + c.courseCode)
  var lb = { all: '全周', odd: '单周', even: '双周' }
  dp.push('教学周: ' + ws + '-' + we + ' (' + (lb[c.weekType] || '全周') + ')')
  dp.push('时间: ' + st + '-' + et + ' (北京时间)')

  var a = [
    'BEGIN:VEVENT',
    'DTSTART:' + dts,
    'DTEND:' + dte,
    'DTSTAMP:' + fSt(),
    'UID:' + uid(c, ts),
    'SEQUENCE:0',
    'TRANSP:OPAQUE',
    'SUMMARY:' + sum
  ]
  if (loc) a.push('LOCATION:' + loc)
  if (dp.length) a.push('DESCRIPTION:' + esc(dp.join('\\n')))
  if (rr) a.push('RRULE:' + rr)
  // iCalendar has no portable RRULE syntax for arbitrary sparse teaching weeks.
  // Emit exact occurrence dates instead of silently creating extra weekly events.
  if (weeks.length && !isContiguousWeeks(weeks) && !isParityWeeks(weeks)) {
    var dates = weeks.slice(1).map(function (w) {
      var day = addD(ts, (w - 1) * 7 + (wd - 1))
      return fDt(toUtc(day, st).day) + 'T' + toUtc(day, st).s + 'Z'
    })
    if (dates.length) a.push('RDATE:' + dates.join(','))
  }
  a.push('END:VEVENT')
  return a.join('\r\n')
}

// ─── 主入口 ──────────────────────────────────────────
function generateCourseIcs(courses) {
  if (!Array.isArray(courses) || !courses.length) throw new Error('课程列表为空')

  courses = dedupeCourses(courses)

  var ts = null
  for (var i = 0; i < courses.length; i++) { ts = pDate(courses[i].termStart); if (ts) break }
  if (!ts) {
    var n = new Date(); ts = new Date(n.getFullYear(), 8, 1)
    var dow = ts.getDay()
    if (dow !== 1) ts.setDate(ts.getDate() + (dow === 0 ? 1 : 8 - dow))
  }

  var hdr = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:' + PRODID +
    '\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Xipoo\r\nX-WR-TIMEZONE:Asia/Shanghai'

  var evts = courses.map(function (c) {
    return vevent(c, pDate(c.termStart) || ts)
  })

  return hdr + '\r\n' + evts.join('\r\n') + '\r\nEND:VCALENDAR\r\n'
}

module.exports = { generateCourseIcs: generateCourseIcs, dedupeCourses: dedupeCourses }

