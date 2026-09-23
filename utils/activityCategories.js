/**
 * π空间 / 活动分类（模块 4）：小程序端共享常量与纯函数，方便单测。
 */

// π空间对应的发布方 key
const PAI_SPACE_KEY = 'pai_space'

/** 按二级分类过滤活动；categoryKey 为空表示「全部」 */
function filterByCategoryKey(activities, categoryKey) {
  const list = Array.isArray(activities) ? activities : []
  if (!categoryKey) return list
  return list.filter((item) => item && item.categoryKey === categoryKey)
}

/** 分类的展示名（按语言取 nameZh/nameEn，缺则回退 key） */
function categoryDisplayName(category, lang) {
  if (!category) return ''
  const isEn = lang === 'en'
  return (isEn ? (category.nameEn || category.nameZh) : (category.nameZh || category.nameEn)) || category.key || ''
}

module.exports = {
  PAI_SPACE_KEY,
  filterByCategoryKey,
  categoryDisplayName
}
