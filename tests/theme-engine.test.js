// 主题引擎单元测试：调色板派生、变量串生成、读写持久化
// 运行：node tests/theme-engine.test.js

const assert = require('assert')

// mock wx storage
const storage = {}
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v }
}

const theme = require('../utils/theme')

let passed = 0
function ok(name, cond) {
  assert(cond, name)
  passed++
  console.log('  ok -', name)
}

/* ---------- 颜色工具 ---------- */
{
  const [h, s, l] = theme.hexToHsl('#61b673')
  ok('默认绿色相约 133', Math.abs(h - 133) < 2)
  ok('默认绿亮度约 55', Math.abs(l - 55) < 2)
  ok('hex 往返一致', theme.hslToHex(h, s, l) === '#61b673')
}

/* ---------- 调色板 ---------- */
{
  const p = theme.buildPalette('#61b673')
  const keys = ['primary', 'bright', 'deep', 'ink', 'soft', 'tint', 'tint2', 'border', 'onPrimary']
  keys.forEach((k) => ok('浅色板含 ' + k, Boolean(p[k])))
  ok('primary 原样返回', p.primary === '#61b673')
  // 明度关系：tint2 > tint > soft > primary > deep > ink
  const lum = (hex) => theme.hexToHsl(hex)[2]
  ok('明度梯度正确',
    lum(p.tint2) > lum(p.tint) && lum(p.tint) > lum(p.soft) &&
    lum(p.soft) > lum(p.primary) && lum(p.primary) > lum(p.deep) &&
    lum(p.deep) > lum(p.ink))
}

{
  const d = theme.buildDarkPalette('#61b673')
  ok('暗色板 soft 为半透明', String(d.soft).startsWith('hsla'))
  ok('暗色板 tint 为半透明', String(d.tint).startsWith('hsla'))
  ok('暗色板主色提亮', theme.hexToHsl(d.primary)[2] >= theme.hexToHsl('#61b673')[2])
}

/* ---------- 变量串 ---------- */
{
  const vars = theme.buildThemeVars('#4a9bf5', false)
  ;['--brand-primary', '--brand-bright', '--brand-deep', '--brand-ink', '--brand-soft',
    '--brand-tint', '--brand-tint-2', '--brand-border', '--on-brand', '--tab-icon-filter']
    .forEach((v) => ok('变量串含 ' + v, vars.includes(v)))
  ok('蓝色主题主色生效', vars.includes('--brand-primary: #4a9bf5'))
  ok('色相滤镜随主题变化', !vars.includes('hue-rotate(80deg)'))
  const def = theme.buildThemeVars('#61b673', false)
  ok('默认主题滤镜不变', def.includes('hue-rotate(80deg)'))
}

/* ---------- 预设与默认主题 ---------- */
{
  ok('默认主题为莫奈·睡莲', theme.DEFAULT_COLOR === '#7c83c7')
  ok('预设共 10 个', theme.PRESETS.length === 10)
  const keys = theme.PRESETS.map((p) => p.key)
  ok('莫奈三预设在前', keys.slice(0, 3).join(',') === 'monet-lily,monet-sunrise,monet-iris')
  ok('睡莲为柔紫蓝', theme.PRESETS[0].color === '#7c83c7')
  ok('日出为暖橙', theme.PRESETS[1].color === '#e8935a')
  ok('鸢尾为蓝紫', theme.PRESETS[2].color === '#8a72c2')
  // 莫奈系主色低饱和（< 80），派生浅色系在 pastel 亮度区间
  theme.PRESETS.slice(0, 3).forEach((p) => {
    const [, s] = theme.hexToHsl(p.color)
    ok(p.key + ' 饱和度柔和', s < 80)
    const pal = theme.buildPalette(p.color)
    const lum = (hex) => theme.hexToHsl(hex)[2]
    ok(p.key + ' 派生 tint 为极浅底', lum(pal.tint) >= 88 && lum(pal.tint2) >= 90)
    ok(p.key + ' 派生 border 与 soft 协调', lum(pal.border) >= 76 && lum(pal.soft) >= 78)
  })
}

/* ---------- 持久化 ---------- */
{
  theme.setTheme('#f2924a', 'custom')
  const t = theme.getTheme()
  ok('写入后可读回', t.color === '#f2924a' && t.type === 'custom')
  theme.setTheme(theme.DEFAULT_COLOR, 'preset')
  ok('恢复默认', theme.isDefaultTheme(theme.getTheme()))
  // 非法输入回退默认
  theme.setTheme('not-a-color', 'custom')
  ok('非法颜色回退默认', theme.getTheme().color === theme.DEFAULT_COLOR)
}

console.log('theme-engine.test.js: all assertions passed (' + passed + ')')
