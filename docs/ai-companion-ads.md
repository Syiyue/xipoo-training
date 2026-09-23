# 噗噗推广位（AI 广告推送）方案

> 状态：待评审。目标：让小章鱼具备「推广内容」推送能力，内容在管理后台可配置、可用混元生成文案、带曝光/点击数据回流，同时守住用户体验与合规红线。

## 1. 定位与原则

噗噗推广位 = 以「噗噗建议卡片」原生形态出现的推广内容（校内商家优惠、活动方推广、自营功能导流等）。
它不是横幅广告，而是和建议共用同一套 UI 与触达通道，因此必须更克制：

- **原生但有标识**：卡片样式与建议一致，但固定带「推广」角标（广告法要求可识别性）。
- **建议优先**：推广卡片永远排在有机建议之后；同一天推广展示有全局上限。
- **AI 在后台，不在端上**：文案由后台用混元生成并落库，运营审核后才投放；端上只做展示，不做实时生成（可控、可审、省 token）。
- **尊重所有既有开关**：助手总开关关闭 = 推广也不出现；免打扰时段、冷却规则对推广同样生效且更严。

## 2. 数据模型

### 新集合 `companion_ads`（推广卡片）

```js
{
  _id,
  id: 'ad-xxxx',              // 业务 id
  title: '第二杯半价',         // 后台内部名称
  copy: '图书馆咖啡第二杯半价，今天下午就能用～', // 最终投放文案（AI 生成 + 人工确认）
  copyEn: '',                  // 可选英文文案
  icon: '☕',                  // 卡片 emoji 图标
  imageUrl: '',                // 可选配图（云存储 fileID，复用 uploadImage）
  action: { kind: 'navigate', url: '/packages/activity/pages/activityDetail/activityDetail?id=...' },
                             // 跳转：页面路径 / 活动详情 / 活动方主页；空 = 仅展示
  sceneTags: ['free-gap', 'day-done'],
                             // 场景标签：只在命中的场景出现（见 §4）；空 = 通用，只进面板
  publisherKey: '',            // 可选关联活动方（推广已入驻活动方时）
  startAt: '2026-08-10T00:00:00+08:00',
  endAt: '2026-08-20T23:59:59+08:00',
  dailyCapPerUser: 1,          // 每用户每天最大展示次数
  priority: 20,                // 固定低于所有有机建议（有机最低 30）
  status: 'draft' | 'active' | 'paused' | 'ended',
  stats: { impressions: 0, clicks: 0 },   // 冗余计数（明细在事件集合）
  createdBy: 'admin01', createdAt, updatedAt
}
```

### 新集合 `companion_ad_events`（埋点明细）

```js
{ _id, adId, userId, type: 'impression' | 'click' | 'close', scene, createdAt }
```

- `userId` 只存 xipooId，不含 openid/手机号（沿用 admin-data-api.md 的隐私红线）。
- 后台看板按 adId + 天聚合；`stats` 冗余字段保证列表页免聚合快读。

## 3. 投放链路

```
后台编辑器（填卖点 → 混元生成噗噗口吻文案 → 人工确认 → 设定时间窗/场景/频控）
   │  activityAdmin 新 action：listAds / saveAd / deleteAd / setAdStatus（仅 super_admin）
   ▼
companion_ads 集合
   │  小程序端拉取：companion 云函数新增 action=ads（只读，按 status/time 过滤后下发）
   ▼
companionAdvisor 注入为 type='promotion' 的建议卡片（带 adId、场景、频控规则）
   │
   ▼
气泡（可选，见 §6 决策点）/ 面板卡片（固定「推广」角标）
   │
   ▼
展示/点击/关闭 → companion 云函数 action=track 写入 companion_ad_events + stats 计数 +1
   ▼
后台「推广位」tab 看板（曝光、点击、CTR、按天趋势）
```

- 后台调用沿用现有模式：`admin/web/index.html` 加 tab，`callAdmin(action, payload)` → `activityAdmin` 云函数，`verifyToken` + `isSuperAdmin` 鉴权，`ok()/fail()` 返回约定不变。
- 端上读取沿用 `withCloudOrMock` 双通道：`api.getCompanionAds()`，mockBackend 加兜底（本地开发/测试可用）。
- 下发前云函数已按 `status=active && startAt<=now<=endAt` 过滤，端上不再判断时间窗。

## 4. 场景匹配规则

`sceneTags` 决定推广卡片可以出现在哪个上下文，由 advisor 在生成建议时判断：

| sceneTag | 命中条件（复用 advisor 现有判定） |
| --- | --- |
| `free-gap` | 当前处于 ≥60 分钟课间空档 |
| `day-done` | 今日课程已结束 |
| `class-soon` | 45 分钟内有课（如「下课后可用」类文案） |
| `weekend` | 周四/周五（周末计划类推广） |
| `lunch` / `dinner` | 11:00-13:00 / 17:00-19:30（餐饮券专用时段） |
| 空数组 | 通用：只出现在建议面板，不主动弹气泡 |

端上频控（在既有冷却机制之上叠加）：
- 每用户每天推广展示总数 ≤ 2 次（独立计数 key `xipoo_companion_ads_daily`，按天重置）；
- 同一张卡片 24 小时内不重复展示（复用 `xipoo_companion_cooldown`，key = `promotion:{adId}:{date}`）；
- 用户点过「不再看这条」（close 事件）→ 该 adId 永久不再展示（storage 黑名单）。

## 5. 后台功能（admin/web 新增「🐙 推广位」tab）

1. **卡片列表**：状态 / 时间窗 / 场景标签 / 频控 / 曝光·点击·CTR；操作：编辑、暂停/恢复、删除。
2. **编辑器**：
   - 输入：内部名称、卖点（自由文本，如「图书馆咖啡店，本周第二杯半价，凭学生证」）、跳转链接、场景标签、时间窗、频控；
   - **AI 生成文案**按钮：`activityAdmin` 新 action `generateAdCopy`（复用现成混元调用模式，参照 `aiPolishActivityDesc`），输入卖点 + 噗噗人设，一次返回 3 条候选，运营选一条可再编辑；
   - **实时预览**：渲染成小程序里噗噗卡片的样子（含「推广」角标）。
3. **数据看板**：按卡片展示曝光/点击/CTR，按天简单趋势（前期表格即可，不引入图表库）。

权限：仅 `super_admin` 可管理推广位与查看数据（publisher_admin 暂不开放，避免活动方自助投广的审核风险）。

## 6. 合规与体验红线

- 每张推广卡片固定「推广」角标；气泡文案同样带标识。
- 遵守免打扰时段（22:00-07:00 不主动弹）；助手总开关关闭即全部不出现。
- 推广不读取任何额外用户数据；定向只依赖端上本地上下文（当前场景），不把用户行为回传给广告主。
- 埋点只记 xipooId + 事件类型，后台列表不展示个人维度明细（只给聚合数）。
- 校园场景内容自律：不接医疗/金融/游戏类推广（写进 admin-guide 运营规范）。

## 7. 实施步骤（建议分三期）

**M1 数据链路 + 后台 CRUD（核心可用）**
- 建集合 `companion_ads` / `companion_ad_events`（补登 database-schema.md 与 deployment-workflow.md 建表清单）
- `activityAdmin`：`listAds / saveAd / deleteAd / setAdStatus`
- `admin/web`：推广位 tab（列表 + 编辑器，文案先手写）
- `companion` 云函数：`action=ads` 只读下发 + `action=track` 埋点
- `api.js` + mockBackend：`getCompanionAds()` / `trackCompanionAd()`

**M2 端上展示 + 频控 + 埋点**
- advisor：`promotion` 类型（priority 20，固定带「推广」角标与 action）
- 组件：场景匹配、每日上限、单卡冷却、close 黑名单
- 埋点上报与后台数据列

**M3 AI 文案 + 看板**
- `generateAdCopy`（混元，3 候选 + 可编辑）与编辑器预览
- 后台按天聚合看板

## 8. 决策点（已定）

1. **推广能否主动弹气泡？** 场景命中才弹：带场景标签且命中的卡片可弹气泡（每日全局限 1 条）；通用卡片只进面板。
2. **内容来源**：只推站内活动方与自营功能，无结算概念；后台仅 `super_admin` 可管理。
3. **目标人群**：本期全员投放，不做年级/专业定向。
4. **close 黑名单**：永久生效（存端上 storage，上限 100 条）。
