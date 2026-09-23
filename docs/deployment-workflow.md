# Xipoo 部署工作流

> 标准化云开发部署运维规范 v2.0  
> 适用于 CloudBase + 微信小程序 + Admin Web

---

## 一、部署架构总览

```
┌─────────────────────────────────────────────┐
│              Xipoo 部署架构                   │
├─────────────┬─────────────┬─────────────────┤
│  微信小程序  │  Admin Web  │  云函数集群      │
│  (wx.cloud) │  (静态托管) │  (Node.js 16+)   │
├─────────────┼─────────────┼─────────────────┤
│  pages/     │  admin/web/ │  cloudfunctions/ │
│  packages/  │  index.html │  ├─ login/       │
│  utils/     │  config.js  │  ├─ activity/    │
│  app.js     │  SDK 本地   │  ├─ activityAdmin│
│             │             │  ├─ schedule/    │
│             │             │  ├─ user/        │
│             │             │  ├─ friend/      │
│             │             │  └─ buddy/       │
└─────────────┴─────────────┴─────────────────┘
```

---

## 二、云函数部署

### 2.1 前置要求

- 微信开发者工具已登录
- CloudBase 环境 `prod-d3ged1wr3c6f6ce74` 已开通
- Node.js >= 16.13

### 2.2 部署顺序（必须严格遵守）

| 序号 | 云函数          | 依赖                            | 说明                                     |
|------|----------------|--------------------------------|------------------------------------------|
| 1    | `login`        | 无                             | 基础登录注册，所有功能的前置依赖           |
| 2    | `user`         | users 集合                     | 用户资料管理                             |
| 3    | `schedule`     | users 集合                     | 课程表 + OCR                             |
| 4    | `activity`     | activities, activity_publishers| 活动中心核心逻辑                         |
| 5    | `activityAdmin`| activity_publishers, users     | 活动管理后台                             |
| 6    | `friend`       | users, friend_requests         | 好友系统                                 |
| 7    | `match`        | users, match_pools             | 搭子匹配                                 |
| 8    | `buddy`        | users, buddy_posts             | 通用搭子帖                               |
| 9    | `seed`         | 所有集合                       | 种子数据（仅开发环境）                    |

### 2.3 手动部署

```bash
# 在微信开发者工具中：
# 右键 cloudfunctions/login → 上传并部署：云端安装依赖

# 或者使用 CloudBase CLI
tcb login
tcb fn deploy login --envId prod-d3ged1wr3c6f6ce74
tcb fn deploy activity --envId prod-d3ged1wr3c6f6ce74
tcb fn deploy activityAdmin --envId prod-d3ged1wr3c6f6ce74
tcb fn deploy schedule --envId prod-d3ged1wr3c6f6ce74
```

### 2.4 HTTP 访问服务（Admin Web 用）

```bash
# 为 activityAdmin 创建 HTTP 触发器
tcb service create --envId prod-d3ged1wr3c6f6ce74

# 获取 HTTP 触发器地址
tcb service list --envId prod-d3ged1wr3c6f6ce74
# 记录当前 prod 环境返回的 activityAdmin HTTP 地址
```

### 2.5 AI 识图录入（混元视觉模型）

`activityAdmin` 的「AI 一键录入」识图**已迁移到混元视觉模型**（与语音/改稿/润色统一走 CloudBase AI，**不再需要火山方舟 `ARK_API_KEY`**），云函数内用 `@cloudbase/node-sdk` 的 `app.ai()` 调用，运行时自带凭证：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HUNYUAN_VISION_GROUP` | 识图模型分组，可选 | `cloudbase` |
| `HUNYUAN_VISION_MODEL` | 识图模型 ID，可选 | `hy3-preview` |

注意事项：
- 函数超时需 ≥ 120s（AI 识别耗时 15~60s），当前已配置为 120s。
- 海报图片**不要**用 base64 走云函数请求体（默认 HTTP 域名限制约 100KB，会报 `EXCEED_MAX_PAYLOAD_SIZE`）；正确做法是前端先 `uploadFile` 到云存储（`ai-import/` 前缀），再把 `fileID` 传给 `aiImportActivity`。
- 旧分组 `hunyuan-exp` 已迁移到内置 `cloudbase` provider；识图、语音、改稿、润色统一用 `cloudbase` + `hy3-preview`。

### 2.6 语音录入（混元大模型）

「AI 一键录入 → 语音录入」使用腾讯云开发混元模型，**无需配置 API Key**：当前环境为「小程序成长计划」，混元仅允许云开发 SDK 调用（直接 HTTP 调 AI 网关会报 `AI_CHANNEL_NOT_ALLOWED`），因此 `activityAdmin` 通过 `@cloudbase/node-sdk`（≥3.16.0，已加入依赖）的 `app.ai().createModel()` 调用，使用云函数运行时凭证。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HUNYUAN_GROUP` | 模型分组，可选 | `cloudbase` |
| `HUNYUAN_MODEL` | 文本模型 ID，可选 | `hy3-preview` |
| `HUNYUAN_VISION_GROUP` | 识图模型分组，可选 | `cloudbase` |
| `HUNYUAN_VISION_MODEL` | 识图模型 ID，可选 | `hy3-preview` |

注意事项：
- 语音转文字用的是浏览器自带 Web Speech API（Chrome / Edge 可用；Firefox 等不支持时自动降级为纯文字输入）。
- 扣的是环境混元免费 Token 资源包（10 亿 Token），文本整理单次消耗很小。
- 文字海报生成为纯前端 Canvas 实现，不经过云函数，不消耗 AI 额度。
- 旧分组 `hunyuan-exp` 已迁移到内置 `cloudbase` provider；语音、识图、改稿、润色统一用 `cloudbase` + `hy3-preview`。

---

## 三、Admin Web 部署

### 3.1 CloudBase JS SDK 离线部署

由于网络限制，Admin Web 使用离线版 SDK。

**文件清单：**

```
admin/web/
├── index.html          # 管理后台主页面
├── config.js           # 环境配置
├── cloudbase.full.js   # CloudBase JS SDK (离线版)
└── README-SDK.txt      # SDK 下载说明
```

**SDK 获取（二选一）：**

```bash
# 方案 A：从 npm 复制
mkdir tmp-sdk && cd tmp-sdk
npm init -y
npm install @cloudbase/js-sdk@2.11.0
cp node_modules/@cloudbase/js-sdk/dist/cloudbase.full.js ../admin/web/

# 方案 B：从 CDN 下载（需其他网络）
# 下载后放入 admin/web/ 目录
```

### 3.2 静态托管部署

```bash
# 上传到静态托管（第二个参数是云端路径，省略会误传到站点根目录）
tcb hosting deploy admin/web admin/web --envId prod-d3ged1wr3c6f6ce74

# 获取访问地址
tcb hosting list --envId prod-d3ged1wr3c6f6ce74
# 使用当前 prod 环境返回的静态托管地址
```

---

## 四、数据库集合初始化

### 4.1 必需集合

| 集合名                     | 权限               | 说明               |
|---------------------------|-------------------|--------------------|
| `users`                   | 仅创建者可读写      | 用户数据            |
| `activities`              | 所有用户可读        | 活动数据            |
| `activity_publishers`     | 所有用户可读        | 活动方/发布方       |
| `activity_subscriptions`  | 仅创建者可读写      | 用户订阅            |
| `activity_registrations`  | 仅创建者可读写      | 活动报名            |
| `activity_comments`       | 所有用户可读        | 活动评论            |
| `activity_interactions`   | 仅创建者可读写      | 活动互动            |
| `activity_schedules`      | 仅创建者可读写      | 活动加入日程        |
| `activity_publisher_logs` | 管理员可读          | 操作日志            |
| `friend_requests`         | 仅创建者可读写      | 好友请求            |
| `friendships`             | 仅创建者可读写      | 好友关系            |
| `schedule_items`          | 仅创建者可读写      | 课程表条目          |
| `match_pools`             | 仅创建者可读写      | 匹配池              |
| `match_pairs`             | 仅创建者可读写      | 匹配对              |
| `buddy_posts`             | 所有用户可读        | 搭子帖              |
| `user_reports`            | 仅创建者可读写      | 用户举报            |
| `moderation_actions`      | 管理员可读          | 管理操作            |
| `companion_ads`           | 所有用户可读        | 噗噗推广卡片（仅云函数写入） |
| `companion_ad_events`     | 仅创建者可读写      | 推广曝光/点击/关闭埋点 |

### 4.2 自动创建

`login` 云函数 v2.0 已支持自动创建 `users` 集合。  
其他集合建议在 CloudBase 控制台手动创建。

---

## 五、部署检查清单 (Checklist)

### 部署前 ✅

- [ ] Node.js 版本 >= 16.13
- [ ] 微信开发者工具已登录
- [ ] CloudBase 环境已开通
- [ ] 所有云函数目录存在 `package.json`
- [ ] Admin Web 的 `cloudbase.full.js` 已就位
- [ ] `admin/web/config.js` 中的 `httpTriggerUrl` 已更新

### 部署中 ✅

- [ ] 按顺序部署：login → user → schedule → activity → activityAdmin → friend → match → buddy
- [ ] 每个云函数上传后检查日志（微信开发者工具 → 云开发 → 云函数 → 日志）
- [ ] Admin Web 静态托管文件已上传

### 部署后验证 ✅

- [ ] 小程序登录成功，返回有效 session
- [ ] 活动列表正常加载
- [ ] 活动订阅/报名功能正常
- [ ] Admin Web 登录成功
- [ ] Admin Web 可创建/编辑活动
- [ ] Admin Web 可管理发布方
- [ ] 课程表 OCR 导入可用

---

## 六、常见部署问题

### 6.1 "Failed to fetch" 登录报错

**原因：** 云环境未初始化 或 云函数未部署

**解决：**
1. 确认 `app.js` 最终调用 `wx.cloud.init({ env: 'prod-d3ged1wr3c6f6ce74' })`
2. 确认 `login` 云函数已上传部署
3. 确认 `utils/cloudConfig.js` 中 `CLOUD_ENV_ID` 正确

### 6.2 云函数 -504002 错误

**原因：** 云函数未找到

**解决：** 重新上传对应云函数，确保部署到正确的环境

### 6.3 数据库集合不存在 (-502005)

**原因：** 集合未创建

**解决：**
- 自动修复：`login` v2.0 会自动创建 `users` 集合
- 手动修复：在 CloudBase 控制台 → 数据库 → 添加集合

### 6.4 Admin Web 登录失败

**原因：** HTTP 触发器地址配置错误

**解决：**
1. 确认 `admin/web/config.js` 中 `httpTriggerUrl` 正确
2. 确认 `activityAdmin` 云函数已部署 HTTP 触发器
3. 检查浏览器控制台网络请求

---

## 七、版本管理

| 文件                           | 当前版本              | 说明               |
|-------------------------------|----------------------|--------------------|
| `cloudfunctions/login/`       | `login-v2-20260720`  | 数据库重试 + 自动创建 |
| `cloudfunctions/activityAdmin/`| `activityAdmin-v2-20260720` | 企业级重构 |
| `utils/cloudConfig.js`        | v2                   | 云环境状态诊断      |
| `admin/web/index.html`        | v1                   | Admin Web 前台      |
| `admin/web/config.js`         | v1                   | Admin Web 配置      |

---

## 八、回滚方案

如遇到严重问题需要回滚：

```bash
# 通过 Git 回滚到上一个稳定版本
git log --oneline -5
git revert <commit-hash>

# 重新部署受影响的云函数
# 在微信开发者工具中上传并部署对应云函数
```

**已知稳定版本：**
- commit `5d3fab3` - v1 基准版本
