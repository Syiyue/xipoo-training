# Xipoo数据库结构设计

## 1. 通用字段

所有重要集合建议包含：

```js
{
  _id,
  createdAt,
  updatedAt,
  createdBy,
  updatedBy,
  status,
  deletedAt
}
```

status优先使用shared/constants.js中的状态值。

## 2. users

用途：用户主表。

```js
{
  _id,
  _openid,
  userId,
  xipooId,
  nickname,
  avatarUrl,
  bio,
  tags,
  language,
  privacy: {
    allowSearch,
    scheduleVisibleToFriends
  },
  createdAt,
  updatedAt,
  status
}
```

建议索引：

* _openid
* userId
* xipooId

## 3. counters

用途：生成自增编号，例如Xipoo ID。

```js
{
  _id,
  key,
  value,
  updatedAt
}
```

## 4. schedules

用途：课程、活动、自定义日程。

```js
{
  _id,
  _openid,
  userId,
  title,
  type,
  courseCode,
  className,
  location,
  teacher,
  date,
  dayOfWeek,
  startTime,
  endTime,
  startAt,
  endAt,
  weeks,
  semester,
  source,
  createdAt,
  updatedAt,
  status
}
```

建议索引：

* userId
* startAt
* endAt

补充字段：`excludedFromFreeTime: true` 表示用户在「多人共同空闲」里标记为不去上的课程，计算共同空闲时不计入忙碌（见 `cloudfunctions/match/lib.js` 与 `utils/mockBackend.js` 的 groupFreeSlots 实现）。

## 4½. companion_ads / companion_ad_events

噗噗推广位（见 docs/ai-companion-ads.md）：

```js
// companion_ads
{ id, title, copy, copyEn, icon, imageUrl, action, sceneTags, publisherKey,
  startAt, endAt, dailyCapPerUser, priority, status, stats, createdBy, createdAt, updatedAt }

// companion_ad_events
{ adId, userId, type, scene, createdAt }
```
* semester

## 5. friend_requests

用途：好友申请。

```js
{
  _id,
  fromUserId,
  toUserId,
  message,
  status,
  createdAt,
  updatedAt
}
```

建议索引：

* fromUserId
* toUserId
* status

## 6. friendships

用途：好友关系。

```js
{
  _id,
  users,
  userA,
  userB,
  schedulePermission: {
    userAToB,
    userBToA
  },
  status,
  createdAt,
  updatedAt,
  deletedAt
}
```

说明：

* users字段保存两个userId，方便查询。
* schedulePermission表示双方是否向对方开放课表。
* 删除好友时建议软删除。

## 7. match_results

用途：保存匹配结果。

```js
{
  _id,
  creatorUserId,
  participantUserIds,
  dateRange,
  timeRange,
  freeSlots,
  busyHeatmap,
  createdAt,
  expiresAt,
  status
}
```

## 8. activities

用途：活动主表（以 `activityAdmin.saveActivity` 实际写入为准）。

```js
{
  _id,            // 与 id 相同（activity-<timestamp>）
  id,
  publisherKey,
  category,       // other / sports / academic / culture / career / social
  typeZh, typeEn,
  title, titleZh,
  coverUrl,
  date,           // YYYY-MM-DD
  start, end, time,
  place, placeZh,
  host, hostZh,
  desc, descZh,
  tags, tagsZh,
  scheduleTag,
  popupTitleZh, popupTitle, popupContentZh, popupContent, // 点按弹窗（可选）
  pinned, polished,
  isHot, isRecommended,
  // 第三方小程序跳转（模块 2）
  jumpType,       // none（默认，站内详情页）/ quickReservation / otherMiniProgram
  targetAppId,    // 目标小程序 AppID（jumpType != none 时必填）
  targetPath,     // 目标页面路径
  activityParams, // 活动参数：JSON 对象串（→ extraData）或 query 串（→ 拼到 path）
  clickCount,     // 累计点击量（trackClick 冗余计数）
  shareCount, likeCount, joinCount, comments,
  createdAt, updatedAt, updatedBy
}
```

> 注：早期版本文档中的 `capacity / registrationCount / status / publisherId / startAt / endAt` 字段从未实际写入，
> 以本节为准。`utils/activityStatus.js` 的状态标签对这些字段做了兼容，数据补齐后自动生效。

## 8.1 activity_clicks

用途：活动卡片点击明细（模块 2，小程序端 `activity` 云函数 `trackClick` 写入）。

```js
{
  _id,
  activityId,
  openid,     // 用户匿名标识（游客也有 openid；后台导出时脱敏）
  jumpType,   // 点击时的跳转类型（none 表示进了站内详情页）
  date,       // YYYY-MM-DD，范围筛选用
  createdAt
}
```

## 8.2 自研预约（模块 3）

自研预约活动 = `activities.jumpType === 'nativeReservation'`；展示字段以主表为准，预约配置按下表关联。

**reservation_activities** — 预约规则与库存总数：

```js
{ _id, activityId, rules, rulesEn, totalStock, createdAt, updatedAt, updatedBy }
```

**reservation_slots** — 预约时段：

```js
{ _id, activityId, date,      // YYYY-MM-DD
  start, end,   // HH:mm
  capacity,     // 最大可预约数
  remaining,    // 剩余名额（事务内增减）
  closed,       // 可选：有时段的订单存在但配置已移除时标记下线
  createdAt }
```

**reservation_orders** — 预约订单：

```js
{ _id, activityId, slotId, openid, xipooId,
  status,       // booked / cancelled
  verifyStatus, // unused / verified
  createdAt, cancelledAt }
```

约束：同一用户对同一活动仅允许一条 booked 订单（`reservation/lib.js validateOrder`，事务内执行）。

## 8.3 π空间主理人与活动分类（模块 4）

**activity_categories** — 活动分类（一级分区 scope + 二级分类）：

```js
{ _id, scope,   // paispace（π空间专属）/ global（全站通用）
  key,          // 同 scope 下唯一，小写
  nameZh, nameEn, sort, enabled,
  createdAt, updatedAt }
```

**space_managers** — 空间主理人账号（π空间为首个试点，绑定 publisherKey='pai_space'）：

```js
{ _id, username, password,  // 明文仅 demo/内网约定，与 activityAdmin/accounts.js 一致
  displayName, publisherKey, enabled, createdAt }
```

说明：`activityAdmin` 登录时 ACCOUNTS 查不到会回源本集合，命中即获得 publisher_admin 权限（仅限所绑空间）；`activities.categoryKey` 关联分类 key，paispace scope 的分类仅 π空间活动可用。

## 9. activity_publishers

用途：活动发布方。

```js
{
  _id,
  key,
  nameZh,
  nameEn,
  type,
  campus, // 校区：'tc'（太仓，默认）| 'sip'（苏州工业园区）；与 discoveryTags 中的 sip 标记保持同步
  sourceChannel, // 来源渠道：未认证活动方在小程序端展示「摘自 xx」标注
  descriptionZh,
  descriptionEn,
  avatarFileId,
  status
}
```

## 10. activity_subscriptions

用途：用户订阅活动发布方。

```js
{
  _id,
  userId,
  publisherId,
  createdAt,
  status
}
```

## 11. activity_registrations

用途：活动报名。

```js
{
  _id,
  activityId,
  userId,
  status,
  createdAt,
  updatedAt
}
```

## 12. activity_comments

用途：活动评论。

```js
{
  _id,
  activityId,
  userId,
  content,
  createdAt,
  updatedAt,
  status
}
```

## 13. user_blocks

用途：屏蔽用户。

```js
{
  _id,
  userId,
  blockedUserId,
  reason,
  createdAt,
  status
}
```

## 14. user_reports

用途：举报记录。

```js
{
  _id,
  reporterUserId,
  targetUserId,
  targetType,
  targetId,
  reason,
  detail,
  createdAt,
  status
}
```

## 15. schedule_import_tasks / ocr_tasks

用途：课表OCR导入任务。

```js
{
  _id,
  userId,
  fileId,
  status,
  rawResult,
  parsedCourses,
  errorMessage,
  createdAt,
  updatedAt
}
```

## 16. 权限原则

* 用户只能直接操作自己的数据。
* 涉及他人的课表、好友关系、匹配结果必须走云函数。
* 公开活动可以开放读取，但报名、评论、收藏必须走云函数。
* AI/OCR密钥不能出现在前端代码中。