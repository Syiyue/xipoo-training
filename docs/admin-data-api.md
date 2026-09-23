# Xipoo 后台数据与活动方门面 API

本文交给实现/维护后台的 AI 使用。所有接口由云函数 `activityAdmin` 提供；不要把云函数管理员账号、token、用户的 openid、手机号、微信号或联系方式展示到后台列表中。

## 1. 调用约定

请求体统一为：

```json
{
  "action": "listActivityRegistrations",
  "token": "登录接口返回的 token",
  "payload": {}
}
```

小程序或 CloudBase 后台通过 `wx.cloud.callFunction({ name: 'activityAdmin', data })` 调用。HTTP 触发器同样接收以上 JSON 请求体。

成功响应：

```json
{ "ok": true, "data": {}, "version": "activityAdmin-v2-20260727" }
```

失败响应：

```json
{ "ok": false, "errorCode": "FORBIDDEN", "message": "无权查看该活动方的报名数据" }
```

后台必须先判断 `ok`，不可把失败响应当作空数据处理。`page` 从 1 开始，`pageSize` 默认 20、最大 100。

## 2. 角色与数据范围

| 角色 | 可查看用户目录 | 可查看报名 | 可配置活动方门面 |
| --- | --- | --- | --- |
| `super_admin` | 全部（脱敏） | 全部活动方 | 全部 |
| `publisher_admin` | 不可查看 | 仅 `publisherKeys` / `publisherKey` 名下活动 | 仅授权活动方（后台必须再做 UI 限制） |
| 其他角色 | 不可 | 不可 | 不可 |

云函数对新增数据接口执行了上述检查。后台界面也应隐藏无权入口，不能只依赖前端隐藏。用户目录只返回 Xipoo ID、昵称、头像、状态和时间字段；禁止新增任何可识别个人联系方式的导出功能。

## 3. 数据看板接口（新增）

### `getRegistrationOverview`

用于首页指标卡和报名趋势图。`super_admin` 会额外看到全站注册、近 7 日新增与活跃用户数；活动方管理员只看到自己范围内的活动和报名数据。

```json
{
  "action": "getRegistrationOverview",
  "token": "TOKEN",
  "payload": { "dateFrom": "2026-07-01", "dateTo": "2026-07-31" }
}
```

`dateFrom` / `dateTo` 为可选的报名创建日期范围，格式 `YYYY-MM-DD`。

关键返回字段：

```json
{
  "ok": true,
  "data": {
    "scope": { "role": "super_admin", "publisherKeys": [], "allPublishers": true },
    "totals": {
      "activities": 12,
      "registrations": 88,
      "activeRegistrations": 81,
      "uniqueRegisteredUsers": 62,
      "registeredUsers": 240,
      "newUsersLast7Days": 18,
      "activeUsersLast7Days": 96
    },
    "registrationTrend": [{ "date": "2026-07-14", "registrations": 6 }],
    "publisherBreakdown": [{ "publisherKey": "campus_union", "registrations": 32, "activeRegistrations": 30, "uniqueUsers": 25 }]
  }
}
```

活动方权限下，`registeredUsers`、`newUsersLast7Days`、`activeUsersLast7Days` 不会返回。界面不要显示为 0，应显示“仅总管理员可见”。

### `listUsers`

仅 `super_admin` 使用，用于注册用户列表和站内审核入口。

```json
{
  "action": "listUsers",
  "token": "TOKEN",
  "payload": { "page": 1, "pageSize": 20, "keyword": "XP7", "status": "active" }
}
```

`keyword` 按 Xipoo ID / 昵称搜索，`status` 可不传。每项字段：

```json
{
  "xipooId": "XP1001",
  "name": "小明",
  "avatarUrl": "cloud://...",
  "status": "active",
  "createdAt": "2026-07-20T08:00:00.000Z",
  "lastActiveAt": "2026-07-27T08:00:00.000Z"
}
```

不要在列表或详情接口中增加 `openid`、unionid、手机号、邮箱、微信号、精确地址等字段。

### `listActivityRegistrations`

活动方报名明细。`super_admin` 可筛选任意 `publisherKey`；活动方管理员只可查看自己的 key。

```json
{
  "action": "listActivityRegistrations",
  "token": "TOKEN",
  "payload": {
    "page": 1,
    "pageSize": 20,
    "publisherKey": "campus_union",
    "activityId": "activity-20260727-1",
    "status": "registered",
    "dateFrom": "2026-07-01",
    "dateTo": "2026-07-31"
  }
}
```

`dateFrom` / `dateTo` 筛选活动日期。返回每项仅含活动标题、时间地点、报名状态、创建时间及脱敏用户摘要：

```json
{
  "id": "registration-...",
  "activityId": "activity-20260727-1",
  "publisherKey": "campus_union",
  "title": "社团招新分享会",
  "date": "2026-07-27",
  "time": "14:00-16:00",
  "place": "大学生活动中心",
  "status": "registered",
  "createdAt": "2026-07-26T10:00:00.000Z",
  "user": { "xipooId": "XP1001", "name": "小明", "avatarUrl": "", "status": "active" }
}
```

## 4. 活动方门面（已有接口）

活动方不是普通用户，而是活动页展示的“门面”。后台 AI 应使用以下已有 action：

| action | 用途 |
| --- | --- |
| `listPublishersFull` | 门面列表、搜索和统计 |
| `savePublisher` | 新建或保存门面资料 |
| `togglePublisher` | 启用/停用活动方 |
| `deletePublisher` | 删除无关联活动的活动方 |
| `batchUpdatePublishers` | 批量启停、排序、配额 |
| `getPublisherStats` / `getPublisherLogs` | 运营统计和变更审计 |
| `exportPublishers` | 导出非敏感运营字段 |

活动发现页运营位（热门轮播 / 推荐双列）使用 `setActivityFlags`：`payload` 为 `{ "id": "activity-xxx", "isHot": true, "isRecommended": false }`（两个标记至少传一个），仅更新这两个布尔字段，不影响活动其他内容；小程序端两类都未配置时回退展示全部活动。

`savePublisher` 请求示例：

```json
{
  "action": "savePublisher",
  "token": "TOKEN",
  "payload": {
    "publisher": {
      "_id": "更新时传已有 _id；新建时省略",
      "key": "campus_union",
      "nameZh": "校园学生会",
      "name": "Campus Union",
      "campus": "tc",
      "logoUrl": "cloud://...",
      "coverUrl": "cloud://...",
      "descriptionZh": "负责校园文化活动与学生服务。",
      "description": "Campus activities and student services.",
      "taglineZh": "让每一次相遇都有意义",
      "tagline": "Make every encounter matter.",
      "color": "#22c55e",
      "accent": "#86efac",
      "icon": "🎓",
      "verified": true,
      "enabled": true,
      "locationZh": "大学城校区",
      "location": "University Town Campus",
      "storyTitleZh": "关于我们",
      "storyTitle": "About us",
      "storyZh": "活动方介绍正文",
      "story": "Organizer story",
      "contentTagsZh": ["社团", "公益"],
      "contentTags": ["Club", "Public welfare"],
      "discoveryTags": ["campus", "student"],
      "presetTags": ["校园", "讲座"],
      "contactLabelZh": "咨询邮箱",
      "contactLabel": "Contact email",
      "contactValue": "仅填写公开官方联系方式",
      "galleryUrls": ["cloud://..."],
      "quotaFlash": 3,
      "quotaRecommend": 6,
      "sortWeight": 50,
      "pinned": false,
      "visibility": "all"
    }
  }
}
```

规则：`key` 只能是字母、数字、下划线；新建后不可把它当展示名称使用。展示名称使用 `nameZh` / `name`。`campus` 为校区字段，取值 `tc`（太仓）或 `sip`（苏州工业园区），缺省按 `discoveryTags` 中的 `sip` 标记推导、再缺省为 `tc`；提交方携带 `discoveryTags` 时后端会把其中的 `sip` 标记与 `campus` 同步。`listPublishersFull` 支持 `payload.campus`（`tc` / `sip`）按校区筛选。上传的 logo、封面、相册应使用已审核的 CloudBase 文件 URL；`contactValue` 仅允许活动方已公开的官方联系方式。

## 5. 后台页面建议

1. **总管理员首页**：先调用 `getRegistrationOverview`，展示活动数、报名数、近 14 日趋势及按活动方分布。
2. **用户管理**：仅总管理员渲染，使用 `listUsers` 分页和站内状态筛选；点击用户后可继续调用已有 `getUserStatus`、`warnUser`、`banUser`。
3. **活动报名**：调用 `listActivityRegistrations`；活动方管理员的活动方下拉框只能展示其授权 key。
4. **活动方门面**：表单调用 `savePublisher`；保存失败必须显示后端 `message`。启停后刷新列表和看板。
5. **审计和隐私**：所有导出仅用脱敏接口；后台操作日志使用已有 `getPublisherLogs`，不要在浏览器 localStorage 保存 token 以外的个人数据。

## 6. 部署与验收

1. 部署 `main/cloudfunctions/activityAdmin` 到 CloudBase 环境。
2. 根目录后台工程另有一份同名云函数副本；部署后台前必须把本目录的同一版本同步到该副本，避免后台页面调用到旧接口。
3. 用总管理员 token 验证三个新增 action 均返回 `ok: true`；用活动方管理员 token 验证 `listUsers` 返回 `FORBIDDEN`，且 `listActivityRegistrations` 无法跨活动方读取。
4. 验证列表响应中不含 openid、手机号、微信号等敏感字段。
