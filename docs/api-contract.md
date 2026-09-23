# Xipoo API合同

本文件记录前端api.js、cloudApi.js和CloudBase云函数之间的接口合同。

## 1. 通用调用格式

前端页面只调用utils/api.js。

api.js根据utils/config.js决定使用Mock或CloudBase。

CloudBase调用统一通过utils/cloudApi.js：

```js
callCloud(functionName, action, payload)
```

云函数接收：

```js
{
  action: 'actionName',
  payload: {}
}
```

云函数返回：

```js
{
  ok: true,
  data: {},
  message: 'success'
}
```

或：

```js
{
  ok: false,
  errorCode: 'ERROR_CODE',
  message: '错误说明'
}
```

## 2. User模块

云函数：user
负责人：E

### ping

```js
cloudApi.user.ping()
```

### getProfile

```js
cloudApi.user.getProfile({})
```

返回当前用户资料。

### updateProfile

```js
cloudApi.user.updateProfile({
  nickname,
  avatarUrl,
  bio,
  tags,
  language
})
```

## 3. Schedule模块

云函数：schedule
负责人：A

### listSchedules

```js
cloudApi.schedule.listSchedules({
  startDate,
  endDate,
  semester
})
```

### upsertSchedule

```js
cloudApi.schedule.upsertSchedule({
  scheduleId,
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
  source
})
```

### deleteSchedule

```js
cloudApi.schedule.deleteSchedule({
  scheduleId
})
```

## 4. Friend模块

云函数：friend
负责人：D

### searchUser

```js
cloudApi.friend.searchUser({
  xipooId
})
```

### sendRequest

```js
cloudApi.friend.sendRequest({
  toUserId,
  message
})
```

### reviewRequest

```js
cloudApi.friend.reviewRequest({
  requestId,
  action
})
```

action取值：

```txt
accept
reject
```

### listFriends

```js
cloudApi.friend.listFriends({})
```

### deleteFriend

```js
cloudApi.friend.deleteFriend({
  friendUserId
})
```

### setSchedulePermission

```js
cloudApi.friend.setSchedulePermission({
  friendUserId,
  visible
})
```

## 5. Match模块

云函数：match
负责人：B

### calculateAvailability

```js
cloudApi.match.calculateAvailability({
  participantUserIds,
  startDate,
  endDate,
  timeRange
})
```

### getMatchResult

```js
cloudApi.match.getMatchResult({
  matchResultId
})
```

## 6. Activity模块

云函数：activity
负责人：C

### listActivities

```js
cloudApi.activity.listActivities({
  publisherId,
  category,
  tags,
  startDate,
  endDate,
  cursor,
  pageSize
})
```

### getActivityDetail

```js
cloudApi.activity.getActivityDetail({
  activityId
})
```

### registerActivity

```js
cloudApi.activity.registerActivity({
  activityId
})
```

### cancelRegistration

```js
cloudApi.activity.cancelRegistration({
  activityId
})
```

### commentActivity

```js
cloudApi.activity.commentActivity({
  activityId,
  content
})
```

## 7. Seed模块

云函数：seed
负责人：技术负责人

### seedDemoData

```js
cloudApi.seed.seedDemoData({
  confirm: true
})
```

seed函数只允许开发环境使用，不允许正式用户调用。
## 8. 内容安全（所有 UGC 写入）

所有用户发布/编辑内容的云函数写入前都会调用微信公众平台内容安全 API：

- 文本：`security.msgSecCheck`（version: 2，携带 openid 与 scene）
- 图片（头像、反馈配图）：`security.imgSecCheck`（同步检测，图片已在前端压缩）

scene 取值约定：1=资料（昵称/签名/简介/备注），2=评论/留言（申请附言/评论/反馈/举报），3=论坛/帖子（搭子帖/组队/招募帖），4=社交日志（课程标题/地点/教师）。

检测命中违规（errCode 87014）时，各云函数统一返回：

```js
{
  ok: false,
  errorCode: 'CONTENT_RISKY',
  message: '发布的内容包含违规信息，请修改后重新发布'
}
```

前端经 utils/api.js 的 withCloudOrMock 链路，该错误作为业务错误抛出（isCloudBusinessError），页面 catch 后仅向用户展示 message 文案，不展示错误码或检测细节。

其他错误（接口超时/系统忙等）采取放行策略并记录云端日志，避免微信侧故障导致小程序写入不可用。

检测实现统一在各云函数的 `secCheck.js`（内容一致）；openapi 调用权限在各云函数 `config.json` 的 `permissions.openapi` 中声明，修改后需重新部署云函数方可生效。
