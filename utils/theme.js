/**
 * Xipoo 主题引擎
 * 从单一主题色派生整套调色板，注入页面根节点 style（CSS 变量）实现全局换肤。
 * 持久化：wx storage key = xipoo_theme  =>  { type: 'preset'|'custom', color: '#rrggbb' }
 */

const STORAGE_KEY = 'xipoo_theme'
const DEFAULT_COLOR = '#7c83c7' // 莫奈·睡莲（印象派柔紫蓝，全局默认主题）

const PRESETS = [
  /* 莫奈（印象派）系列：低饱和柔和色调，取自画作主色 */
  { key: 'monet-lily',    name: '莫奈·睡莲', color: '#7c83c7' }, // 《睡莲》系列（Water Lilies, c.1897–1926）的柔紫蓝
  { key: 'monet-sunrise', name: '莫奈·日出', color: '#e8935a' }, // 《日出·印象》（Impression, soleil levant, 1872）的暖橙
  { key: 'monet-iris',    name: '莫奈·鸢尾', color: '#8a72c2' }, // 《鸢尾花》系列（Irises, c.1914–1917）的蓝紫
  { key: 'xipoo',  name: '吸噗绿', color: '#61b673' },
  { key: 'sky',    name: '天空蓝', color: '#4a9bf5' },
  { key: 'violet', name: '葡萄紫', color: '#8b5cf6' },
  { key: 'sakura', name: '樱花粉', color: '#f06f9c' },
  { key: 'orange', name: '活力橙', color: '#f2924a' },
  { key: 'teal',   name: '青翠绿', color: '#14b8a6' },
  { key: 'graphite', name: '曜石黑', color: '#3a3a3e' }
]

/* ---------- 颜色工具 ---------- */

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s * 100, l * 100]
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r, g, b
  if (h < 60) { r = c; g = x; b = 0 } else if (h < 120) { r = x; g = c; b = 0 } else if (h < 180) { r = 0; g = c; b = x } else if (h < 240) { r = 0; g = x; b = c } else if (h < 300) { r = x; g = 0; b = c } else { r = c; g = 0; b = x }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

function hsla(h, s, l, a) {
  return 'hsla(' + Math.round(h) + ', ' + Math.round(s) + '%, ' + Math.round(l) + '%, ' + a + ')'
}

function normalizeHex(hex) {
  if (typeof hex !== 'string') return null
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/)
  return m ? '#' + m[1].toLowerCase() : null
}

/**
 * 由主题色派生调色板。
 * 偏移量按默认绿 #61b673 对齐全局历史配色（#cce8c9 / #edf7f0 / #dce9df / #247249 / #173c27）。
 */
function buildPalette(baseColor) {
  const hex = normalizeHex(baseColor) || DEFAULT_COLOR
  const [h, s, l] = hexToHsl(hex)
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
  return {
    hue: h,
    primary: hex,
    bright: hslToHex(h + 12, s + 16, l - 5),   // 高亮绿（switch、强调）
    deep: hslToHex(h, s + 10, l - 19),          // 深主色（渐变、按压态）
    ink: hslToHex(h, s + 6, l - 37),            // 深绿文字（浅底上的标题）
    // 浅色系亮度限制在浅色区间：深色主题色（如曜石黑）也不会得到中灰底
    soft: hslToHex(h, s + 6, clamp(l + 27, 78, 86)),   // 浅主色块
    tint: hslToHex(h, s + 10, clamp(l + 39, 88, 94)),  // 极浅底（卡片/标签底）
    tint2: hslToHex(h, s + 6, clamp(l + 42, 90, 96)),  // 更浅底
    border: hslToHex(h, s - 4, clamp(l + 31, 76, 88)), // 浅描边
    onPrimary: '#ffffff'
  }
}

/* 深色模式下的派生：浅色系变量换成半透明暗色，主色略微提亮保证对比度 */
function buildDarkPalette(baseColor) {
  const hex = normalizeHex(baseColor) || DEFAULT_COLOR
  const [h, s, l] = hexToHsl(hex)
  return {
    hue: h,
    primary: hslToHex(h, s, Math.min(l + 4, 62)),
    bright: hslToHex(h + 12, s + 14, l + 2),
    deep: hslToHex(h, s + 8, l + 8),
    ink: hslToHex(h, s + 10, 88),
    soft: hsla(h, 45, 55, 0.28),
    tint: hsla(h, 40, 55, 0.14),
    tint2: hsla(h, 35, 55, 0.09),
    border: hsla(h, 35, 60, 0.35),
    onPrimary: '#ffffff'
  }
}

/**
 * tabbar PNG 图标着色滤镜。
 * 基准滤镜把图标染成默认绿（色相约 133°）；换主题时按色相差旋转。
 */
function buildIconFilter(palette) {
  const delta = Math.round((palette.hue - 133 + 540) % 360 - 180)
  return 'invert(65%) sepia(18%) saturate(1110%) hue-rotate(' + (80 + delta) + 'deg) brightness(93%) contrast(86%)'
}

/** 生成注入页面根节点 style 的 CSS 变量串 */
function buildThemeVars(baseColor, darkMode) {
  const p = darkMode ? buildDarkPalette(baseColor) : buildPalette(baseColor)
  const filter = buildIconFilter(p)
  // 参考插画原稿以默认莫奈蓝紫（约 235°）绘制；通过色相偏移使其与主题同步。
  const illustrationHueShift = Math.round(p.hue - 235)
  return [
    '--brand-primary: ' + p.primary,
    '--brand-bright: ' + p.bright,
    '--brand-deep: ' + p.deep,
    '--brand-ink: ' + p.ink,
    '--brand-soft: ' + p.soft,
    '--brand-tint: ' + p.tint,
    '--brand-tint-2: ' + p.tint2,
    '--brand-border: ' + p.border,
    '--on-brand: ' + p.onPrimary,
    /* 日程页 Figma 还原块使用的静态色板同步跟随主题（中性色不覆盖） */
    '--color-primary: ' + p.primary,
    '--color-primary-soft: ' + p.soft,
    '--tab-icon-filter: ' + filter,
    '--illustration-hue-shift: ' + illustrationHueShift + 'deg'
  ].join('; ')
}

/* ---------- 主题状态 ---------- */

function getTheme() {
  const saved = wx.getStorageSync(STORAGE_KEY)
  if (saved && normalizeHex(saved.color)) {
    return { type: saved.type === 'custom' ? 'custom' : 'preset', color: normalizeHex(saved.color) }
  }
  return { type: 'preset', color: DEFAULT_COLOR }
}

function setTheme(color, type) {
  const hex = normalizeHex(color) || DEFAULT_COLOR
  const theme = { type: type === 'custom' ? 'custom' : 'preset', color: hex }
  wx.setStorageSync(STORAGE_KEY, theme)
  return theme
}

function isDefaultTheme(theme) {
  return !theme || (theme.type === 'preset' && theme.color === DEFAULT_COLOR)
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_COLOR,
  PRESETS,
  hexToHsl,
  hslToHex,
  buildPalette,
  buildDarkPalette,
  buildThemeVars,
  getTheme,
  setTheme,
  isDefaultTheme
}
