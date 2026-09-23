# 项目备注 · v1.1.0（2026-07-30）

本版本三大块改动：内容安全整改、好友模块重构为日程共享中心、功能精简。

## 一、内容安全（微信审核整改）

- 全部 UGC 写入接入微信内容安全 API：文本 `msgSecCheck`（v2，带 openid+scene），图片（头像/反馈配图）`imgSecCheck` 同步拦截
- 覆盖 6 个云函数（user/buddy/match/activity/friend/schedule），共 16 个文本点 + 2 个图片点；各函数 `secCheck.js` 统一实现，`config.json` 已声明 openapi 权限
- 违规统一返回 `CONTENT_RISKY`，前端仅提示「发布的内容包含违规信息」；接口故障放行并记日志（fail-open）
- 反馈中心（feedbackCenter）由前端直写数据库改为走 `buddy/submitFeedback` 云函数
- **部署注意：6 个云函数需重新部署，权限才生效**

## 二、好友模块 → 日程共享中心

- 定位：不帮用户认识陌生人，只帮现实认识的同学共享日程、管理授权、算共同空闲
- 命名：Tab「好友」→「共享」；页面「日程共享」；好友→日程联系人；好友申请→共享邀请；好友详情→共享设置
- 权限模型：`friendships.share[uid]` 由布尔升级为 `{ level: none|busy|title|detail, showLocation, allowFreeTimeCalc, startDate, endDate }`，旧数据 true 自动迁移为 busy（旧好友可见范围收窄为仅忙闲，属有意行为）
- 服务端按 level 过滤日程字段：busy 只给时间+忙闲；title 加课程名；detail 加地点（需 showLocation）；私密日程任何级别不返回
- 添加方式：微信邀请卡片（主，`?inviteFrom=` 直达接受面板）+ Xipoo ID 精确查询（次）；接受时选择授予权限，默认 busy
- 联系人页三标签：共享给我的 / 我共享的 / 时间小组（本地存储常用组合，可一键带入多人共同空闲）
- 共享设置页：双向权限分区域展示，等级/地点/共同空闲开关/有效期修改均写服务端
- **部署注意：friend、match 云函数需重新部署**

## 三、功能精简

- `friends` 云函数（旧版无调用方）已从云端删除，本地代码保留；`cloudfunctions/` 本就在上传忽略列表中
- 日程页移除「课程表/匹配」切换及匹配视图（找搭子/找课友/约时间入口），代码保留不删；外部跳转 `scheduleKind=activity` 强制回课程表

## 验证

- 全部 14 个 node 测试通过（含新增 `content-security`、`schedule-share-permission` 两个专项）
- 待真机回归：昵称敏感词拦截、微信邀请卡片全流程、busy/title/detail 三档日程展示

## 遗留

- 二维码邀请（wxacode）未做，当前共享码=复制 Xipoo ID；邀请过期/撤销仅有字段预留
- 搭子模块（packages/social）未去社交化，如需同样整改另行处理
- `imgSecCheck` 官方已标记维护，大图/音视频需求再迁移 `mediaCheckAsync`
