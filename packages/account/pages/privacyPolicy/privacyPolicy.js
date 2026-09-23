const { dictionaries } = require('../../../../utils/i18n')

const policyZH = `Xipoo 隐私政策

最后更新日期：2025年

Xipoo（以下简称"我们"或"本平台"）尊重并保护用户（以下简称"您"）的隐私。本隐私政策说明了我们如何收集、使用、存储和保护您的个人信息。

一、信息收集范围
在您使用 Xipoo 小程序的过程中，我们可能会收集以下类型的信息：

1. 必需信息（注册和使用基础功能所需）：
   (a) 微信昵称和微信头像（通过微信授权获取）；
   (b) 微信 OpenID（用于识别唯一用户身份）；
   (c) 您自行填写的昵称、年级、性别、专业、学校。

2. 可选信息（您可选择是否提供）：
   (a) 手机号码（用于账号找回和通知）；
   (b) 微信号（用于搭子功能中的联系方式展示）；
   (c) 个人头像图片（可自行上传更换）。

3. 使用过程中产生的信息：
   (a) 课程表/日程数据；
   (b) 活动报名记录；
   (c) 好友关系数据；
   (d) 搭子匹配记录；
   (e) 黑名单列表。

二、信息使用目的
我们收集的信息将用于以下目的：
1. 提供、维护和改进本平台的核心功能（课表管理、好友系统、搭子匹配、活动报名）；
2. 实现用户身份识别和账号管理；
3. 实现好友搜索功能（通过 Xipoo ID）；
4. 实现搭子匹配功能；
5. 向您展示活动推荐内容；
6. 处理您的活动报名和取消报名请求；
7. 发送账号相关的通知（如适用）；
8. 改善用户体验和优化产品功能。

三、信息的存储与保护
1. 存储位置：您的个人信息存储在中国境内的服务器上。
2. 存储期限：我们仅在实现本政策所述目的所必需的期限内保留您的信息，除非法律法规另有要求。
3. 安全措施：我们采取符合行业标准的安全措施保护您的信息，包括但不限于数据加密、访问控制和防火墙技术。
4. 账号注销：您可通过"联系我们"中的邮箱向我们提出账号注销请求，我们将在合理时间内处理。

四、信息共享与披露
我们承诺不向任何第三方出售您的个人信息。但以下情况除外：
1. 获得您的明确同意；
2. 法律法规要求；
3. 为保护本平台的合法权益（如调查违规行为）；
4. 为保护用户或公众的人身财产安全。

五、您的权利
根据《中华人民共和国个人信息保护法》及相关法律法规，您享有以下权利：
1. 查阅权：您可在"我的"页面查看您的个人资料信息。
2. 更正权：您可通过"编辑个人信息"页面修改您的昵称、年级、性别、专业等信息。
3. 删除权：在特定情况下，您可以要求我们删除您的个人信息。
4. 撤回同意权：您可以通过"联系我们"撤回对个人信息收集和使用的同意。撤回同意可能影响部分功能的使用。
5. 账号注销权：您可以通过"联系我们"中的邮箱申请注销账号，我们将在30个工作日内处理。

六、未成年人保护
如您为未满18周岁的未成年人，应在父母或监护人的指导下使用本平台。我们将按照相关法律法规保护未成年人的个人信息。

七、隐私政策的更新
我们可能会根据法律法规要求或产品功能变化更新本隐私政策。更新后的政策将在页面公布，并标注更新日期。

八、联系我们
如对本隐私政策有任何疑问、意见或投诉，请通过以下方式联系我们：
邮箱：268182534@139.com`

const policyEN = `Xipoo Privacy Policy

Last Updated: 2025

Xipoo respects and protects your privacy. This policy explains how we collect, use, store, and protect your personal information.

I. Information We Collect
While using Xipoo, we may collect:

1. Required Information (for basic functionality):
   (a) WeChat nickname and avatar (via WeChat authorization);
   (b) WeChat OpenID (for user identification);
   (c) Self-provided name, grade, gender, major, school.

2. Optional Information:
   (a) Phone number (for account recovery and notifications);
   (b) WeChat ID (for buddy matching contact);
   (c) Custom avatar image.

3. Usage Data:
   (a) Schedule data;
   (b) Activity registration records;
   (c) Friend relationships;
   (d) Buddy matching records;
   (e) Blacklist.

II. How We Use Information
1. Provide, maintain, and improve core features;
2. User identification and account management;
3. Friend search via Xipoo ID;
4. Buddy matching;
5. Activity recommendations;
6. Activity registration processing;
7. Account notifications;
8. User experience improvement.

III. Storage & Protection
1. Data is stored on servers within China.
2. Data is retained only as long as necessary for stated purposes.
3. We implement industry-standard security measures including encryption, access controls, and firewalls.
4. Account deletion requests can be sent via the contact email.

IV. Information Sharing
We do not sell your personal information to third parties. Exceptions include:
1. Your explicit consent;
2. Legal requirements;
3. Protecting our legitimate rights;
4. Protecting user or public safety.

V. Your Rights
Under China's Personal Information Protection Law, you have the right to:
1. Access: View your profile in the "Me" page.
2. Rectify: Edit your information via the "Edit Profile" page.
3. Delete: Request deletion of your personal information.
4. Withdraw consent: Contact us to withdraw consent for data processing.
5. Delete account: Apply for account deletion via the contact email (processed within 30 working days).

VI. Minor Protection
If you are under 18, please use this platform under parental guidance. We comply with all applicable laws protecting minors' personal information.

VII. Policy Updates
We may update this policy as required by law or product changes. Updates will be posted with a revised date.

VIII. Contact Us
Email: 268182534@139.com`

Page({
  data: { lang: 'zh', t: {}, content: policyZH },
  onShow() {
    const app = getApp()
    const lang = app.getLanguage ? app.getLanguage() : 'zh'
    this.setData({ lang, t: Object.assign({}, dictionaries[lang]), content: lang === 'zh' ? policyZH : policyEN })
    wx.setNavigationBarTitle({ title: dictionaries[lang].privacyPolicy || '隐私政策' })
  },
  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
