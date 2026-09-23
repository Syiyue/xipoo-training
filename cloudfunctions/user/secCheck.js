// 内容安全检测（微信公众平台内容安全 API）
// 文本：security.msgSecCheck (version: 2)；图片：security.imgSecCheck
// 仅 errCode 87014（内容违规）拦截；其余错误（超时/系统忙等）放行并记录日志，
// 避免微信侧故障导致小程序全部写入不可用。
//
// scene 取值：1=资料 2=评论/留言 3=论坛/帖子 4=社交日志

const cloud = require('wx-server-sdk')

const RISKY_ERR_CODE = 87014
const TEXT_LIMIT = 2500

// 统一拦截响应：仅提示含违规信息，不暴露检测细节
const CONTENT_RISKY_RESPONSE = {
  ok: false,
  errorCode: 'CONTENT_RISKY',
  message: '发布的内容包含违规信息，请修改后重新发布'
}

function contentRisky() {
  return Object.assign({}, CONTENT_RISKY_RESPONSE)
}

// 把若干字段拼成一段待检测文本（忽略空值），超长截断
function joinParts(parts) {
  const text = (parts || [])
    .flat()
    .map((item) => String(item === undefined || item === null ? '' : item).trim())
    .filter(Boolean)
    .join('\n')
  return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) : text
}

// 文本检测；返回 true 表示违规
async function isTextRisky(openid, parts, scene) {
  const content = Array.isArray(parts) ? joinParts(parts) : String(parts || '').trim()
  if (!content) return false
  try {
    await cloud.openapi.security.msgSecCheck({
      openid,
      scene: scene || 2,
      version: 2,
      content
    })
    return false
  } catch (err) {
    if (err && err.errCode === RISKY_ERR_CODE) return true
    console.error('[secCheck] msgSecCheck 调用失败，放行:', err && err.errCode, err && err.errMsg)
    return false
  }
}

// 图片检测（云存储 fileID）；返回 true 表示违规
async function isImageRisky(fileID) {
  if (!fileID || typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) return false
  try {
    const downloaded = await cloud.downloadFile({ fileID })
    const ext = fileID.split('?')[0].split('.').pop().toLowerCase()
    const contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    await cloud.openapi.security.imgSecCheck({
      media: { contentType, value: downloaded.fileContent }
    })
    return false
  } catch (err) {
    if (err && err.errCode === RISKY_ERR_CODE) return true
    console.error('[secCheck] imgSecCheck 调用失败，放行:', err && err.errCode, err && err.errMsg)
    return false
  }
}

module.exports = { contentRisky, joinParts, isTextRisky, isImageRisky, CONTENT_RISKY_RESPONSE }
