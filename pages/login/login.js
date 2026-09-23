/**
 * Xipoo 吸噗 - 登录页面
 * 仅微信一键登录 | 中英文切换 | 协议勾选校验
 * 按钮文案通过语种映射：中文"微信一键登录" / 英文"WeChat One-Click Login"
 */
const { dictionaries } = require('../../utils/i18n')
const api = require('../../utils/api')

const AGREEMENT_URL = {
  userAgreement: '/packages/account/pages/userAgreement/userAgreement',
  privacyPolicy: '/packages/account/pages/privacyPolicy/privacyPolicy'
}

Page({
  data: {
    lang: 'zh',
    t: {},
    agreed: false,
    loading: false
  },

  onLoad() {
    const session = wx.getStorageSync('xipoo_session')
    if (session && session.userId) {
      this.goHome()
      return
    }
    this.initLang()
  },

  onShow() { this.initLang() },

  /* ===== 语言切换 ===== */
  initLang() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: this.getI18n(lang) })
  },

  getI18n(lang) {
    const base = Object.assign({}, dictionaries[lang] || dictionaries.zh)
    const loginDict = {
      zh: {
        brandSlogan: '信息触手 · 安排高手',
        heroTitle: '来自深海的时间管理大师',
        heroSub: '用八条触手吸收各种碎片信息，\n帮你把每一天都安排得明明白白。',
        heroTags: ['AI一键录入西浦课程', '西浦活动整理', '好友共同空闲时间计算'],
        loginBtnText: '开始使用',
        agreePrefix: '我已阅读并同意',
        userAgreement: '《用户协议》',
        agreeAnd: '与',
        privacyPolicy: '《隐私政策》',
        copyright: '© 2026 Xipoo'
      },
      en: {
        brandSlogan: 'Info Tentacles · Planning Master',
        heroTitle: 'Time Management Master from the Deep',
        heroSub: 'Soaks up scattered bits of information with eight tentacles,\nkeeping every day of yours perfectly organized.',
        heroTags: ['AI One-tap XJTLU Course Import', 'XJTLU Activity Digest', 'Mutual Free-time Finder'],
        loginBtnText: 'Get Started',
        agreePrefix: 'I have read and agree to the',
        userAgreement: 'User Agreement',
        agreeAnd: 'and',
        privacyPolicy: 'Privacy Policy',
        copyright: '© 2026 Xipoo'
      }
    }
    return Object.assign({}, base, loginDict[lang] || loginDict.zh)
  },

  switchLang(e) {
    const newLang = e.currentTarget.dataset.lang
    if (newLang === this.data.lang) return
    const app = getApp()
    app.setLanguage(newLang)
    this.setData({ lang: newLang, t: this.getI18n(newLang) })
  },

  /* ===== 协议交互 ===== */
  toggleAgree() { this.setData({ agreed: !this.data.agreed }) },

  goLink(e) {
    const type = e.currentTarget.dataset.type
    const url = AGREEMENT_URL[type]
    if (url) {
      wx.navigateTo({ url })
    }
  },

  /* ===== 微信登录 ===== */
  async wechatLogin() {
    if (!this.data.agreed || this.data.loading || this._loggingIn) return
    this._loggingIn = true
    this.setData({ loading: true })

    try {
      // 1. 检查网络
      const networkResult = await new Promise((resolve) => {
        wx.getNetworkType({ success: resolve, fail: () => resolve({ networkType: 'unknown' }) })
      })
      if (networkResult.networkType === 'none') {
        throw new Error('NETWORK_OFFLINE')
      }

      // 2. 云函数可直接通过 cloud.getWXContext() 获取 OPENID，不再额外调用
      // wx.login，避免首次登录时出现重复的授权服务请求。
      let result
      try {
        // 传 null profile，让云函数使用默认昵称
        result = await api.wechatLogin(null)
      } catch (loginErr) {
        const errMsg = String(loginErr.message || '')
        if (errMsg.includes('-504002') || errMsg.includes('未部署')) {
          wx.showModal({
            title: this.data.lang === 'zh' ? '服务未就绪' : 'Service not ready',
            content: this.data.lang === 'zh'
              ? '登录服务尚未部署，请联系管理员。您仍可在本地模式下继续使用。'
              : 'Login service not deployed. You can still use the app in offline mode.',
            confirmText: this.data.lang === 'zh' ? '进入离线模式' : 'Enter offline mode',
            showCancel: false,
            success: () => this.goHome()
          })
          return
        }
        if (errMsg.includes('timeout') || errMsg.includes('ECONNREFUSED') || errMsg.includes('Connection')) {
          throw new Error('CLOUD_TIMEOUT')
        }
        throw loginErr
      }

      // 不把登录响应（可能包含 session/token、openid、手机号）写入设备日志。
      console.log('[login] 登录成功')

      // 复用登录响应，避免主页在跳转后立即额外请求一次用户资料。
      const app = getApp()
      if (result.user) {
        app.globalData.userInfo = result.user
        if (app.setCached) app.setCached('me', result.user)
      }

      // 3. 跳转
      this._navigatingAway = true
      if (result.isNewUser) {
        wx.redirectTo({ url: '/pages/profile/profile?showAvatarPicker=true' })
      } else {
        this.goHome()
      }

    } catch (err) {
      const errKey = String(err.message || 'UNKNOWN')
      console.error('[login] 登录异常:', errKey)

      const messages = {
        zh: {
          NETWORK_OFFLINE: '网络连接已断开，请检查网络后重试',
          WX_LOGIN_FAILED: '微信登录失败，请检查微信版本后重试',
          WX_LOGIN_NO_CODE: '微信授权未完成，请重试',
          AUTH_FAILED: '微信授权失败，请检查微信版本后重试',
          CLOUD_TIMEOUT: '登录服务暂时不可用，请稍后重试',
          DEFAULT: '登录失败，请重试'
        },
        en: {
          NETWORK_OFFLINE: 'Network offline. Please check your connection.',
          WX_LOGIN_FAILED: 'WeChat login failed. Check your WeChat version.',
          WX_LOGIN_NO_CODE: 'WeChat authorization incomplete. Please try again.',
          AUTH_FAILED: 'WeChat authorization failed. Check your WeChat version.',
          CLOUD_TIMEOUT: 'Login service unavailable. Please try again later.',
          DEFAULT: 'Login failed. Please try again.'
        }
      }
      const langMsgs = messages[this.data.lang] || messages.zh
      const toastMsg = langMsgs[errKey] || langMsgs.DEFAULT

      wx.showToast({ title: toastMsg, icon: 'none', duration: 2500 })
    } finally {
      this._loggingIn = false
      if (!this._navigatingAway) this.setData({ loading: false })
    }
  },

  /* ===== 先逛逛（游客退出登录页） ===== */
  browseFirst() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/schedule/schedule' })
    }
  },

  goHome() {
    // 从其他页面引导进来时返回来源页，否则回首页
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/schedule/schedule' })
    }
  }
})
