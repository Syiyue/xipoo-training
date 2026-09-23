const theme = require('../../../../utils/theme')

const MONET_KEY_PREFIX = 'monet-'
const DEFAULT_PRESET = theme.PRESETS.find((p) => p.color === theme.DEFAULT_COLOR) || theme.PRESETS[0]
const DEFAULT_HUE = Math.round(theme.hexToHsl(theme.DEFAULT_COLOR)[0])

/* 预设列表：莫奈系色块用主色派生的水彩渐变，其余保持纯色 */
function buildPresetList() {
  return theme.PRESETS.map((p) => {
    if (p.key.indexOf(MONET_KEY_PREFIX) === 0) {
      const pal = theme.buildPalette(p.color)
      return Object.assign({}, p, {
        swatch: 'linear-gradient(135deg, ' + pal.bright + ', ' + p.color + ' 55%, ' + pal.deep + ')'
      })
    }
    return Object.assign({}, p, { swatch: p.color })
  })
}

Page({
  data: {
    lang: 'zh',
    presets: buildPresetList(),
    selectedKey: DEFAULT_PRESET.key, // 预设 key 或 'custom'
    customHue: DEFAULT_HUE,
    customColor: theme.DEFAULT_COLOR,
    spectrumLeft: 0,      // 光谱条游标位置（rpx 相对宽度百分比）
    spectrumPct: Math.round((DEFAULT_HUE / 360) * 100),      // 游标位置百分比
    isCustom: false
  },

  onLoad() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Theme' : '主题外观' })
    this._touchTimer = null
  },

  onShow() {
    const app = getApp()
    const current = app.getTheme ? app.getTheme() : theme.getTheme()
    const preset = theme.PRESETS.find((p) => p.color === current.color)
    if (current.type === 'custom' || !preset) {
      const [h] = theme.hexToHsl(current.color)
      this.setData({
        isCustom: true,
        selectedKey: 'custom',
        customHue: Math.round(h),
        customColor: current.color,
        spectrumPct: Math.round((h / 360) * 100)
      })
    } else {
      this.setData({ isCustom: false, selectedKey: preset.key })
    }
  },

  /* ---------- 预设色 ---------- */
  onPresetTap(e) {
    const { key, color } = e.currentTarget.dataset
    this.setData({ selectedKey: key, isCustom: false })
    getApp().setTheme(color, 'preset')
  },

  /* ---------- 自定义色谱 ---------- */
  onSpectrumTouch(e) {
    const query = wx.createSelectorQuery().in(this)
    query.select('.spectrum-bar').boundingClientRect((rect) => {
      if (!rect || !rect.width) return
      const touch = e.touches && e.touches[0]
      if (!touch) return
      let x = touch.clientX - rect.left
      x = Math.max(0, Math.min(rect.width, x))
      const hue = Math.round((x / rect.width) * 360)
      const color = theme.hslToHex(hue, 50, 55)
      this.setData({
        isCustom: true,
        selectedKey: 'custom',
        customHue: hue,
        customColor: color,
        spectrumPct: Math.round((x / rect.width) * 100)
      })
      // 拖动过程中高频调用，节流应用到全局
      if (this._touchTimer) clearTimeout(this._touchTimer)
      this._touchTimer = setTimeout(() => {
        getApp().setTheme(color, 'custom')
      }, 60)
    }).exec()
  },

  /* ---------- 恢复默认 ---------- */
  onReset() {
    getApp().resetTheme()
    this.setData({ isCustom: false, selectedKey: DEFAULT_PRESET.key })
    wx.showToast({ title: this.data.lang === 'en' ? 'Restored' : '已恢复默认', icon: 'success' })
  },

  /* ---------- i18n 文案 ---------- */
  t(zh, en) {
    return this.data.lang === 'en' ? en : zh
  }
})
