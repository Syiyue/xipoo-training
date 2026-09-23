# Xipoo 吸噗微信小程序

这是产品型小程序工程。前台不预置假课程、假好友申请、假活动内容；真实测试时需要通过注册、添加好友、后台发布活动、AI 后端识别课表来产生数据。

## 打开方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择：`D:\HuaweiMoveData\Users\18226\Desktop\Anyway\xipoo-miniprogram`
4. AppID 可使用测试号。

## 短信验证码

前端注册页会调用：

`POST /auth/sms/send`

后端工程已实现短信服务：

`D:\HuaweiMoveData\Users\18226\Desktop\Anyway\xipoo-backend\src\smsService.js`

本地开发默认 `SMS_PROVIDER=console`，验证码会输出到后端控制台；如果小程序没有配置真实后端，本地 mock 会生成随机验证码并显示在 Toast 和控制台中。生产环境可配置 `SMS_PROVIDER=tencent` 并填写腾讯云短信参数。

## 已实现功能

- 未登录页支持语言选择，界面双语切换。
- 自定义底部导航，带图标，中文/英文名称可随语言切换。
- 手机号登录/注册，注册需要短信验证码。
- 已登录时打开小程序直接进入课表日视图。
- 课表日/周/月视图，月视图为完整日历网格。
- AI 课表录入只连接真实后端，不写假数据。
- 好友、好友日程开放、好友日程窗口。
- 日程匹配：选择好友、日期、时间段后确认匹配。
- 活动列表和活动详情。
- 我的页面：账户管理、退出登录、中英文切换。
- 右下角兔子 AI 助手，点击后弹出对话栏。

## 后端

后端工程在：

`D:\HuaweiMoveData\Users\18226\Desktop\Anyway\xipoo-backend`

要测试真实 AI 录入和短信发送，需要启动后端、配置 `.env`，并把 `utils/api.js` 里的 `API_BASE_URL` 改成后端地址。
