// 懒加载 mockBackend（约 111KB）：仅在云端不可用、真正回退离线数据时才 require，
// 生产环境（云可用）启动时跳过这 111KB 的解析，加快首屏。
let _mockBackend = null
function getMock() {
  if (!_mockBackend) _mockBackend = require('./mockBackend')
  return _mockBackend
}
const mock = new Proxy({}, {
  get(target, prop) {
    return getMock()[prop]
  }
})
const { CLOUD_ENV_ID, hasCloudEnv } = require('./cloudConfig')
const { normalizeCourseWeeks } = require('./courseWeeks')

const API_BASE_URL = ''
// OCR 课表图片通过云存储中转，不再为请求体而压缩原图；与管理端上传上限保持一致。
const MAX_OCR_IMAGE_BYTES = 15 * 1024 * 1024
const OCR_JOB_STORAGE_KEY = 'xipoo_pending_ocr_job'
const OCR_POLL_INTERVAL_MS = 1000
// OCR 服务可能需要数分钟处理大尺寸原图；不要在任务仍排队时提前中断。
const OCR_POLL_TIMEOUT_MS = 10 * 60 * 1000
const CLOUD_CIRCUIT_COOLDOWN_MS = 60 * 1000
// 云函数默认会等待很久才超时；页面查询超过 8 秒后不应继续阻塞界面。
const CLOUD_CALL_TIMEOUT_MS = 8 * 1000
let cloudCircuitOpenUntil = 0
let activeOcrPoll = null

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getPendingOcrJob() {
  try {
    const job = wx.getStorageSync(OCR_JOB_STORAGE_KEY)
    return job && job.jobId ? job : null
  } catch (_) {
    return null
  }
}

function savePendingOcrJob(job) {
  wx.setStorageSync(OCR_JOB_STORAGE_KEY, job)
}

function clearPendingOcrJob() {
  try { wx.removeStorageSync(OCR_JOB_STORAGE_KEY) } catch (_) {}
}

function normalizeOcrWeekday(item = {}) {
  const value = item.weekday ?? item.day ?? item.day_of_week ?? item.dayOfWeek ?? item.weekday_name ?? item.weekdayName
  if (typeof value === 'number' && value >= 1 && value <= 7) return value
  const names = { mon: 1, monday: 1, '周一': 1, '星期一': 1, tue: 2, tuesday: 2, '周二': 2, '星期二': 2, wed: 3, wednesday: 3, '周三': 3, '星期三': 3, thu: 4, thursday: 4, '周四': 4, '星期四': 4, fri: 5, friday: 5, '周五': 5, '星期五': 5, sat: 6, saturday: 6, '周六': 6, '星期六': 6, sun: 7, sunday: 7, '周日': 7, '星期日': 7 }
  return names[String(value || '').trim().toLowerCase()] || ''
}

function getOcrMissingFields(item = {}) {
  const missing = []
  if (!String(item.course_code || item.course_name || '').trim()) missing.push('title')
  if (!String(item.activity_type || '').trim()) missing.push('activity_type')
  // 按周重复的课程可以没有具体日期（语音录入常见），此时 weekday 即可定位
  const dateText = String(item.date || '').trim()
  const dateValue = dateText ? new Date(`${dateText}T00:00:00`) : null
  const validDate = !dateText || (dateValue && !Number.isNaN(dateValue.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateText))
  const weekday = normalizeOcrWeekday(item)
  if ((!dateText && !(weekday >= 1 && weekday <= 7)) || !validDate || (dateText && weekday && (weekday < 1 || weekday > 7))) missing.push('date')
  const start = String(item.start_time || '').trim()
  const end = String(item.end_time || '').trim()
  const timePattern = /^([01]?\d|2[0-3]):[0-5]\d$/
  if (!timePattern.test(start) || !timePattern.test(end) || end <= start) missing.push('time')
  const room = String(item.room || '').trim()
  if (!room || /^(未知|待定|tbd|n\/a|-)$/i.test(room)) missing.push('place')
  const rawWeekValues = [item.week_set, item.weekSet, item.weeks, item.week_numbers, item.weekNumbers, item.teaching_weeks, item.teachingWeeks, item.week_range, item.weekRange, item.week_start, item.weekStart, item.start_week, item.startWeek, item.week_end, item.weekEnd, item.end_week, item.endWeek, item.weeks_text, item.weeksText, item.week]
  const rawWeekText = rawWeekValues.filter((value) => value !== undefined && value !== null && value !== '').map((value) => JSON.stringify(value)).join(' ')
  const invalidWeekNumber = (rawWeekText.match(/\d+/g) || []).some((value) => Number(value) < 1 || Number(value) > 60)
  if (!normalizeCourseWeeks(item).length || invalidWeekNumber) missing.push('weeks')
  return missing
}

function getOcrReviewReasons(fields) {
  const labels = {
    title: '缺少课程名称',
    date: '缺少上课日期',
    time: '缺少上课时间',
    place: '缺少上课地点',
    weeks: '缺少教学周',
    activity_type: '缺少课型'
  }
  return (fields || []).map((field) => labels[field]).filter(Boolean)
}

function groupAiImportBatches(courses) {
  const batches = new Map()
  ;(courses || []).forEach((course) => {
    if (!course || !course.importBatchId) return
    const batch = batches.get(course.importBatchId) || {
      id: course.importBatchId,
      importedAt: course.importedAt || '',
      courseCount: 0,
      preview: []
    }
    batch.courseCount += 1
    if (course.importedAt && (!batch.importedAt || course.importedAt < batch.importedAt)) {
      batch.importedAt = course.importedAt
    }
    if (course.title && batch.preview.length < 3 && !batch.preview.includes(course.title)) {
      batch.preview.push(course.title)
    }
    batches.set(course.importBatchId, batch)
  })
  return Array.from(batches.values()).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))
}

function mapOcrCourses(items, importBatchId = '', source = 'ocr', metadata = {}) {
  const importedAt = new Date().toISOString()
  const sourceItems = Array.isArray(items) ? items : []
  const isDerivedExpanded = sourceItems.length > 1 && sourceItems.every((item) => item && !item.id && !item.courseId && item.block_index == null && item.blockIndex == null)
  const imageSha256 = metadata && metadata.input_image && metadata.input_image.sha256
    ? metadata.input_image.sha256
    : (metadata && metadata.inputImageSha256) || ''

  // 后端返回的每条 courses 记录对应一个原始 OCR 框。必须逐条保留，
  // 不能按课程代码/教学班/时间合并，否则会串课型和教学周。
  if (!isDerivedExpanded) return sourceItems.map((item, index) => {
    const current = item || {}
    const weeks = normalizeCourseWeeks(current)
    const date = current.date || ''
    const weekday = date
      ? (() => { const w = new Date(`${date}T00:00:00`).getDay(); return w === 0 ? 7 : w })()
      : normalizeOcrWeekday(current)
    const missingFields = getOcrMissingFields(current)
    const validation = current.validation
    const validationStatus = typeof validation === 'string'
      ? validation.toLowerCase()
      : String(validation && (validation.status || validation.result) || current.validation_status || current.status || '').toLowerCase()
    const validationNeedsReview = Boolean(validationStatus && !['ok', 'success', 'valid', 'green'].includes(validationStatus))
    const blockIndex = Number(current.block_index ?? current.blockIndex)
    const ocrIndex = Number(current.ocr_index ?? current.ocrIndex)
    const stableIndex = Number.isFinite(blockIndex) ? blockIndex : (Number.isFinite(ocrIndex) ? ocrIndex : index)
    return {
      id: String(current.id || current.courseId || `${source}-${importBatchId}-${stableIndex}`),
      courseId: String(current.courseId || current.id || `${source}-${importBatchId}-${stableIndex}`),
      block_index: Number.isFinite(blockIndex) ? blockIndex : undefined,
      title: current.course_code || current.course_name || '未命名',
      moduleKey: [current.course_code || current.course_name || '', current.group || ''].join('-'),
      date, weekday,
      start: current.start_time || current.start || '',
      end: current.end_time || current.end || '',
      place: current.room || current.place || '',
      teacher: current.teacher || '',
      courseCode: current.course_code || current.courseCode || '',
      section: current.group || current.section || '',
      term: current.term || '2025-26-S2',
      type: current.activity_type || current.type || '',
      week_set: weeks,
      weekStart: weeks[0], weekEnd: weeks[weeks.length - 1],
      week_start: weeks[0], week_end: weeks[weeks.length - 1],
      weeks_text: current.weeks_text,
      source, importBatchId, jobId: importBatchId,
      input_image: imageSha256 ? { sha256: imageSha256 } : undefined,
      sessions: [],
      ocrIndex: Number.isFinite(ocrIndex) ? ocrIndex : index + 1,
      importedAt, missingFields,
      needsReview: missingFields.length > 0 || validationNeedsReview,
      reviewReasons: getOcrReviewReasons(missingFields).concat(
        [current.warnings, current.issues, current.tips].flatMap((values) => Array.isArray(values) ? values : (values ? [values] : []))
          .map((reason) => `需核验：${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
      ),
      validationStatus,
      confirmed: missingFields.length === 0 && !validationNeedsReview
    }
  })

  /* legacy aggregation path retained below for reference; raw OCR path returns above */
  /* istanbul ignore next */
  const grouped = new Map()
  const moduleKeyOf = (item) => item && (item.module_key || item.moduleKey) || [item && (item.course_code || item.course_name) || '', item && item.group || ''].join('|')
  const sessionKeyOf = (item) => {
    const date = item && item.date ? new Date(`${item.date}T00:00:00`) : null
    const weekday = normalizeOcrWeekday(item) || (date && !Number.isNaN(date.getTime()) ? (date.getDay() || 7) : '')
    return [item && item.activity_type || '', weekday, item && item.start_time || '', item && item.end_time || '', item && item.room || ''].join('|')
  }
  sourceItems.forEach((item, index) => {
    const current = item || {}
    let moduleKey = moduleKeyOf(current)
    // OCR 的 MULTI/TBD 行可能丢失教学班。若课程代码相同、且已知星期
    // 与已有模块活动相容，则归入该模块，避免生成一条“未知班级”的重复课。
    if (!current.group) {
      const code = current.course_code || current.course_name || ''
      const weekday = normalizeOcrWeekday(current)
      const candidates = Array.from(grouped.entries()).filter(([key, value]) => {
        if (!String(key).startsWith(`${code}|`)) return false
        if (!weekday) return true
        return Array.from(value.sessions.values()).some((session) => normalizeOcrWeekday(session.item) === weekday)
      })
      if (candidates.length === 1) moduleKey = candidates[0][0]
    }
    if (!grouped.has(moduleKey)) grouped.set(moduleKey, { item: item || {}, firstIndex: index, sessions: new Map() })
    const module = grouped.get(moduleKey)
    const sessionKey = sessionKeyOf(item || {})
    if (!module.sessions.has(sessionKey)) module.sessions.set(sessionKey, { item: item || {}, weeks: new Set() })
    normalizeCourseWeeks(item || {}).forEach((week) => module.sessions.get(sessionKey).weeks.add(week))
  })

  return Array.from(grouped.values()).map(({ item, firstIndex, sessions }, courseIndex) => {
    const primary = sessions.values().next().value || { item, weeks: new Set() }
    const primaryItem = primary.item
    const weekSet = Array.from(primary.weeks).sort((a, b) => a - b)
    const rawMissingFields = getOcrMissingFields(item)
    const validation = item.validation
    const validationStatus = typeof validation === 'string'
      ? validation.toLowerCase()
      : String(validation && (validation.status || validation.result) || item.validation_status || item.status || '').toLowerCase()
    const validationNeedsReview = Boolean(validationStatus && !['ok', 'success', 'valid', 'green'].includes(validationStatus))
    const missingFields = weekSet.length
      ? rawMissingFields.filter((field) => field !== 'weeks')
      : rawMissingFields
    return {
      id: [source, importBatchId, item.course_code || item.course_name || 'course', item.group || '', String(firstIndex)].filter(Boolean).join('-'),
      title: item.course_code || item.course_name || '未命名',
      moduleKey: [item.course_code || item.course_name || '', item.group || ''].join('-'),
      date: primaryItem.date || '',
      weekday: primaryItem.date
        ? (() => { const w = new Date(primaryItem.date + 'T00:00:00').getDay(); return w === 0 ? 7 : w })()
        : normalizeOcrWeekday(primaryItem),
      start: primaryItem.start_time || '',
      end: primaryItem.end_time || '',
      place: primaryItem.room || '',
      teacher: primaryItem.teacher || '',
      courseCode: item.course_code || '',
      section: item.group || '',
      term: '2025-26-S2',
      type: primaryItem.activity_type || 'Lecture',
      week: primaryItem.week,
      week_set: weekSet,
      weekStart: weekSet[0],
      weekEnd: weekSet[weekSet.length - 1],
      week_start: weekSet[0],
      week_end: weekSet[weekSet.length - 1],
      weeks_text: item.weeks_text,
      source,
      importBatchId,
      jobId: importBatchId,
      input_image: imageSha256 ? { sha256: imageSha256 } : undefined,
      sessions: Array.from(sessions.values()).map((session) => {
        const current = session.item
        const sessionWeekSet = Array.from(session.weeks).sort((a, b) => a - b)
        return {
          type: current.activity_type || 'Lecture',
          weekday: normalizeOcrWeekday(current),
          date: current.date || '',
          start: current.start_time || '',
          end: current.end_time || '',
          place: current.room || '',
          teacher: current.teacher || '',
          weekSet: sessionWeekSet,
          ocrIndex: Number(current.session_ocr_index || current.ocr_index || current.ocrIndex) || undefined
        }
      }),
      // 与后端 annotated 图的原始课程框顺序一致，供结果页逐项核验。
      ocrIndex: Number(item.ocr_index || item.ocrIndex) || (courseIndex + 1),
      importedAt,
      missingFields,
      needsReview: missingFields.length > 0 || validationNeedsReview,
      reviewReasons: getOcrReviewReasons(missingFields).concat(
        [item.warnings, item.issues, item.tips].flatMap((values) => Array.isArray(values) ? values : (values ? [values] : []))
          .map((reason) => `需核验：${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
      ),
      validationStatus,
      confirmed: missingFields.length === 0 && !validationNeedsReview
    }
  })
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject })
  })
}

// 鸿蒙部分微信版本会返回 content:// 或 file:// 临时 URI，云存储上传器
// 不能直接读取。尝试把它物化到小程序用户目录；普通 wx 临时路径原样返回。
async function materializeOcrImage(filePath) {
  const pathText = String(filePath || '')
  if (!/^(content|file):\/\//i.test(pathText) || !wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) return filePath
  try {
    const fs = wx.getFileSystemManager()
    const data = await new Promise((resolve, reject) => fs.readFile({ filePath: pathText, success: (res) => resolve(res.data), fail: reject }))
    const target = `${wx.env.USER_DATA_PATH}/ocr-${Date.now()}.jpg`
    await new Promise((resolve, reject) => fs.writeFile({ filePath: target, data, success: resolve, fail: reject }))
    return target
  } catch (error) {
    console.warn('[Xipoo] 无法物化鸿蒙图片 URI，继续尝试原路径:', (error && error.message) || error)
    return filePath
  }
}

async function prepareOcrImage(filePath) {
  const candidate = await materializeOcrImage(filePath)
  try {
    const info = await getFileInfo(candidate)
    console.info('[Xipoo] OCR original image:', { path: candidate, bytes: info.size })
    if (info.size > MAX_OCR_IMAGE_BYTES) {
      throw new Error('课表图片不能超过 15MB，请选择更小的图片')
    }
  } catch (error) {
    // HarmonyOS may return a valid sandbox temp path while getFileInfo is
    // temporarily unavailable.  The cloud upload still performs its own
    // size validation, so do not reject a usable image at this stage.
    if (error && error.message === '课表图片不能超过 15MB，请选择更小的图片') throw error
    console.warn('[Xipoo] getFileInfo unavailable; continue with temp image:', error)
  }
  return candidate
}

// 后端若提供原始课程框，优先使用它；旧接口仅有 expanded 时才在前端归并。
function getOcrCourseItems(data = {}) {
  if (Array.isArray(data.modules)) {
    return data.modules.flatMap((module) => {
      const sessions = Array.isArray(module.sessions) && module.sessions.length ? module.sessions : [{}]
      return sessions.map((session) => Object.assign({}, module, {
        course_code: module.course_code || module.courseCode,
        course_name: module.course_name || module.courseName,
        group: module.group || '',
        activity_type: session.activity_type || session.activityType || session.type || module.activity_type,
        weekday: session.weekday,
        date: session.date || '',
        start_time: session.start_time || session.startTime || session.start || '',
        end_time: session.end_time || session.endTime || session.end || '',
        room: session.room || session.place || '',
        teacher: session.teacher || '',
        week_set: session.week_set || session.weekSet,
        weeks_text: session.weeks_text || session.weeksText,
        validation: module.validation,
        issues: (module.issues || []).concat(session.issues || []),
        ocr_index: module.ocr_index || module.ocrIndex,
        session_ocr_index: session.ocr_index || session.ocrIndex
      }))
    })
  }
  const candidates = [data.courses, data.raw_courses, data.original_courses, data.course_boxes, data.courseBoxes]
  const raw = candidates.find((value) => Array.isArray(value))
  return raw || (Array.isArray(data.expanded) ? data.expanded : [])
}

function imageExtension(filePath) {
  const match = String(filePath || '').match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
  const extension = match ? match[1].toLowerCase() : 'jpg'
  return ['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'jpg'
}

function request(path, options = {}) {
  if (!API_BASE_URL) {
    return Promise.reject(new Error('API_BASE_URL is not configured'))
  }

  const session = wx.getStorageSync('xipoo_session')
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        Authorization: session && session.token ? `Bearer ${session.token}` : '',
        'content-type': 'application/json'
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error((res.data && res.data.message) || '请求失败'))
        }
      },
      fail: reject
    })
  })
}

function upload(path, filePath, name = 'file') {
  if (!API_BASE_URL) {
    return Promise.resolve(mock.importScheduleImage(filePath))
  }

  const session = wx.getStorageSync('xipoo_session')
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath,
      name,
      header: {
        Authorization: session && session.token ? `Bearer ${session.token}` : ''
      },
      success: (res) => {
        try {
          resolve(JSON.parse(res.data))
        } catch (error) {
          reject(error)
        }
      },
      fail: reject
    })
  })
}

function withFallback(remoteCall, localCall) {
  if (!API_BASE_URL) {
    try {
      return Promise.resolve(localCall())
    } catch (error) {
      return Promise.reject(error)
    }
  }
  return remoteCall()
}

// 云端调用失败回退到 mock 数据时打上不可枚举标记，调用方据此避免用 mock 数据
// 覆盖真实数据/全局缓存（否则切换页面后真实课表可能被空的 mock 数据冲掉）
function tagCloudFallback(data) {
  if (data && (Array.isArray(data) || typeof data === 'object')) {
    try {
      Object.defineProperty(data, '__cloudFailed', { value: true, enumerable: false, configurable: true })
    } catch (_) {}
  }
  return data
}

function cloudResultError(result) {
  const error = new Error(result && result.message ? result.message : '云函数调用失败')
  // 云函数已返回业务结果，不能用空 mock 数据覆盖真实页面状态。
  error.isCloudBusinessError = true
  // 云函数统一返回 errorCode；兼容少量旧函数仍使用 code 的结果。
  error.code = result && (result.errorCode || result.code)
  return error
}

function cloudUnavailableError() {
  const error = new Error('云服务暂时不可用，请稍后重试')
  error.isCloudUnavailable = true
  return error
}

function callCloudWithTimeout(cloudCall, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const error = new Error('云函数请求超时')
      error.isCloudTimeout = true
      reject(error)
    }, timeoutMs || CLOUD_CALL_TIMEOUT_MS)

    // 显式指定与 app.js 相同的环境。开发者工具热重载/多环境切换后，
    // 仅依赖 wx.cloud.init 的默认环境可能仍命中旧函数版本。
    const callOptions = Object.assign({}, cloudCall, {
      config: Object.assign({}, cloudCall.config || {}, { env: CLOUD_ENV_ID })
    })
    wx.cloud.callFunction(callOptions).then((res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const result = res.result || {}
      if (!result.ok) {
        reject(cloudResultError(result))
        return
      }
      resolve(result.data)
    }).catch((error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function isCloudFunctionMissing(error) {
  const detail = String(error && (error.errMsg || error.message || error) || '')
  return Number(error && error.errCode) === -501000
    || /errCode:\s*-501000|resource is not found/i.test(detail)
}

function scheduleFunctionMissingError(error) {
  const wrapped = new Error('当前 prod 云环境未部署 schedule 云函数，请先在云开发控制台或开发者工具上传并部署该函数。')
  wrapped.code = 'SCHEDULE_FUNCTION_MISSING'
  wrapped.cause = error
  return wrapped
}

// 多人空闲计算的底层错误转义：业务错误（云函数已返回友好中文 message）原样透传；
// 底层 -501000（函数未部署/调用失败）与超时等运行时错误转为可执行的友好提示。
function friendlyMultiFreeError(error) {
  if (error && error.isCloudBusinessError) return error
  const ec = error && Number(error.errCode)
  const detail = String(error && (error.errMsg || error.message || error) || '')
  if (/EXCEED_MAX_RESPONSE_SIZE|response size exceeded/i.test(detail)) {
    // CloudBase 会将“云函数返回体超过 1 MB”包装为 -501000。它不是未部署：
    // 说明线上仍是旧版 friend，或尚未完成本地新代码的上传部署。
    const wrapped = new Error('共同空闲结果超过云端传输上限（1 MB）。请重新部署 cloudfunctions/friend，并在控制台 ping 确认版本为 v3-compact-availability-response-0814。')
    wrapped.code = 'FRIEND_RESPONSE_TOO_LARGE'
    wrapped.cause = error
    return wrapped
  }
  // -501000 / resource is not found 属于客户端调用层的错误；不要把它臆测成
  // AppID 关联或算法错误。保留原始信息，方便从开发者工具控制台定位。
  if (ec === -501000 || /-501000|resource is not found/i.test(detail)) {
    const shortDetail = detail.replace(/\s+/g, ' ').slice(0, 120)
    const wrapped = new Error(`共同空闲请求调用失败（客户端错误 -501000${shortDetail ? `：${shortDetail}` : ''}）。请查看开发者工具控制台中 [Xipoo group availability] 输出。`)
    wrapped.code = 'FRIEND_CALL_FAILED'
    wrapped.cause = error
    return wrapped
  }
  if (error && (error.isCloudTimeout || /timeout|超时/i.test(detail))) {
    const wrapped = new Error('多人空闲计算超时，请稍后重试；若持续出现，请确认 match 已部署最新代码且函数超时设为 60 秒')
    wrapped.code = 'MATCH_FUNCTION_TIMEOUT'
    wrapped.cause = error
    return wrapped
  }
  if (ec === -504002 || /-504002/i.test(detail)) {
    const wrapped = new Error('多人空闲计算云函数执行失败，请在云开发控制台查看 match 的日志；确认已上传包含 calculateAvailability 的最新代码后重试')
    wrapped.code = 'MATCH_FUNCTION_EXECUTION_FAILED'
    wrapped.cause = error
    return wrapped
  }
  return error
}

// 登录云函数的成功结果直接包含 session 与 user，而不是通用云函数使用的
// { ok, data } 结构，因此保留独立的超时包装以避免客户端一直等待。
function callLoginCloudWithTimeout(profile) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const error = new Error('登录云函数请求超时')
      error.isCloudTimeout = true
      reject(error)
    }, CLOUD_CALL_TIMEOUT_MS)

    wx.cloud.callFunction({
      name: 'login',
      data: { profile: profile || null }
    }).then((res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const result = res.result || {}
      if (!result.ok) {
        reject(cloudResultError(result))
        return
      }
      resolve(result)
    }).catch((error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function withCloudOrMock(cloudCall, mockCall, options = {}) {
  // 核心业务在真实小程序中不得伪造本地成功结果。仅本地 Node 回归测试显式开启
  // __XIPOO_TEST_ALLOW_MOCK__ 时保留 mock，以测试前端纯逻辑。
  const testAllowsMock = typeof globalThis !== 'undefined' && globalThis.__XIPOO_TEST_ALLOW_MOCK__ === true
  const fallbackOnError = options.fallbackOnError !== false || testAllowsMock
  const timeoutMs = options.timeoutMs || CLOUD_CALL_TIMEOUT_MS
  const callMock = (markCloudFailure) => {
    try {
      const data = mockCall()
      return Promise.resolve(markCloudFailure ? tagCloudFallback(data) : data)
    } catch (error) {
      // 云端失败后才走 mock 时，mock 用本地种子数据算出的业务错误（如「缺少日程联系人关系」）
      // 会严重误导用户——标注出来，页面统一改报「云端不可用」
      if (markCloudFailure && error && typeof error === 'object') error.fromCloudFallback = true
      return Promise.reject(error)
    }
  }

  const hasCloud = wx.cloud && hasCloudEnv()

  // 关闭降级的调用必须始终真实请求云端，绝不走熔断快速失败，避免真实错误被「云服务暂时不可用」掩盖
  if (hasCloud && !fallbackOnError) {
    return callCloudWithTimeout(cloudCall, timeoutMs)
  }

  if (Date.now() < cloudCircuitOpenUntil) {
    return callMock(true)
  }
  if (hasCloud) {
    return callCloudWithTimeout(cloudCall, timeoutMs).catch((err) => {
      // “尚未入池”等业务错误由页面处理；只有网络/运行时错误才熔断回退。
      if (err && err.isCloudBusinessError) throw err
      cloudCircuitOpenUntil = Date.now() + CLOUD_CIRCUIT_COOLDOWN_MS
      console.warn('[Xipoo] 云函数暂时不可用，60 秒内使用本地数据:', (err && err.message) || '网络错误')
      return callMock(true)
    })
  }
  // 纯 mock 开发模式不是云端故障，不应带 __cloudFailed 标记。
  return fallbackOnError ? callMock(false) : Promise.reject(cloudUnavailableError())
}

module.exports = {
  mapOcrCourses,
  getOcrMissingFields,

  wechatLogin(profile) {
    if (!wx.cloud || !hasCloudEnv()) {
      return Promise.resolve(mock.wechatLogin(profile))
    }
    // profile 现在由页面层传入 null（不再使用已废弃的 wx.getUserProfile）
    // 云函数内部通过 cloud.getWXContext().OPENID 获取 openid
    return callLoginCloudWithTimeout(profile).then((result) => {
      wx.setStorageSync('xipoo_session', result.session)
      wx.setStorageSync('xipoo_user_info', result.user || null)
      // 标记 isNewUser 供登录页判断跳转
      result.isNewUser = !!(result.user && !result.user.name)
      return result
    }).catch((error) => {
      const message = String(error && (error.message || error.errMsg) || '')
      console.error('[Xipoo cloud login failed]', { env: CLOUD_ENV_ID, message })
      if (message.includes('-504002')) {
        throw new Error(`login 云函数未找到，请确认已部署到 ${CLOUD_ENV_ID}`)
      }
      throw new Error(message || 'WeChat cloud login failed')
    })
  },

  login(data) {
    return withFallback(() => request('/auth/login', { method: 'POST', data }), () => mock.login(data))
  },

  register(data) {
    return withFallback(() => request('/auth/register', { method: 'POST', data }), () => mock.register(data))
  },

  sendSmsCode(phone) {
    return withFallback(() => request('/auth/sms/send', { method: 'POST', data: { phone } }), () => mock.sendSmsCode(phone))
  },

  bindPhone(data) {
    return withFallback(() => request('/users/me/phone', { method: 'POST', data }), () => mock.bindPhone(data))
  },

  logout() {
    return withFallback(() => request('/auth/logout', { method: 'POST' }), () => mock.logout())
  },

  me() {
    return withCloudOrMock(
      { name: 'user', data: { action: 'getProfile' } },
      () => mock.me(),
      { fallbackOnError: false }
    )
  },

  updateProfile(data) {
    return withCloudOrMock(
      { name: 'user', data: { action: 'updateProfile', payload: data } },
      () => mock.updateProfile(data),
      { fallbackOnError: false }
    )
  },

  getSchedule() {
    return withCloudOrMock(
      { name: 'schedule', data: { action: 'listSchedules' } },
      () => mock.getSchedule(),
      { fallbackOnError: false }
    )
  },

  getActivitySchedule() {
    return withFallback(() => request('/schedules/me/activities'), () => mock.getActivitySchedule())
  },

  upsertCourse(course) {
    return withCloudOrMock(
      { name: 'schedule', data: { action: 'upsertSchedule', payload: course } },
      () => mock.upsertCourse(course),
      { fallbackOnError: false }
    )
  },

  // 语音录入日程：口语描述 → 混元整理为结构化课程 → 复用 OCR 映射（source 标记 voice）
  parseScheduleText(text) {
    const input = String(text || '').trim().slice(0, 2000)
    if (!input) return Promise.resolve([])
    if (!wx.cloud || !hasCloudEnv()) return Promise.resolve([])
    const batchId = `voice-${Date.now()}`
    return wx.cloud.callFunction({
      name: 'schedule',
      data: { action: 'parseScheduleText', payload: { text: input } }
    }).then((res) => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.message || 'AI 整理课程失败')
      const items = (result.data && result.data.courses) || []
      return mapOcrCourses(items, batchId, 'voice')
    })
  },

  upsertCoursesBatch(courses) {
    const list = Array.isArray(courses) ? courses : []
    if (!list.length) return Promise.resolve({ courses: [], count: 0 })
    if (!wx.cloud || !hasCloudEnv()) {
      return Promise.reject(cloudUnavailableError())
    }
    return wx.cloud.callFunction({
      name: 'schedule',
      data: { action: 'upsertSchedulesBatch', payload: { courses: list } }
    }).then((res) => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.message || '批量保存课程失败')
      return result.data
    }).catch(async (error) => {
      console.warn('[Xipoo] upsertSchedulesBatch 不可用，改用逐条保存兼容路径:', error && error.message)
      for (const course of list) await this.upsertCourse(course)
      return { courses: list, count: list.length, fallback: true }
    })
  },

  deleteCourse(courseId, ids) {
    // 支持单条和批量删除
    if (Array.isArray(ids) && ids.length) {
      return withCloudOrMock(
        { name: 'schedule', data: { action: 'deleteSchedule', payload: { ids } } },
        () => {
          ids.forEach(id => mock.deleteCourse(id))
          return { ids, removed: ids.length }
        },
        { fallbackOnError: false }
      )
    }
    const id = courseId
    if (!id) return Promise.resolve({ removed: 0 })
    return withCloudOrMock(
      { name: 'schedule', data: { action: 'deleteSchedule', payload: { id } } },
      () => mock.deleteCourse(id),
      { fallbackOnError: false }
    )
  },

  listAiImportBatches() {
    if (!wx.cloud || !hasCloudEnv()) return Promise.resolve(mock.listAiImportBatches())
    return wx.cloud.callFunction({
      name: 'schedule',
      data: { action: 'listOcrImportBatches' }
    }).then((res) => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.message || '加载 AI 识别记录失败')
      return result.data || []
    }).catch((error) => {
      console.warn('[Xipoo] 批次接口不可用，改由课程列表整理 AI 记录:', error.message)
      return wx.cloud.callFunction({
        name: 'schedule',
        data: { action: 'listSchedules' }
      }).then((res) => {
        const result = res.result || {}
        if (!result.ok) throw new Error(result.message || '加载课程列表失败')
        return groupAiImportBatches(result.data || [])
      })
    })
  },

  deleteAiImportBatch(batchId) {
    if (!batchId) return Promise.reject(new Error('缺少导入批次编号'))
    if (!wx.cloud || !hasCloudEnv()) return Promise.resolve(mock.deleteAiImportBatch(batchId))
    return wx.cloud.callFunction({
      name: 'schedule',
      data: { action: 'deleteOcrImportBatch', payload: { batchId } }
    }).then((res) => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.message || '删除导入记录失败')
      return result.data
    })
  },

  // 标注图只在识别完成时上传一次；数据库仅保存 fileID，历史查看时再取临时 URL。
  async saveAiImportVerificationImage(batchId, filePath, mime, existingFileId = '') {
    if (!batchId || (!filePath && !existingFileId) || !wx.cloud || !hasCloudEnv()) {
      throw new Error('核验图暂时无法保存')
    }
    const normalizedMime = String(mime || 'image/png').toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const extension = normalizedMime === 'image/jpeg' ? 'jpg' : 'png'
    const safeBatchId = String(batchId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'ocr'
    // ocrAnnotated 已由云函数写入云存储时，直接登记其 fileID；不要再把图片
    // 下载到客户端、再上传一次，既避免大图 base64 传输，也避免重复文件。
    const upload = existingFileId
      ? { fileID: existingFileId }
      : await wx.cloud.uploadFile({
        cloudPath: `ocr-verification/${safeBatchId}-${Date.now()}.${extension}`,
        filePath
      })
    const res = await wx.cloud.callFunction({
      name: 'schedule',
      data: {
        action: 'saveOcrImportBatchArtifact',
        payload: { batchId, verificationFileId: upload.fileID, verificationMime: normalizedMime }
      }
    })
    const result = res.result || {}
    if (!result.ok) throw new Error(result.message || '保存核验图记录失败')
    return result.data
  },

  // 优先读取持久化图片。旧批次没有 fileID 时，仍可按原 jobId 尝试补取一次。
  async getAiImportVerificationImage(batch) {
    if (!batch) return { success: false, error: 'Missing OCR batch' }
    if (batch.verificationFileId && wx.cloud && hasCloudEnv()) {
      try {
        const result = await wx.cloud.getTempFileURL({ fileList: [batch.verificationFileId] })
        const item = result && result.fileList && result.fileList[0]
        if (item && item.status === 0 && item.tempFileURL) {
          return { success: true, filePath: item.tempFileURL, mime: batch.verificationMime || 'image/png', source: 'storage' }
        }
      } catch (error) {
        console.warn('[Xipoo] 获取已保存核验图失败，尝试从 OCR 服务补取:', error && error.message)
      }
    }
    return this.fetchScheduleAnnotatedImage(batch.id)
  },

  clearCourses() {
    if (!wx.cloud || !hasCloudEnv()) return Promise.resolve(mock.clearCourses())
    return wx.cloud.callFunction({
      name: 'schedule',
      data: { action: 'clearSchedules' }
    }).then((res) => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.message || '清空课程失败')
      return result.data
    }).catch(async (error) => {
      // 兼容尚未部署 clearSchedules 的旧 schedule 云函数：
      // 通过已有 deleteSchedule action 清除当前账户课程，避免按钮完全不可用。
      console.warn('[Xipoo] clearSchedules 不可用，改用逐条删除兼容路径:', error && error.message)
      const listRes = await wx.cloud.callFunction({
        name: 'schedule',
        data: { action: 'listSchedules' }
      })
      const listResult = listRes.result || {}
      if (!listResult.ok) throw new Error(listResult.message || '读取云端课程失败')
      const courses = listResult.data || []
      if (!courses.length) return { removed: 0, fallback: true }
      let removed = 0
      for (const course of courses) {
        const deleteRes = await wx.cloud.callFunction({
          name: 'schedule',
          data: { action: 'deleteSchedule', payload: { id: course.id } }
        })
        const deleteResult = deleteRes.result || {}
        if (!deleteResult.ok) throw new Error(deleteResult.message || `删除课程 ${course.title || course.id} 失败`)
        removed += 1
      }
      return { removed, fallback: true }
    })
  },

  /**
   * AI 导入课表：上传云存储 → 云函数 ocrSubmit → 轮询 ocrPoll → 返回 courses 数组
   */
  getPendingScheduleImport() {
    return getPendingOcrJob()
  },

  clearPendingScheduleImport() {
    clearPendingOcrJob()
  },

  async resumeScheduleImport(options = {}) {
    const pending = getPendingOcrJob()
    if (!pending) {
      const error = new Error('没有可恢复的识别任务')
      error.code = 'OCR_JOB_NOT_FOUND'
      throw error
    }
    return this.pollScheduleImport(pending.jobId, options)
  },

  async pollScheduleImport(jobId, options = {}) {
    if (activeOcrPoll && activeOcrPoll.jobId === jobId) return activeOcrPoll.promise
    const pollPromise = this._pollScheduleImport(jobId, options)
    activeOcrPoll = { jobId, promise: pollPromise }
    try { return await pollPromise } finally {
      if (activeOcrPoll && activeOcrPoll.promise === pollPromise) activeOcrPoll = null
    }
  },

  async _pollScheduleImport(jobId, options = {}) {
    const notifyProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
    const startedAt = Date.now()
    let transientFailures = 0
    const pendingJob = getPendingOcrJob()

    while (Date.now() - startedAt < OCR_POLL_TIMEOUT_MS) {
      try {
        const pollRes = await wx.cloud.callFunction({
          name: 'schedule',
          data: { action: 'ocrPoll', payload: { jobId } }
        })
        const pollResult = pollRes.result || {}
        if (!pollResult.ok) {
          const error = new Error(pollResult.message || 'OCR 轮询失败')
          error.code = pollResult.code || (/not.?found|不存在|404/i.test(error.message) ? 'OCR_JOB_NOT_FOUND' : 'OCR_POLL_TRANSIENT')
          throw error
        }

        transientFailures = 0
        const data = pollResult.data || {}
        const progress = data.progress || {}
        notifyProgress({
          phase: data.stage || data.status || 'queued',
          progress: Number(progress.percent),
          completed: progress.completed,
          total: progress.total,
          estimatedRemainingMs: data.estimated_remaining_ms,
          timings: data.status === 'done' ? data.timings : null,
          jobId
        })

        if (data.status === 'done') {
          clearPendingOcrJob()
          const metadata = Object.assign({}, pendingJob, data)
          return { courses: mapOcrCourses(getOcrCourseItems(data), jobId, 'ocr', metadata), blocks: [], timings: data.timings || {}, jobId, input_image: metadata.input_image }
        }
        // 只有服务端明确给出 failed 才结束任务；网络错误或未知状态都继续轮询。
        if (String(data.status || '').toLowerCase() === 'failed') {
          clearPendingOcrJob()
          const error = new Error(data.error || '课表识别失败')
          error.code = 'OCR_FAILED'
          throw error
        }
      } catch (error) {
        if (error.code === 'OCR_FAILED') throw error
        if (error.code === 'OCR_JOB_NOT_FOUND') {
          clearPendingOcrJob()
          throw error
        }
        transientFailures += 1
        notifyProgress({ phase: 'queued', transientFailure: true, jobId })
      }
      await delay(OCR_POLL_INTERVAL_MS)
    }

    // 到达客户端等待上限后再做一次最终查询，避免恰好在截止点完成的任务被误判。
    try {
      const finalRes = await wx.cloud.callFunction({
        name: 'schedule',
        data: { action: 'ocrPoll', payload: { jobId } }
      })
      const finalResult = finalRes.result || {}
      if (finalResult.ok) {
        const finalData = finalResult.data || {}
        if (String(finalData.status || '').toLowerCase() === 'done') {
          clearPendingOcrJob()
          const metadata = Object.assign({}, pendingJob, finalData)
          return { courses: mapOcrCourses(getOcrCourseItems(finalData), jobId, 'ocr', metadata), blocks: [], timings: finalData.timings || {}, jobId, input_image: metadata.input_image }
        }
        if (String(finalData.status || '').toLowerCase() === 'failed') {
          clearPendingOcrJob()
          const error = new Error(finalData.error || '课表识别失败')
          error.code = 'OCR_FAILED'
          throw error
        }
      }
    } catch (error) {
      if (error.code === 'OCR_FAILED') throw error
      // 最终查询的网络失败不应清除 pending job，允许用户稍后恢复。
      console.warn('[Xipoo] OCR 最终状态查询失败，将保留任务:', (error && error.message) || error)
    }

    // 保留本地 pending job；用户稍后可通过 resumeScheduleImport 继续查询。
    const timeoutError = new Error('识别仍在进行，可稍后继续查询')
    timeoutError.code = 'OCR_PENDING'
    throw timeoutError
  },

  /**
   * 获取并落盘 OCR 标注核验图。二进制只在云函数中转为 base64，绝不进入页面 data。
   * 标注图生成偶有短暂延迟，因此失败时仅再请求一次；调用方据此决定是否显示原始截图降级。
   */
  async fetchScheduleAnnotatedImage(jobId) {
    if (!jobId || !wx.cloud || !hasCloudEnv()) {
      return { success: false, statusCode: 0, error: 'Annotated image unavailable' }
    }
    let lastFailure = { success: false, statusCode: 0, error: 'Annotated image unavailable', fallbackToOriginal: false }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'schedule',
          data: { action: 'ocrAnnotated', jobId, payload: { jobId } }
        })
        const annotated = res.result || {}
        if (annotated.success && annotated.fileID) {
          try {
            const tempResult = await wx.cloud.getTempFileURL({ fileList: [annotated.fileID] })
            const item = tempResult && tempResult.fileList && tempResult.fileList[0]
            if (item && item.status === 0 && item.tempFileURL) {
              return {
                success: true,
                filePath: item.tempFileURL,
                fileID: annotated.fileID,
                mime: String(annotated.mime || 'image/png').toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/png'
              }
            }
            throw new Error((item && item.errMsg) || 'Annotated image storage URL unavailable')
          } catch (tempUrlError) {
            console.warn('[Xipoo] 获取 OCR 标注图临时地址失败:', (tempUrlError && tempUrlError.message) || tempUrlError)
            return { success: false, statusCode: 0, error: 'Annotated image storage URL unavailable', fallbackToOriginal: true }
          }
        }
        // 兼容尚未升级的 schedule 云函数；新版本只返回 fileID，绝不返回大图 base64。
        if (annotated.success && annotated.base64) {
          const mime = String(annotated.mime || 'image/png').toLowerCase()
          const extension = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : 'png'
          const filePath = `${wx.env.USER_DATA_PATH}/timetable-annotated-${jobId}.${extension}`
          try {
            wx.getFileSystemManager().writeFileSync(filePath, annotated.base64, 'base64')
            return { success: true, filePath, mime: extension === 'jpg' ? 'image/jpeg' : 'image/png' }
          } catch (writeError) {
            console.warn('[Xipoo] 写入 OCR 标注图失败:', (writeError && writeError.message) || writeError)
            return { success: false, statusCode: 0, error: 'Annotated image write failed', fallbackToOriginal: true }
          }
        }
        const error = annotated.error || 'Annotated image unavailable'
        lastFailure = {
          success: false,
          statusCode: Number(annotated.statusCode) || 0,
          error,
          fallbackToOriginal: Number(annotated.statusCode) === 404 || /timeout|timed out/i.test(error)
        }
      } catch (error) {
        const message = (error && (error.errMsg || error.message)) || 'Annotated image unavailable'
        lastFailure = { success: false, statusCode: 0, error: message, fallbackToOriginal: /timeout|timed out/i.test(message) }
      }
      // 明确的 404 表示该任务/服务端没有标注图；继续请求只会额外阻塞结果面板。
      // 对超时及短暂状态延迟仍保留一次重试。
      if (lastFailure.statusCode === 404) break
      if (attempt === 0) await delay(600)
    }
    console.warn('[Xipoo] OCR 标注图暂不可用:', lastFailure.statusCode || lastFailure.error)
    return lastFailure
  },

  async importScheduleImage(filePath, options = {}) {    if (!wx.cloud || !hasCloudEnv()) throw new Error('云环境不可用')

    const pending = getPendingOcrJob()
    if (pending && !options.forceNew) {
      return this.pollScheduleImport(pending.jobId, options)
    }
    if (!filePath) throw new Error('未选择课表图片')
    // 用户明确选择新图片时，旧 pending 任务不可覆盖本次导入。
    if (pending && options.forceNew) clearPendingOcrJob()

    const notifyProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
    notifyProgress({ phase: 'preparing', progress: 8 })
    const preparedFilePath = await prepareOcrImage(filePath)
    const extension = imageExtension(preparedFilePath)
    const fileName = `timetable.${extension}`
    let cloudPath
    try {
      const pathRes = await wx.cloud.callFunction({
        name: 'schedule',
        data: { action: 'ocrUploadPath' }
      })
      const pathResult = pathRes.result || {}
      if (!pathResult.ok || !pathResult.data || !pathResult.data.cloudPath) {
        throw new Error(pathResult.message || '无法获取 OCR 上传路径')
      }
      cloudPath = String(pathResult.data.cloudPath).replace(/\.png$/i, '.' + extension)
    } catch (error) {
      if (isCloudFunctionMissing(error)) throw scheduleFunctionMissingError(error)
      throw error
    }
    notifyProgress({ phase: 'uploading', progress: 22 })
    const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: preparedFilePath })

    notifyProgress({ phase: 'queued', progress: 34 })
    let submitRes
    try {
      submitRes = await wx.cloud.callFunction({
        name: 'schedule',
        data: { action: 'ocrSubmit', payload: { fileID: uploadRes.fileID, fileName } }
      })
    } catch (error) {
      if (isCloudFunctionMissing(error)) throw scheduleFunctionMissingError(error)
      throw error
    }
    const submitResult = submitRes.result || {}
    if (!submitResult.ok) throw new Error(submitResult.message || '提交 OCR 任务失败')
    const jobId = submitResult.data && submitResult.data.job_id
    if (!jobId) throw new Error('OCR 服务未返回任务编号')

    savePendingOcrJob({ jobId, fileID: uploadRes.fileID, createdAt: Date.now(), fileName, input_image: { sha256: submitResult.data && submitResult.data.image_sha256 || '' } })
    return this.pollScheduleImport(jobId, options)
  },

  // 头像上传 - 上传到云存储
  uploadAvatar(tempFilePath) {
    if (!wx.cloud || !hasCloudEnv()) {
      return Promise.resolve({ avatarUrl: tempFilePath })
    }
    const cloudPath = 'avatars/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg'
    return wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath
    }).then((res) => {
      const fileID = res.fileID
      return wx.cloud.callFunction({
        name: 'user',
        data: { action: 'uploadAvatar', payload: { fileID } }
      }).then((userRes) => {
        const result = userRes.result || {}
        if (!result.ok) throw new Error(result.message || '更新头像失败')
        const session = wx.getStorageSync('xipoo_session') || {}
        session.avatarUrl = fileID
        wx.setStorageSync('xipoo_session', session)
        return { avatarUrl: fileID }
      })
    }).catch((error) => {
      const message = String(error && (error.message || error.errMsg) || '')
      throw new Error(message || '上传头像失败')
    })
  },

  searchUsers(keyword) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'searchUser', payload: { keyword } } },
      () => mock.searchUsers(keyword)
    )
  },

  getFriendships() {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'listFriends' } },
      () => mock.getFriendships(),
      { fallbackOnError: false }
    ).then((friends) => {
      mock.syncCloudFriendships(friends)
      return friends
    })
  },

  getFriendProfile(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'getFriendProfile', payload: { friendId } } },
      () => mock.getFriendProfile(friendId),
      { fallbackOnError: false }
    )
  },

  getRequests() {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'listRequests' } },
      () => mock.getRequests(),
      { fallbackOnError: false }
    )
  },

  sendFriendRequest(friendId, message, sourceType) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'sendRequest', payload: { toUserId: friendId, message, sourceType: sourceType || 'xipoo_id' } } },
      () => mock.sendFriendRequest(friendId, message)
    )
  },

  // 微信邀请卡片直达：接受邀请并设置自己授予对方的权限
  acceptInvite(inviterId, grantLevel) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'acceptInvite', payload: { inviterId, grantLevel } } },
      () => mock.acceptInvite(inviterId, grantLevel)
    )
  },

  acceptFriendRequest(requestId, grantLevel, range) {
    const extra = range || {}
    return withCloudOrMock(
      { name: 'friend', data: { action: 'reviewRequest', payload: { requestId, action: 'accept', grantLevel, startDate: extra.startDate || '', endDate: extra.endDate || '' } } },
      () => mock.acceptFriendRequest(requestId, grantLevel, range)
    )
  },

  rejectFriendRequest(requestId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'reviewRequest', payload: { requestId, action: 'reject' } } },
      () => mock.rejectFriendRequest(requestId)
    )
  },

  removeFriend(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'deleteFriend', payload: { friendId } } },
      () => mock.removeFriend(friendId)
    )
  },

  setScheduleSharing(friendId, enabled) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'setSchedulePermission', payload: { friendUserId: friendId, enabled } } },
      () => mock.setScheduleSharing(friendId, enabled)
    )
  },

  // 设置“对方可以查看我的内容”：level/none|busy|title|detail 及附加开关
  setSharePermission(friendId, settings) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'setSharePermission', payload: Object.assign({ friendId }, settings) } },
      () => mock.setSharePermission(friendId, settings)
    )
  },

  toggleShare(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'toggleShare', payload: { friendId } } },
      () => mock.toggleShare(friendId)
    )
  },

  getFriendSchedule(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'getFriendSchedule', payload: { friendId } } },
      () => mock.getFriendSchedule(friendId)
    )
  },

  setFriendNote(friendId, note) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'setFriendNote', payload: { friendId, note } } },
      () => Promise.resolve({ note })
    )
  },

  hideFriend(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'hideFriend', payload: { friendId } } },
      () => Promise.resolve({ hidden: true, friendId })
    )
  },

  unhideFriend(friendId) {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'unhideFriend', payload: { friendId } } },
      () => Promise.resolve({ hidden: false, friendId })
    )
  },

  listHiddenFriends() {
    return withCloudOrMock(
      { name: 'friend', data: { action: 'listHiddenFriends' } },
      () => Promise.resolve([])
    )
  },

  matchWithFriend(friendId, date, range) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'matchWithFriend', payload: { friendId, date, range } } },
      () => mock.matchWithFriend(friendId, date, range)
    )
  },

  groupFreeSlots(friendIds, startDate, endDate, range) {
    // 多人共同空闲归属于 friend（共享授权）云函数，而不是体积较大的 match 社交云函数。
    // 这样三人及以上不会受到匹配/帖子等无关模块初始化的影响。
    return withCloudOrMock(
      { name: 'friend', data: { action: 'calculateAvailability', payload: { friendIds, startDate, endDate, range } } },
      () => mock.groupFreeSlots(friendIds, startDate, endDate, range),
      { fallbackOnError: false, timeoutMs: 55 * 1000 }
    ).catch((error) => {
      console.error('[Xipoo group availability] friend.calculateAvailability failed:', {
        errCode: error && error.errCode,
        errMsg: error && error.errMsg,
        message: error && error.message
      })
      throw friendlyMultiFreeError(error)
    })
  },

  getActivitySuggestions(context) {
    // 活动参考是辅助信息。调用失败由页面的本地规则推荐即时降级，不影响共同空闲主结果。
    if (!wx.cloud || !hasCloudEnv()) return Promise.reject(cloudUnavailableError())
    return callCloudWithTimeout(
      { name: 'companion', data: { action: 'activitySuggestions', payload: context } },
      8 * 1000
    )
  },

  createScheduleMatch(data) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'createScheduleMatch', payload: data } },
      () => mock.createScheduleMatch(data),
      { fallbackOnError: false, timeoutMs: 55 * 1000 }
    ).catch((error) => {
      throw friendlyMultiFreeError(error)
    })
  },

  getScheduleMatch(matchId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'getMatchResult', payload: { id: matchId } } },
      () => mock.getScheduleMatch(matchId)
    )
  },

  updateMatchSelectedTags(tagIds) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:updateSelectedTags', payload: { tagIds } } },
      () => ({ tags: tagIds })
    )
  },

  getMatchPool() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:getMatchPool' } },
      () => ({ pools: {} })
    )
  },

  setMatchPool(buddyType, config) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:setMatchPool', payload: { buddyType, config } } },
      () => ({ pools: { [buddyType]: config } }),
      // 入池保存不能在离线回退中伪装成功，否则刷新后会再次显示“未开启”。
      { fallbackOnError: false }
    )
  },

  getMatchRecommendations(buddyType) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'getMatchRecommendations', payload: { buddyType } } },
      () => mock.getMatchRecommendations ? mock.getMatchRecommendations(buddyType) : { recommendations: [], sentCount: 0, total: 0 }
    )
  },

  sendMatchInterest(userId, buddyType) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:sendInterest', payload: { toUserId: userId, buddyType } } },
      () => mock.sendMatchInterest ? mock.sendMatchInterest(userId, buddyType) : { autoMatched: false }
    )
  },

  getMatchIncomingInterests() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:getIncomingInterests' } },
      () => mock.getMatchIncomingInterests ? mock.getMatchIncomingInterests() : []
    )
  },

  getMatchSentInterests() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:getSentInterests' } },
      () => mock.getMatchSentInterests ? mock.getMatchSentInterests() : []
    )
  },

  getMyMatchPairs() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:getMyMatches' } },
      () => mock.getMyMatchPairs ? mock.getMyMatchPairs() : []
    )
  },

  acceptMatchInterest(requestId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:acceptInterest', payload: { requestId } } },
      () => mock.acceptMatchInterest ? mock.acceptMatchInterest(requestId) : {}
    )
  },

  ignoreMatchInterest(requestId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:ignoreInterest', payload: { requestId } } },
      () => true
    )
  },

  cancelMatchInterest(requestId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:cancelInterest', payload: { requestId } } },
      () => true
    )
  },

  unmatchPair(pairId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:unmatch', payload: { pairId } } },
      () => true
    )
  },

  blockMatchUser(userId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'match:blockUser', payload: { userId } } },
      () => ({ blocked: true })
    )
  },

  getCourseRecommendations(courseId, mode, sameGradeOnly, filterTags, genderFilter) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'getCourseRecommendations', payload: { courseId, mode, sameGradeOnly, filterTags, genderFilter } } },
      () => ({ recommendations: [], total: 0 })
    )
  },

  listPosts(type, courseId) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'listPosts', payload: { type, courseId } } },
      () => mock.getBuddyPosts ? mock.getBuddyPosts({ type, courseId }) : []
    )
  },

  getMyJoinedGroups() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'myJoinedGroups' } },
      () => []
    )
  },

  createPost(data) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'createPost', payload: data } },
      () => mock.createBuddyPost ? mock.createBuddyPost(data) : { id: 'mock-post-' + Date.now() }
    )
  },

  getPost(id) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'getPost', payload: { id } } },
      () => mock.getBuddyPost ? mock.getBuddyPost(id) : null
    )
  },

  closePost(id) {
    return withCloudOrMock(
      { name: 'match', data: { action: 'closePost', payload: { id } } },
      () => ({ closed: true })
    )
  },

  listNotifications() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'listNotifications' } },
      () => []
    )
  },

  markNotificationsRead() {
    return withCloudOrMock(
      { name: 'match', data: { action: 'markNotificationsRead' } },
      () => ({ marked: true })
    )
  },

  getCourseBuddyStatus(eventId) {
    return withFallback(() => request(`/api/v1/courses/${eventId}/buddy-opt-in`), () => mock.getCourseBuddyStatus(eventId))
  },

  setCourseBuddyOptIn(eventId, data) {
    return withFallback(
      () => request(`/api/v1/courses/${eventId}/buddy-opt-in`, { method: 'PUT', data }),
      () => mock.setCourseBuddyOptIn(eventId, data)
    )
  },

  removeCourseBuddyOptIn(eventId) {
    return withFallback(
      () => request(`/api/v1/courses/${eventId}/buddy-opt-in`, { method: 'DELETE' }),
      () => mock.removeCourseBuddyOptIn(eventId)
    )
  },

  getCourseBuddyCandidates(eventId) {
    return withFallback(
      () => request(`/api/v1/courses/${eventId}/buddy-candidates`),
      () => mock.getCourseBuddyCandidates(eventId)
    )
  },

  createCourseTeam(data) {
    return withFallback(
      () => request('/api/v1/course-teams', { method: 'POST', data }),
      () => mock.createCourseTeam(data)
    )
  },

  getCourseTeams(eventId) {
    return withFallback(
      () => request(`/api/v1/courses/${eventId}/teams`),
      () => mock.getCourseTeams(eventId)
    )
  },

  getCourseTeam(teamId) {
    return withFallback(
      () => request(`/api/v1/course-teams/${teamId}`),
      () => mock.getCourseTeam(teamId)
    )
  },

  deleteCourseTeam(teamId) {
    return withFallback(
      () => request(`/api/v1/course-teams/${teamId}`, { method: 'DELETE' }),
      () => mock.deleteCourseTeam(teamId)
    )
  },

  applyCourseTeam(teamId, data) {
    return withFallback(
      () => request(`/api/v1/course-teams/${teamId}/applications`, { method: 'POST', data }),
      () => mock.applyCourseTeam(teamId, data)
    )
  },

  acceptCourseTeamApplication(applicationId) {
    return withFallback(
      () => request(`/api/v1/course-team-applications/${applicationId}/accept`, { method: 'POST' }),
      () => mock.acceptCourseTeamApplication(applicationId)
    )
  },

  rejectCourseTeamApplication(applicationId) {
    return withFallback(
      () => request(`/api/v1/course-team-applications/${applicationId}/reject`, { method: 'POST' }),
      () => mock.rejectCourseTeamApplication(applicationId)
    )
  },

  withdrawCourseTeamApplication(applicationId) {
    return withFallback(
      () => request(`/api/v1/course-team-applications/${applicationId}`, { method: 'DELETE' }),
      () => mock.withdrawCourseTeamApplication(applicationId)
    )
  },

  leaveCourseTeam(teamId) {
    return withFallback(
      () => request(`/api/v1/course-teams/${teamId}/leave`, { method: 'POST' }),
      () => mock.leaveCourseTeam(teamId)
    )
  },

  getBuddyCenter() {
    return withFallback(
      () => request('/api/v1/buddy-center'),
      () => mock.getBuddyCenter()
    )
  },

  getBuddyScopeTerms() {
    return withFallback(
      () => request('/api/v1/buddy-scopes/terms'),
      () => mock.getBuddyScopeTerms()
    )
  },

  getBuddyScopes(term) {
    return withFallback(
      () => request(`/api/v1/buddy-scopes?term=${encodeURIComponent(term || '')}`),
      () => mock.getBuddyScopes(term)
    )
  },

  getBuddyOptIn(scopeKey) {
    return withFallback(
      () => request(`/api/v1/buddy-opt-ins/${encodeURIComponent(scopeKey)}`),
      () => mock.getBuddyOptIn(scopeKey)
    )
  },

  setBuddyOptIn(scopeKey, data) {
    return withFallback(
      () => request(`/api/v1/buddy-opt-ins/${encodeURIComponent(scopeKey)}`, { method: 'PUT', data }),
      () => mock.setBuddyOptIn(scopeKey, data)
    )
  },

  removeBuddyOptIn(scopeKey) {
    return withFallback(
      () => request(`/api/v1/buddy-opt-ins/${encodeURIComponent(scopeKey)}`, { method: 'DELETE' }),
      () => mock.removeBuddyOptIn(scopeKey)
    )
  },

  getBuddyCandidates(scopeKey) {
    return withFallback(
      () => request(`/api/v1/buddy-candidates?scope_key=${encodeURIComponent(scopeKey)}`),
      () => mock.getBuddyCandidates(scopeKey)
    )
  },

  getBuddyMatchRequests() {
    return withFallback(
      () => request('/api/v1/buddy-match-requests'),
      () => mock.getBuddyMatchRequests()
    )
  },

  createBuddyMatchRequest(data) {
    return withFallback(
      () => request('/api/v1/buddy-match-requests', { method: 'POST', data }),
      () => mock.createBuddyMatchRequest(data)
    )
  },

  acceptBuddyMatchRequest(id) {
    return withFallback(
      () => request(`/api/v1/buddy-match-requests/${id}/accept`, { method: 'POST' }),
      () => mock.acceptBuddyMatchRequest(id)
    )
  },

  rejectBuddyMatchRequest(id) {
    return withFallback(
      () => request(`/api/v1/buddy-match-requests/${id}/reject`, { method: 'POST' }),
      () => mock.rejectBuddyMatchRequest(id)
    )
  },

  createBuddyPost(data) {
    return withFallback(
      () => request('/api/v1/buddy-posts', { method: 'POST', data }),
      () => mock.createBuddyPost(data)
    )
  },

  getBuddyPosts(filters = {}) {
    const query = Object.keys(filters)
      .filter((key) => filters[key])
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(filters[key])}`)
      .join('&')
    return withFallback(
      () => request(`/api/v1/buddy-posts${query ? `?${query}` : ''}`),
      () => mock.getBuddyPosts(filters)
    )
  },

  getBuddyPost(postId) {
    return withFallback(
      () => request(`/api/v1/buddy-posts/${postId}`),
      () => mock.getBuddyPost(postId)
    )
  },

  deleteBuddyPost(postId) {
    return withFallback(
      () => request(`/api/v1/buddy-posts/${postId}`, { method: 'DELETE' }),
      () => mock.deleteBuddyPost(postId)
    )
  },

  applyBuddyPost(postId, data) {
    return withFallback(
      () => request(`/api/v1/buddy-posts/${postId}/applications`, { method: 'POST', data }),
      () => mock.applyBuddyPost(postId, data)
    )
  },

  acceptBuddyApplication(applicationId) {
    return withFallback(
      () => request(`/api/v1/buddy-applications/${applicationId}/accept`, { method: 'POST' }),
      () => mock.acceptBuddyApplication(applicationId)
    )
  },

  rejectBuddyApplication(applicationId) {
    return withFallback(
      () => request(`/api/v1/buddy-applications/${applicationId}/reject`, { method: 'POST' }),
      () => mock.rejectBuddyApplication(applicationId)
    )
  },

  leaveBuddyPost(postId) {
    return withFallback(
      () => request(`/api/v1/buddy-posts/${postId}/leave`, { method: 'POST' }),
      () => mock.leaveBuddyPost(postId)
    )
  },

  blockUser(userId) {
    return withFallback(
      () => request(`/api/v1/users/${userId}/block`, { method: 'POST' }),
      () => mock.blockUser(userId)
    )
  },

  reportUser(userId, data) {
    return withFallback(
      () => request(`/api/v1/users/${userId}/report`, { method: 'POST', data }),
      () => mock.reportUser(userId, data)
    )
  },

  submitFeedback(data) {
    return withCloudOrMock(
      { name: 'buddy', data: { action: 'submitFeedback', payload: data } },
      () => mock.submitFeedback(data)
    )
  },

  listMyFeedbacks() {
    return withCloudOrMock(
      { name: 'buddy', data: { action: 'listMyFeedbacks', payload: {} } },
      () => {
        // 无云环境：反馈写入本地 storage，这里倒序读回（新提交在前）
        const stored = wx.getStorageSync('xipoo_feedbacks') || []
        return stored.slice().reverse().map((f, index) => ({
          id: `local-${index}`,
          source: 'local',
          type: f.type || '其他',
          content: f.content || '',
          images: Array.isArray(f.images) ? f.images : [],
          contact: f.contact || '',
          status: f.status || 'pending',
          adminNote: f.adminNote || '',
          createdAt: f.createTime || f.createdAt || '',
          resolvedAt: f.resolvedAt || ''
        }))
      }
    )
  },

  // ===== Activity 模块（统一走 activity 云函数） =====
  getActivities(options = {}) {
    const page = Math.max(1, Number(options.page) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(options.pageSize) || 20))
    return withCloudOrMock(
      { name: 'activity', data: { action: 'listActivities', payload: { page, pageSize } } },
      () => {
        // mock 侧同样返回分页结构，保证前端分页逻辑在两种数据源下行为一致
        const all = mock.getActivities()
        const start = (page - 1) * pageSize
        const totalPages = Math.ceil(all.length / pageSize)
        return {
          list: all.slice(start, start + pageSize),
          pagination: { page, pageSize, total: all.length, totalPages, hasMore: page < totalPages }
        }
      }
    )
  },

  getActivitySubscriptions() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'getSubscriptions' } },
      () => mock.getActivitySubscriptions()
    )
  },

  // 发现页运营位（热门轮播 / 推荐双列），独立于订阅与分页拉取
  getCuratedActivities() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'getCuratedActivities' } },
      () => mock.getCuratedActivities()
    )
  },

  // ===== 噗噗推广位（companion 云函数） =====
  getCompanionAds() {
    return withCloudOrMock(
      { name: 'companion', data: { action: 'ads' } },
      () => mock.getCompanionAds()
    ).then((data) => (data && Array.isArray(data.ads) ? data.ads : []))
  },

  trackCompanionAd(adId, type, scene) {
    return withCloudOrMock(
      { name: 'companion', data: { action: 'track', payload: { adId, type, scene: scene || '' } } },
      () => mock.trackCompanionAd(adId, type, scene)
    ).catch(() => null) // 埋点失败静默，不影响主流程
  },

  // 活动卡片点击上报（模块 2）：跳转类与详情类点击都记录，失败静默不阻塞跳转
  trackActivityClick(activityId, jumpType) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'trackClick', payload: { activityId, jumpType: jumpType || '' } } },
      () => mock.trackActivityClick(activityId, jumpType)
    ).catch(() => null)
  },

  getActivityPublisher(key) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'getPublisherProfile', payload: { key } } },
      () => mock.getActivityPublisher(key)
    )
  },

  getPaiManagers() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'listPaiManagers', payload: {} } },
      () => mock.getPaiManagers()
    ).then((data) => (data && Array.isArray(data.list) ? data.list : []))
  },

  toggleActivitySubscription(key) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'toggleSubscription', payload: { key } } },
      () => mock.toggleActivitySubscription(key)
    )
  },

  subscribeAllActivitySources() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'subscribeAll' } },
      () => mock.subscribeAllActivitySources()
    )
  },

  resetActivitySubscriptions() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'resetSubscriptions' } },
      () => mock.resetActivitySubscriptions()
    )
  },

  getActivity(id) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'getActivityDetail', payload: { id } } },
      () => mock.getActivity(id)
    )
  },

  getActivityRegistrations() {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'getRegistrations' } },
      () => mock.getActivityRegistrations()
    )
  },

  registerActivity(id) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'registerActivity', payload: { id } } },
      () => mock.registerActivity(id)
    )
  },

  cancelActivityRegistration(id) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'cancelRegistration', payload: { id } } },
      () => mock.cancelActivityRegistration(id)
    )
  },

  addActivityToSchedule(id) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'addToSchedule', payload: { id } } },
      () => mock.addActivityToSchedule(id)
    )
  },

  toggleActivity(id, field) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'toggleInteraction', payload: { id, field } } },
      () => mock.toggleActivity(id, field)
    )
  },

  addActivityComment(id, text) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'commentActivity', payload: { id, text } } },
      () => mock.addActivityComment(id, text)
    )
  },

  // ===== 自研预约（模块 3）：reservation 云函数 =====
  getReservationSlots(activityId) {
    return withCloudOrMock(
      { name: 'reservation', data: { action: 'getSlots', payload: { activityId } } },
      () => mock.getReservationSlots(activityId)
    )
  },

  submitReservation(activityId, slotId) {
    return withCloudOrMock(
      { name: 'reservation', data: { action: 'submitOrder', payload: { activityId, slotId } } },
      () => mock.submitReservation(activityId, slotId)
    )
  },

  cancelReservation(orderId) {
    return withCloudOrMock(
      { name: 'reservation', data: { action: 'cancelOrder', payload: { orderId } } },
      () => mock.cancelReservation(orderId)
    )
  },

  getMyReservations() {
    return withCloudOrMock(
      { name: 'reservation', data: { action: 'myOrders' } },
      () => mock.getMyReservations()
    )
  },

  // ===== 活动分类（模块 4）：scope 可选（'paispace' | 'global'） =====
  getActivityCategories(scope) {
    return withCloudOrMock(
      { name: 'activity', data: { action: 'listCategories', payload: { scope: scope || '' } } },
      () => mock.getActivityCategories(scope)
    ).then((data) => (data && Array.isArray(data.list) ? data.list : []))
  },

  // ===== 课程表导出 iCalendar (.ics) =====
  /**
   * 调用 courseIcs 云函数：生成 ICS → 上传云存储 → 返回 HTTPS 下载链接
   *
   * 【Android】：用 downloadUrl 下载文件后 wx.openDocument 打开
   * 【iOS】：用 downloadUrl 传入 webview 中转页，在 Safari 中打开
   *
   * @param {Array} courses - 课程数组
   * @returns {Promise<{fileID: string, downloadUrl: string, courseCount: number}>}
   */
  exportCourseIcs(courses) {
    if (!Array.isArray(courses) || !courses.length) {
      return Promise.reject(new Error('课程列表为空'))
    }

    // 构建精简课程数据
    var payload = courses.map(function (c) {
      var weeks = normalizeCourseWeeks(c)
      var weekStart = weeks.length ? weeks[0] : (Number(c.weekStart) || Number(c.week_start) || 1)
      var weekEnd = weeks.length ? weeks[weeks.length - 1] : (Number(c.weekEnd) || Number(c.week_end) || weekStart)
      var inferredType = c.weekType || 'all'
      if (!c.weekType && weeks.length > 1) {
        var stepTwo = weeks.every(function (w, i) { return i === 0 || w - weeks[i - 1] === 2 })
        if (stepTwo && weeks.every(function (w) { return w % 2 === weeks[0] % 2 })) inferredType = weeks[0] % 2 ? 'odd' : 'even'
      }
      return {
        title: c.title || '',
        location: c.place || c.location || '',
        termStart: c.termStart || '',
        weekStart: weekStart,
        weekEnd: weekEnd,
        weekSet: weeks,
        weekType: inferredType,
        weekday: Number(c.weekday) || 1,
        startTime: c.start || c.startTime || '09:00',
        endTime: c.end || c.endTime || '10:00',
        teacher: c.teacher || '',
        courseCode: c.courseCode || ''
      }
    })

    // 必须走云函数（需要云存储上传，本地无法替代）
    if (!wx.cloud || !hasCloudEnv()) {
      return Promise.reject(new Error('云环境不可用，请检查网络'))
    }

    return wx.cloud.callFunction({
      name: 'courseIcs',
      data: { courses: payload }
    }).then(function (res) {
      var result = res.result || {}
      if (!result.ok) {
        var detail = result.errors ? result.errors.join('；') : (result.message || '生成日历失败')
        throw new Error(detail)
      }
      // 返回 { fileID, downloadUrl, cloudPath, courseCount }
      return result.data
    }).catch(function (err) {
      var msg = String(err && (err.message || err.errMsg) || '')
      if (msg.indexOf('-501000') !== -1 || msg.indexOf('not found') !== -1) {
        throw new Error('courseIcs 云函数尚未部署，请在开发者工具中右键 cloudfunctions/courseIcs → 上传并部署')
      }
      throw err
    })
  }
}
