const cloud = require('wx-server-sdk')
const axios = require('axios')
const crypto = require('crypto')
const secCheck = require('./secCheck')
const { calculateFreeTimeBitmap } = require('./freeTime')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// OCR 云托管位于独立的 prod 环境，不能使用旧环境遗留的 flask-glt6 域名。
// 允许以云函数环境变量覆盖，便于后续切换到自定义域名。
const CONTAINER_BASE = (process.env.OCR_CONTAINER_BASE || 'https://flask-tbst-288753-10-1460213124.sh.run.tcloudbase.com').replace(/\/$/, '')
// OCR submission only creates an asynchronous job; it must not be treated as
// a 30-second synchronous OCR request.  A cold Cloud Run instance can spend
// tens of seconds starting before /parse returns 202.  Keep enough headroom
// for that startup and let the client continue polling the job afterwards.
const REQUEST_TIMEOUT = 55000
// 图片经云存储下载后再提交 OCR，保留原图细节；与小程序端 15MB 上限同步。
const MAX_OCR_IMAGE_BYTES = 15 * 1024 * 1024
const OCR_JOB_TTL_MS = 30 * 60 * 1000

function redactId(value, keep = 6) {
  const text = String(value || '')
  if (text.length <= keep * 2) return text ? `${text.slice(0, 3)}...` : ''
  return `${text.slice(0, keep)}...${text.slice(-keep)}`
}

function isAllowedOcrFileId(fileID, userId) {
  const value = String(fileID || '')
  const path = value.replace(/^cloud:\/\/[^/]+\//, '')
  // New clients receive a user-scoped path. Keep accepting the legacy
  // ocr_temp/<random> path during migration so clients with an older bundle
  // (and pending uploads created before deployment) are not rejected.
  return path.startsWith(`ocr_temp/${String(userId || '')}/`) || path.startsWith('ocr_temp/')
}

async function ocrUploadPath(userId) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return ok({ cloudPath: `ocr_temp/${userId}/${suffix}.png`, expiresInMs: 10 * 60 * 1000 })
}

// OCR 服务偶尔会把一个涂黑的课表单元格切成上下/左右两个框。
// 在中转层做一次保守合并：只有课程代码和教学班一致，且字段完全相同、
// 或两个框明显相邻/重叠时才合并，避免把相邻的真实课程误合并。
function ocrText(value) { return String(value == null ? '' : value).trim() }
function ocrCode(item) { return ocrText(item.course_code || item.courseCode || item.code).toUpperCase().replace(/\s+/g, '') }
function ocrGroup(item) { return ocrText(item.group || item.section || item.class_group).toUpperCase() }
function ocrBox(item) {
  const b = item && (item.bbox || item.box || item.rect || item.bounds)
  if (Array.isArray(b) && b.length >= 4) return { x: +b[0], y: +b[1], w: +b[2], h: +b[3] }
  if (!b || typeof b !== 'object') return null
  const x = +(b.x != null ? b.x : b.left), y = +(b.y != null ? b.y : b.top)
  const w = +(b.w != null ? b.w : (b.width != null ? b.width : (+b.right - x)))
  const h = +(b.h != null ? b.h : (b.height != null ? b.height : (+b.bottom - y)))
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null
}
function ocrBoxesJoinable(a, b) {
  const A = ocrBox(a), B = ocrBox(b)
  if (!A || !B) return false
  const xOverlap = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x))
  const yOverlap = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y))
  const horizontal = xOverlap >= Math.min(A.w, B.w) * 0.5 && Math.abs((A.y + A.h) - B.y) <= Math.max(A.h, B.h) * 0.18
  const vertical = yOverlap >= Math.min(A.h, B.h) * 0.5 && Math.abs((A.x + A.w) - B.x) <= Math.max(A.w, B.w) * 0.18
  const overlap = xOverlap >= Math.min(A.w, B.w) * 0.5 && yOverlap >= Math.min(A.h, B.h) * 0.5
  return horizontal || vertical || overlap
}
function mergeOcrItem(target, source) {
  const out = Object.assign({}, target)
  Object.keys(source || {}).forEach((key) => {
    const value = source[key]
    if (out[key] == null || out[key] === '' || (Array.isArray(out[key]) && !out[key].length)) out[key] = value
  })
  const weeks = [].concat(out.week_set || out.weekSet || [], source.week_set || source.weekSet || [])
    .map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (weeks.length) out.week_set = Array.from(new Set(weeks))
  const A = ocrBox(target), B = ocrBox(source)
  if (A && B) out.bbox = { x: Math.min(A.x, B.x), y: Math.min(A.y, B.y), w: Math.max(A.x + A.w, B.x + B.w) - Math.min(A.x, B.x), h: Math.max(A.y + A.h, B.y + B.h) - Math.min(A.y, B.y) }
  const indexes = [target.ocr_index, target.ocrIndex, source.ocr_index, source.ocrIndex].map(Number).filter(Number.isFinite)
  if (indexes.length) out.ocr_index = Math.min.apply(null, indexes)
  return out
}
function normalizeOcrCourses(items) {
  if (!Array.isArray(items)) return items
  const result = []
  items.slice(0, 500).forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const code = ocrCode(item), group = ocrGroup(item)
    let match = -1
    for (let i = 0; i < result.length; i += 1) {
      const existing = result[i]
      if (!code || code !== ocrCode(existing) || group !== ocrGroup(existing)) continue
      const sameSession = ocrText(item.date) === ocrText(existing.date) &&
        ocrText(item.start_time || item.startTime || item.start) === ocrText(existing.start_time || existing.startTime || existing.start) &&
        ocrText(item.end_time || item.endTime || item.end) === ocrText(existing.end_time || existing.endTime || existing.end) &&
        ocrText(item.room || item.place) === ocrText(existing.room || existing.place)
      const incomplete = [item.start_time || item.start, item.end_time || item.end, item.room || item.place].some((v) => !ocrText(v)) ||
        [existing.start_time || existing.start, existing.end_time || existing.end, existing.room || existing.place].some((v) => !ocrText(v))
      if (sameSession || (incomplete && ocrBoxesJoinable(existing, item)) || ocrBoxesJoinable(existing, item)) { match = i; break }
    }
    if (match < 0) result.push(Object.assign({}, item))
    else result[match] = mergeOcrItem(result[match], item)
  })
  return result
}

const db = cloud.database()
const users = db.collection('users')
const schedules = db.collection('schedules')
// OCR 课程存于 schedules；核验图是批次级附件，只保存云存储文件引用。
const ocrImportBatches = db.collection('ocr_import_batches')

function ok(data = {}, message = 'success') {
  return { ok: true, data, message }
}
function fail(errorCode, message) {
  return { ok: false, errorCode, message }
}

function httpErrorMessage(err) {
  const data = err && err.response && err.response.data
  if (data && typeof data === 'object') {
    return data.error || data.message || data.error_code || err.message
  }
  return (err && err.message) || 'OCR service request failed'
}

function normalizeCourseCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/\s+/g, '')
  const match = normalized.match(/[A-Z]{2,}\d{3}[A-Z]*/)
  return match ? match[0] : ''
}

function generateCourseId(courseCode, section) {
  const code = normalizeCourseCode(courseCode)
  const sec = String(section || '').trim().toUpperCase()
  return sec ? `${code}_${sec}` : code
}

async function currentUserId(openid) {
  const found = await users.where({ openid }).limit(1).get()
  const record = found.data && found.data[0]
  return record ? record.xipooId : null
}

function toCourse(doc) {
  const copy = Object.assign({}, doc)
  delete copy._id
  delete copy._openid
  delete copy.userId
  return copy
}

async function axiosWithRetry(config, maxRetries = 2) {
  const startTime = Date.now()
  const effectiveConfig = { ...config, timeout: config.timeout || REQUEST_TIMEOUT }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios(effectiveConfig)
      console.log(`[schedule:http] ${config.method || 'GET'} ${effectiveConfig.url} ${res.status} ${Date.now() - startTime}ms`)
      return res
    } catch (err) {
      const elapsed = Date.now() - startTime
      const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || (err.response && err.response.status >= 500)
      if (attempt < maxRetries && isRetryable) {
        const delay = 2000 * (attempt + 1)
        console.warn(`[schedule:http] retry ${attempt + 1}/${maxRetries} for ${effectiveConfig.url} (${elapsed}ms, delay ${delay}ms)`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      const status = err.response && err.response.status
      console.error(`[schedule:http] FAIL ${effectiveConfig.url} status=${status || 'network'} attempt=${attempt} elapsed=${elapsed}ms`, httpErrorMessage(err))
      throw err
    }
  }
}

async function listSchedules(userId) {
  const res = await schedules.where({ userId }).limit(200).get()
  return ok((res.data || []).map(toCourse))
}

async function upsertSchedule(userId, payload = {}) {
  const course = payload || {}
  const id = course.id || `manual-${Date.now()}`
  const normalized = Object.assign({}, course, {
    id,
    weekday: course.weekday === undefined || course.weekday === '' ? course.weekday : Number(course.weekday),
    courseCode: normalizeCourseCode(course.courseCode || course.title),
    term: course.term || '2025-26-S2',
    section: String(course.section || '').trim().toUpperCase(),
    courseId: course.courseId || generateCourseId(course.courseCode || course.title, course.section),
    confirmed: course.confirmed !== false
  })
  delete normalized._id
  delete normalized._openid
  const existing = await schedules.where({ userId, id }).limit(1).get()
  if (existing.data && existing.data[0]) {
    await schedules.doc(existing.data[0]._id).update({ data: Object.assign({}, normalized, { userId, updatedAt: db.serverDate() }) })
  } else {
    await schedules.add({ data: Object.assign({}, normalized, { userId, createdAt: db.serverDate(), updatedAt: db.serverDate() }) })
  }
  return ok(normalized)
}

async function upsertSchedulesBatch(userId, payload = {}) {
  const courses = Array.isArray(payload.courses) ? payload.courses.slice(0, 100) : []
  if (!courses.length) return fail('INVALID_PARAM', '缺少课程数据')

  const normalizedCourses = courses.map((course, index) => {
    const source = course || {}
    const id = source.id || `import-${Date.now()}-${index}`
    const normalized = Object.assign({}, source, {
      id,
      weekday: source.weekday === undefined || source.weekday === '' ? source.weekday : Number(source.weekday),
      courseCode: normalizeCourseCode(source.courseCode || source.title),
      term: source.term || '2025-26-S2',
      section: String(source.section || '').trim().toUpperCase(),
      courseId: source.courseId || generateCourseId(source.courseCode || source.title, source.section),
      confirmed: source.confirmed !== false
    })
    delete normalized._id
    delete normalized._openid
    return normalized
  })

  const existingRes = await schedules.where({ userId }).limit(500).get()
  const existingById = new Map((existingRes.data || []).map((item) => [item.id, item]))
  const now = db.serverDate()
  await Promise.all(normalizedCourses.map((course) => {
    const existing = existingById.get(course.id)
    if (existing) {
      return schedules.doc(existing._id).update({ data: Object.assign({}, course, { userId, updatedAt: now }) })
    }
    return schedules.add({ data: Object.assign({}, course, { userId, createdAt: now, updatedAt: now }) })
  }))

  try {
    const allUserCourses = await schedules.where({ userId }).limit(500).get()
    const bitmap = calculateFreeTimeBitmap(allUserCourses.data || [])
    const userRecord = await users.where({ xipooId: userId }).limit(1).get()
    if (userRecord.data && userRecord.data[0]) {
      await users.doc(userRecord.data[0]._id).update({ data: { freeTimeBitmap: bitmap, updatedAt: db.serverDate() } })
    }
  } catch (e) { console.error('[schedule] batch freeTimeBitmap update failed', e) }

  return ok({ courses: normalizedCourses, count: normalizedCourses.length })
}

async function deleteSchedule(userId, payload = {}) {
  const id = payload.id || payload.scheduleId || payload.courseId
  const ids = Array.isArray(payload.ids) ? payload.ids : []
  // 批量删除
  if (ids.length) {
    let removed = 0
    while (true) {
      const res = await schedules.where({ userId, id: db.command.in(ids.slice(0, 100)) }).limit(100).get()
      const records = res.data || []
      if (!records.length) break
      await Promise.all(records.map((record) => schedules.doc(record._id).remove()))
      removed += records.length
      if (records.length < 100) break
    }
    return ok({ ids, removed })
  }
  if (!id) return fail('INVALID_PARAM', '缺少课程 id')
  const res = await schedules.where({ userId, id }).get()
  for (const doc of res.data || []) { await schedules.doc(doc._id).remove() }
  return ok({ id, removed: (res.data || []).length })
}

async function listOcrImportBatches(userId) {
  const res = await schedules.where({ userId, source: 'ocr' }).limit(500).get()
  let artifactRecords = []
  try {
    const artifactRes = await ocrImportBatches.where({ userId }).limit(500).get()
    artifactRecords = artifactRes.data || []
  } catch (error) {
    // 新集合尚未创建或历史环境未部署时，课程记录仍应可查看。
    console.warn('[schedule] OCR batch artifacts unavailable', error && error.message)
  }
  const artifactsByBatchId = new Map(artifactRecords.map((item) => [String(item.batchId), item]))
  const batches = new Map()

  ;(res.data || []).forEach((course) => {
    if (!course.importBatchId) return
    const batch = batches.get(course.importBatchId) || {
      id: course.importBatchId,
      importedAt: course.importedAt || '',
      courseCount: 0,
      preview: []
    }
    batch.courseCount += 1
    if (course.importedAt && (!batch.importedAt || course.importedAt < batch.importedAt)) batch.importedAt = course.importedAt
    if (course.title && batch.preview.length < 3) batch.preview.push(course.title)
    batches.set(course.importBatchId, batch)
  })

  const result = Array.from(batches.values()).map((batch) => {
    const artifact = artifactsByBatchId.get(String(batch.id))
    return Object.assign(batch, artifact ? {
      verificationFileId: artifact.verificationFileId || '',
      verificationMime: artifact.verificationMime || '',
      verificationStatus: artifact.verificationStatus || 'available'
    } : {
      verificationFileId: '',
      verificationMime: '',
      // 历史批次此前只保存课程，页面会尝试按 batchId 从 OCR 服务补取。
      verificationStatus: 'not_saved'
    })
  })
  return ok(result.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))))
}

async function saveOcrImportBatchArtifact(userId, payload = {}) {
  const batchId = String(payload.batchId || '')
  const verificationFileId = String(payload.verificationFileId || '')
  if (!batchId || !verificationFileId) return fail('INVALID_PARAM', '缺少核验图批次或文件编号')
  const verificationMime = String(payload.verificationMime || 'image/png').toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const existing = await ocrImportBatches.where({ userId, batchId }).limit(1).get()
  const data = {
    userId,
    batchId,
    verificationFileId,
    verificationMime,
    verificationStatus: 'available',
    updatedAt: db.serverDate()
  }
  if (existing.data && existing.data[0]) {
    await ocrImportBatches.doc(existing.data[0]._id).update({ data })
  } else {
    await ocrImportBatches.add({ data: Object.assign({}, data, { createdAt: db.serverDate() }) })
  }
  return ok({ batchId, verificationFileId, verificationMime, verificationStatus: 'available' })
}

async function removeOcrImportBatchArtifact(userId, batchId) {
  const result = await ocrImportBatches.where({ userId, batchId }).limit(20).get()
  const records = result.data || []
  const fileList = records.map((item) => item.verificationFileId).filter(Boolean)
  await Promise.all(records.map((item) => ocrImportBatches.doc(item._id).remove()))
  if (fileList.length) {
    try { await cloud.deleteFile({ fileList }) } catch (error) { console.warn('[schedule] OCR artifact file cleanup failed', error && error.message) }
  }
}

async function deleteOcrImportBatch(userId, payload = {}) {
  const batchId = String(payload.batchId || '')
  if (!batchId) return fail('INVALID_PARAM', '缺少导入批次编号')

  let removed = 0
  while (true) {
    const res = await schedules.where({ userId, importBatchId: batchId }).limit(100).get()
    const records = res.data || []
    if (!records.length) break
    await Promise.all(records.map((record) => schedules.doc(record._id).remove()))
    removed += records.length
  }

  try { await removeOcrImportBatchArtifact(userId, batchId) } catch (error) { console.warn('[schedule] OCR artifact cleanup failed', error && error.message) }

  try {
    const allUserCourses = await schedules.where({ userId }).limit(500).get()
    const bitmap = calculateFreeTimeBitmap(allUserCourses.data || [])
    const userRecord = await users.where({ xipooId: userId }).limit(1).get()
    if (userRecord.data && userRecord.data[0]) {
      await users.doc(userRecord.data[0]._id).update({ data: { freeTimeBitmap: bitmap, updatedAt: db.serverDate() } })
    }
  } catch (e) { console.error('[schedule] import batch freeTimeBitmap update failed', e) }

  return ok({ batchId, removed })
}

async function clearSchedules(userId) {
  let removed = 0
  while (true) {
    const res = await schedules.where({ userId }).limit(100).get()
    const records = res.data || []
    if (!records.length) break
    await Promise.all(records.map((record) => schedules.doc(record._id).remove()))
    removed += records.length
  }

  // 清空课程时同时移除该用户识别批次的核验图，避免孤儿文件。
  try {
    const artifacts = await ocrImportBatches.where({ userId }).limit(500).get()
    const fileList = (artifacts.data || []).map((item) => item.verificationFileId).filter(Boolean)
    await Promise.all((artifacts.data || []).map((item) => ocrImportBatches.doc(item._id).remove()))
    if (fileList.length) await cloud.deleteFile({ fileList })
  } catch (error) { console.warn('[schedule] clear OCR artifact cleanup failed', error && error.message) }

  try {
    const bitmap = calculateFreeTimeBitmap([])
    const userRecord = await users.where({ xipooId: userId }).limit(1).get()
    if (userRecord.data && userRecord.data[0]) {
      await users.doc(userRecord.data[0]._id).update({ data: { freeTimeBitmap: bitmap, updatedAt: db.serverDate() } })
    }
  } catch (e) { console.error('[schedule] clear freeTimeBitmap update failed', e) }

  return ok({ removed })
}

async function getActivitySchedule(userId) {
  try {
    const res = await db.collection('activity_schedules').where({ userId }).limit(200).get()
    return ok((res.data || []).map(toCourse))
  } catch (err) { return ok([]) }
}

// ---- OCR 中转 ----

async function ocrSubmit(userId, payload) {
  const fileID = (payload && payload.fileID) || ''
  if (!fileID) return fail('INVALID_PARAM', '缺少 fileID')
  if (!isAllowedOcrFileId(fileID, userId)) return fail('OCR_FILE_FORBIDDEN', '课表图片不属于当前用户')
  try {
    const requestId = `ocr-submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const startedAt = Date.now()
    console.log('[schedule:ocr] submit_start', { requestId, fileID: redactId(fileID), userId: redactId(userId) })
    const downloadRes = await cloud.downloadFile({ fileID })
    if (!downloadRes.fileContent || !Buffer.isBuffer(downloadRes.fileContent)) {
      return fail('OCR_UPLOAD_INVALID', '无法读取已上传的课表图片')
    }
    if (downloadRes.fileContent.length > MAX_OCR_IMAGE_BYTES) {
      return fail('OCR_UPLOAD_TOO_LARGE', '课表图片不能超过 15MB，请选择更小的图片')
    }
    const imageBase64 = downloadRes.fileContent.toString('base64')
    const imageSha256 = crypto.createHash('sha256').update(downloadRes.fileContent).digest('hex')
    console.log('[schedule:ocr] submit image bytes:', downloadRes.fileContent.length, 'sha256:', redactId(imageSha256, 8))
    const res = await axiosWithRetry({
      method: 'POST',
      url: CONTAINER_BASE + '/parse',
      timeout: 50000,
      data: {
        image: imageBase64,
        fileName: (payload && payload.fileName) || 'timetable.png',
        userId: userId,
        source_sha256: imageSha256,
        // 后端图像管线约定：先灰度化，再把相邻黑色单元格视为一个整体。
        preprocess: { grayscale: true, black_cell_merge: true, split_cell_tolerance: 0.18 }
      },
      headers: { 'content-type': 'application/json' }
    }, 0)
    const data = (typeof res.data === 'object') ? res.data : {}
    if (!data.success || !data.job_id) return fail('OCR_SUBMIT_FAILED', data.error || '提交失败')
    // The Flask job id is not itself an authorization credential. Persist its
    // owner before returning it so every later poll/annotation request can be
    // checked against the current cloud-function identity.
    const jobRecord = {
      userId,
      jobId: String(data.job_id),
      sourceFileId: fileID,
      sourceSha256: imageSha256,
      status: data.status || 'queued',
      createdAt: db.serverDate(),
      expiresAt: new Date(Date.now() + OCR_JOB_TTL_MS),
      updatedAt: db.serverDate()
    }
    const existing = await ocrImportBatches.where({ userId, jobId: String(data.job_id) }).limit(1).get()
    if (existing.data && existing.data[0]) {
      await ocrImportBatches.doc(existing.data[0]._id).update({ data: jobRecord })
    } else {
      await ocrImportBatches.add({ data: jobRecord })
    }
    console.log('[schedule:ocr] submit_success', { requestId, jobId: redactId(data.job_id), elapsedMs: Date.now() - startedAt })
    return ok({ job_id: data.job_id, status: data.status, image_sha256: imageSha256 })
  } catch (err) {
    const message = httpErrorMessage(err)
    const timeout = err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')
    const status = err && err.response && err.response.status
    if (status === 429) {
      console.warn('[schedule:ocr] submit_busy', { status, userId: redactId(userId) })
      return fail('OCR_BUSY', message || '当前识别人较多，请稍后再试')
    }
    console.error('[schedule:ocr] submit_' + (timeout ? 'timeout' : 'error'), err.code || message)
    return fail(timeout ? 'OCR_SUBMIT_TIMEOUT' : 'OCR_CALL_FAILED', timeout ? 'OCR 提交请求超时，任务状态可能仍在创建，请稍后查询' : message)
  }
}

async function ocrPoll(userId, payload) {
  const jobId = (payload && payload.jobId) || ''
  if (!jobId) return fail('INVALID_PARAM', '缺少 jobId')
  try {
    const owned = await ocrImportBatches.where({ userId, jobId: String(jobId) }).limit(1).get()
    const record = owned.data && owned.data[0]
    if (!record) return fail('OCR_JOB_NOT_FOUND', '识别任务不存在或无权访问')
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      return fail('OCR_JOB_EXPIRED', '识别任务已过期')
    }
    const res = await axiosWithRetry({ method: 'GET', url: CONTAINER_BASE + `/jobs/${jobId}`, timeout: 8000 }, 0)
    const data = (typeof res.data === 'object') ? res.data : {}
    // 兼容旧 OCR 服务：它只返回 expanded/courses 时，也在这里修复拆框。
    const candidates = ['courses', 'raw_courses', 'original_courses', 'course_boxes', 'courseBoxes', 'expanded']
    candidates.forEach((key) => {
      if (Array.isArray(data[key])) data[key] = normalizeOcrCourses(data[key])
    })
    await ocrImportBatches.doc(record._id).update({ data: { status: data.status || 'unknown', updatedAt: db.serverDate() } })
    console.log('[schedule:ocr] poll ok status:', data.status, 'jobId:', redactId(jobId))
    return ok(data)
  } catch (err) {
    const message = httpErrorMessage(err)
    console.error('[schedule:ocr] poll_transient_error:', err.code || message)
    return fail('OCR_POLL_TRANSIENT', 'OCR 状态查询暂时失败，请稍后继续查询')
  }
}

// 获取 OCR 服务生成的标注核验图。图片二进制不经 callFunction 返回：
// 云函数收到后直接写入云存储，仅把很短的 fileID 交给小程序，避免大课表图
// 转 base64 后超过云函数调用响应大小上限而被客户端误判为“图片不可用”。
// 返回值特意不包裹 ok(data)，让小程序能按 success / statusCode 直接处理降级状态。
async function ocrAnnotated(userId, payload) {
  const jobId = (payload && payload.jobId) || ''
  if (!jobId) return { success: false, statusCode: 400, error: 'Missing jobId' }
  try {
    const owned = await ocrImportBatches.where({ userId, jobId: String(jobId) }).limit(1).get()
    const record = owned.data && owned.data[0]
    if (!record) return { success: false, statusCode: 404, error: 'Annotated image not available' }
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      return { success: false, statusCode: 404, error: 'Annotated image expired' }
    }
    const res = await axiosWithRetry({
      method: 'GET',
      url: CONTAINER_BASE + `/jobs/${encodeURIComponent(jobId)}/annotated`,
      timeout: 10000,
      responseType: 'arraybuffer'
    }, 0)
    const buffer = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || [])
    if (res.status !== 200 || !buffer.length) {
      return {
        success: false,
        statusCode: res.status || 0,
        error: 'Annotated image not available'
      }
    }
    const rawMime = String((res.headers && res.headers['content-type']) || 'image/png').split(';')[0].trim().toLowerCase()
    const mime = rawMime === 'image/jpeg' || rawMime === 'image/jpg' ? 'image/jpeg' : 'image/png'
    const extension = mime === 'image/jpeg' ? 'jpg' : 'png'
    const safeJobId = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'ocr'
    const upload = await cloud.uploadFile({
      cloudPath: `ocr-verification/${userId}/${safeJobId}-${Date.now()}.${extension}`,
      fileContent: buffer
    })
    if (!upload || !upload.fileID) throw new Error('Unable to save annotated image')
    console.log('[schedule:ocr] annotated saved bytes:', buffer.length, 'jobId:', redactId(jobId))
    return { success: true, mime, fileID: upload.fileID }
  } catch (err) {
    const statusCode = (err && err.response && err.response.status) || 0
    console.warn('[schedule:ocr] annotated unavailable:', redactId(jobId), statusCode || err.code || 'network')
    const timedOut = err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')
    return {
      success: false,
      statusCode,
      error: timedOut ? 'Annotated image request timed out' : 'Annotated image not available'
    }
  }
}

// ========== 语音录入日程：口语 → 结构化课程（混元大模型，CloudBase AI） ==========
// 与 activityAdmin 一致：本环境混元仅允许云开发 SDK 调用（HTTP 网关会报 AI_CHANNEL_NOT_ALLOWED），
// 因此用 @cloudbase/node-sdk 的 app.ai()，无需 API Key（云函数运行时自带凭证）。
// 可用环境变量覆盖：HUNYUAN_GROUP（默认 cloudbase）、HUNYUAN_MODEL（默认 hy3-preview）。
const tcb = require('@cloudbase/node-sdk')
let _aiApp = null
function getAiApp() {
  if (!_aiApp) _aiApp = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV })
  return _aiApp
}

const AI_SCHEDULE_PARSE_PROMPT = `你是大学课表整理助手。用户用口语（中文或英文）描述自己的课程安排，请整理成一个 JSON 数组（不要使用 markdown 代码块），每门课一个对象，字段如下：
course_code（课程代码，如 DTS101；未提及留空）、course_name（课程名称；未提及留空）、
group（教学班或分组，如 T01；未提及留空）、activity_type（课型，如 Lecture / Tutorial / Seminar / Lab；不确定留空）、
weekday（每周重复上课时填星期几，1-7，周一=1；说了具体日期则留空）、
date（具体日期 YYYY-MM-DD；"明天/后天/下周三/this Friday"等相对日期按今天 {TODAY} 换算；每周重复的课程用 weekday，不要填 date）、
start_time（开始时间 HH:mm，24 小时制，注意把"上午/下午/晚上"换算成 24 小时制）、end_time（结束时间 HH:mm）、
room（教室或地点）、teacher（教师姓名，未提及留空）、
weeks_text（教学周原文，如 "第1到16周" / "weeks 1-16"；未提及留空）。
确实无法确定的字段输出空字符串，不要编造课程代码、教室或人名。只输出 JSON 数组。`

function todayCn() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // 东八区
}

async function callHunyuanText(systemPrompt, userText) {
  const group = process.env.HUNYUAN_GROUP || 'cloudbase'
  const modelName = process.env.HUNYUAN_MODEL || 'hy3-preview'
  const aiModel = getAiApp().ai().createModel(group)
  const res = await aiModel.generateText({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.1
  })
  return res && res.text
}

// 与 activityAdmin 的 extractDraftJson 同款容错：剥离 ```json 代码块后截取首个 JSON 数组。
function extractCourseJsonArray(content) {
  const jsonText = String(content || '').replace(/```json|```/g, '').trim()
  const jsonStart = jsonText.indexOf('[')
  const jsonEnd = jsonText.lastIndexOf(']')
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null
  try {
    const parsed = JSON.parse(jsonText.slice(jsonStart, jsonEnd + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch (e) { return null }
}

async function parseScheduleText(userId, payload = {}) {
  const text = String((payload && payload.text) || '').trim()
  if (!text) return fail('INVALID_PARAM', '缺少语音转写文本')
  const input = text.slice(0, 2000)

  try {
    const content = await callHunyuanText(AI_SCHEDULE_PARSE_PROMPT.replace('{TODAY}', todayCn()), input)
    const courses = extractCourseJsonArray(content)
    if (!courses) {
      console.error('[schedule] 混元返回格式异常:', String(content || '').slice(0, 300))
      return fail('AI_PARSE_FAILED', 'AI 返回格式异常，请重试')
    }
    const cleaned = courses.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 50)
    return ok({ courses: cleaned })
  } catch (e) {
    console.error('[schedule] 混元调用失败:', e.message)
    return fail('AI_PARSE_FAILED', `AI 整理失败：${e.message}`)
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const startTime = Date.now()

  try {
    const { action, payload = {} } = event || {}

    if (!openid && action !== 'ping') return fail('NOT_LOGIN', '无法获取用户身份')
    if (action === 'ping') return ok({ time: Date.now() })

    const userId = await currentUserId(openid)
    if (!userId) return fail('USER_NOT_FOUND', '用户不存在')

    // 内容安全：课程标题/地点/教师检测（scene=4 社交日志）
    if (action === 'upsertSchedule' || action === 'upsertSchedulesBatch') {
      const courses = action === 'upsertSchedulesBatch'
        ? (Array.isArray(payload.courses) ? payload.courses : [])
        : [payload]
      const parts = []
      courses.forEach((course) => {
        if (!course) return
        parts.push(course.title, course.place, course.teacher)
      })
      if (await secCheck.isTextRisky(openid, parts, 4)) {
        return secCheck.contentRisky()
      }
    }

    if (action === 'ocrSubmit') return await ocrSubmit(userId, payload)
    if (action === 'ocrUploadPath') return await ocrUploadPath(userId)
    if (action === 'ocrPoll') return await ocrPoll(userId, payload)
    if (action === 'ocrAnnotated') {
      // 同时兼容 { jobId }（前端交接契约）和既有 { payload: { jobId } } 调用。
      return await ocrAnnotated(userId, Object.assign({}, payload, { jobId: event.jobId || payload.jobId }))
    }

    let result
    switch (action) {
      case 'listSchedules': result = await listSchedules(userId); break
      case 'upsertSchedule': result = await upsertSchedule(userId, payload); break
      case 'upsertSchedulesBatch': result = await upsertSchedulesBatch(userId, payload); break
      case 'deleteSchedule': result = await deleteSchedule(userId, payload); break
      case 'listOcrImportBatches': result = await listOcrImportBatches(userId); break
      case 'saveOcrImportBatchArtifact': result = await saveOcrImportBatchArtifact(userId, payload); break
      case 'deleteOcrImportBatch': result = await deleteOcrImportBatch(userId, payload); break
      case 'clearSchedules': result = await clearSchedules(userId); break
      case 'getActivitySchedule': result = await getActivitySchedule(userId); break
      case 'parseScheduleText': result = await parseScheduleText(userId, payload); break
      default: return fail('UNKNOWN_ACTION', `Unknown action: ${action}`)
    }
    console.log(`[schedule] action=${action} elapsed=${Date.now() - startTime}ms`)
    return result
  } catch (err) {
    console.error('[schedule] internal error', err)
    return fail('INTERNAL_ERROR', err.message || '服务器错误')
  }
}
