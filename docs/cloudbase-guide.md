# Xipoo CloudBase接入说明

## 1. 后端形态说明

本项目MVP阶段不使用云托管，只使用CloudBase的以下能力：

- 云函数：承接后端业务逻辑
- 云数据库：保存用户、课表、好友、活动、匹配等数据
- 云存储：保存头像、课表截图、活动封面、OCR临时文件
- 控制台日志：用于排查云函数调用问题

也就是说，本项目后端不是一个独立Node服务器，而是：

```txt
小程序页面
↓
utils/api.js
↓
utils/cloudApi.js
↓
CloudBase云函数
↓
CloudBase数据库 / 云存储
```

## 2. 云函数规划

| 云函数      | 负责人   | 用途               |
| -------- | ----- | ---------------- |
| user     | E     | 我的页面、用户资料、设置     |
| schedule | A     | 日程、课程、活动日程       |
| match    | B     | 空闲时间计算、多人匹配      |
| activity | C     | 活动、报名、评论、收藏      |
| friend   | D     | 好友申请、好友关系、日程共享权限 |
| seed     | 技术负责人 | 初始化测试数据          |

## 3. 云函数统一返回格式

成功：

```js
{
  ok: true,
  data: {},
  message: 'success'
}
```

失败：

```js
{
  ok: false,
  errorCode: 'PERMISSION_DENIED',
  message: '无权限访问'
}
```

## 4. 云函数测试

每个云函数必须至少支持ping action：

```json
{
  "action": "ping",
  "payload": {}
}
```

预期返回：

```json
{
  "ok": true,
  "data": {
    "openid": "...",
    "time": 123456789
  },
  "message": "success"
}
```

## 5. 云数据库集合规划

MVP阶段建议集合：

* users
* counters
* schedules
* schedule_import_tasks
* schedule_share_settings
* friend_requests
* friendships
* match_results
* availability_cache
* activities
* activity_publishers
* activity_subscriptions
* activity_registrations
* activity_comments
* activity_interactions
* buddy_posts
* buddy_applications
* course_buddy_profiles
* course_groups
* course_group_applications
* user_blocks
* user_reports
* ocr_tasks
* ai_conversations
* ai_messages
* ai_usage_logs

## 6. 云存储目录规划

建议目录：

```txt
avatars/
schedule-imports/
activity-covers/
ocr-temp/
ai-uploads/
```

## 7. 权限原则

公开内容可以被前端读取，例如活动列表。

以下内容必须走云函数：

* 读取他人课表
* 好友申请与审核
* 好友关系变更
* 日程共享权限
* 匹配结果计算
* 活动报名
* 搭子申请
* 举报和屏蔽
* OCR和AI调用

## 8. 调试流程

如果页面出问题，按以下顺序排查：

1. 页面是否调用了utils/api.js
2. api.js是否调用了utils/cloudApi.js
3. cloudApi.js是否调用了正确云函数
4. 云函数控制台是否有调用日志
5. 云函数是否返回ok: true
6. 数据库集合是否有新增或修改记录
7. 是否因为权限规则导致失败

## 9. 上传云函数规则

联调阶段：

```txt
从develop分支上传
```

正式演示阶段：

```txt
从main分支上传
```

禁止从个人feature分支上传公共云函数。