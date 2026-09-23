const { dictionaries } = require('../../../../utils/i18n')

const agreementZH = `Xipoo 用户协议

最后更新日期：2026年

欢迎使用 Xipoo（以下简称"本平台"或"我们"）。本协议是您（以下简称"用户"）与 Xipoo 之间关于使用本小程序服务所订立的协议。请在注册和使用前仔细阅读本协议。

一、服务说明
Xipoo 是一个面向校园用户的日程管理与活动小程序，主要功能包括：
1. 课程表管理与展示（日/周/月视图）
2. AI 课表录入：拍照识别或语音录入，自动生成课程；
3. 好友添加与搜索，通过 Xipoo ID 或微信邀请建立日程共享；
4. 日程查看权限管理与多人共同空闲时间计算；
5. 活动浏览、报名与预约，以及个人活动视图；
6. 个人资料管理（头像、昵称、年级、性别、专业等）；
7. 主题外观与黑夜模式切换、多语言（中文/English）等个性化设置。

二、用户注册与账号管理
1. 用户通过微信授权登录本平台，首次登录将自动生成唯一的 Xipoo ID。
2. 用户应妥善保管自己的微信账号及 Xipoo 账号，因账号信息泄露导致的损失由用户自行承担。
3. 用户注册时需提供真实、准确的个人信息。如信息发生变更，应及时在"编辑个人信息"页面更新。
4. 每个微信号仅可注册一个 Xipoo 账号。

三、用户行为规范
1. 用户不得利用本平台从事违法违规活动，包括但不限于：
   (a) 发布违法信息、色情内容、暴力内容或侵犯他人合法权益的内容；
   (b) 骚扰、威胁、侮辱其他用户；
   (c) 利用平台从事商业广告、营销推广等未经授权的行为；
   (d) 恶意注册多个账号、刷屏、发送垃圾信息。
2. 用户应尊重他人的隐私权和知识产权，未经对方同意不得公开其个人信息。
3. 用户在使用日程共享等功能时，应遵守诚实信用原则，如实填写个人信息。

四、日程共享与隐私设置
1. 用户可自行设置日程的查看权限（不共享/仅忙闲/完整信息）以及共享有效期。
2. 用户可设置"允许参与共同空闲计算"开关，以决定是否参与好友间的空闲时间计算。
3. 用户应谨慎授权日程可见范围，因主动授权的信息被对方查看而产生的后果由用户自行承担。

五、知识产权
1. 本平台所包含的所有内容，包括但不限于文字、图形、界面设计、程序代码等，其知识产权归 Xipoo 所有。
2. 用户在本平台发布的内容，用户保留其知识产权，但授予 Xipoo 在平台范围内使用的许可。

六、免责声明
1. 本平台仅为用户提供日程管理与信息发布的技术服务，不对用户之间的实际交往质量、安全性作出任何明示或暗示的保证。
2. 因不可抗力、系统维护、网络故障等原因导致服务中断或数据丢失，本平台不承担责任。
3. 用户在校园内外因使用本平台而产生的线下交往风险由用户自行承担。

七、协议变更与终止
1. 我们有权根据需要修改本协议，修改后的协议将在页面公布后生效。如用户继续使用服务，视为接受修改。
2. 用户有权随时停止使用本平台服务。
3. 如用户违反本协议，我们有权暂停或终止向您提供服务。

八、联系我们
如对本协议有任何疑问，请通过以下方式联系我们：
邮箱：268182534@139.com`

const agreementEN = `Xipoo User Agreement

Last Updated: 2026

Welcome to Xipoo. This agreement governs your use of our mini-program. Please read carefully before registering.

I. Service Description
Xipoo is a campus-focused schedule and activity mini-program featuring:
1. Timetable management and display (day / week / month views);
2. AI timetable import: photo recognition or voice input to automatically create courses;
3. Friend adding and search, schedule sharing via Xipoo ID or WeChat invitation;
4. Schedule visibility permission management and shared free time calculation;
5. Activity browsing, registration, reservation, and a personal activity view;
6. Profile management (avatar, name, grade, gender, major, etc.);
7. Personalized settings such as themes, dark mode, and multilingual support (Chinese / English).

II. Account Registration & Management
1. Users log in via WeChat authorization. First login generates a unique Xipoo ID.
2. Users are responsible for keeping their WeChat and Xipoo accounts secure.
3. Users must provide accurate personal information and update it when changes occur.
4. Each WeChat account can register only one Xipoo account.

III. User Conduct
1. Users shall not engage in illegal activities, including but not limited to:
   (a) Posting illegal content, obscene content, violent content, or content infringing others' rights;
   (b) Harassing, threatening, or insulting other users;
   (c) Unauthorized commercial advertising or marketing;
   (d) Registering multiple accounts maliciously, spamming, or sending junk messages.
2. Users shall respect others' privacy and intellectual property rights.
3. Users shall provide truthful information when using schedule sharing and related features.

IV. Schedule Sharing & Privacy
1. Users may set their schedule visibility (not shared / busy-free only / full details) and its valid period.
2. Users may toggle "allow shared free time calculation" to decide whether to join free time calculation among friends.
3. Users shall carefully authorize schedule visibility. The platform is not liable for consequences arising from information disclosed through explicit authorization.

V. Intellectual Property
1. All content on this platform, including text, graphics, UI design, and code, belongs to Xipoo.
2. Users retain intellectual property rights to content they post, granting Xipoo a license to use it within the platform.

VI. Disclaimer
1. The platform provides technical services for schedule management and information publishing only, and makes no guarantees about user interactions.
2. The platform is not liable for service interruptions due to force majeure, maintenance, or network failures.
3. Users bear all risks from offline interactions arising from platform use.

VII. Agreement Changes & Termination
1. We may modify this agreement. Continued use after changes constitutes acceptance.
2. Users may stop using the service at any time.
3. We may suspend or terminate service if users violate this agreement.

VIII. Contact Us
Email: 268182534@139.com`

Page({
  data: { lang: 'zh', t: {}, content: agreementZH },
  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]), content: lang === 'zh' ? agreementZH : agreementEN })
    wx.setNavigationBarTitle({ title: dictionaries[lang].userAgreement || '用户协议' })
  },
  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
