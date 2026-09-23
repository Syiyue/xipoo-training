# 噗噗助手（AI 小章鱼）设计文档

噗噗是 Xipoo 的品牌吉祥物（紫色小章鱼，形象文件 `images/companion/octopus.png`），
以悬浮组件 `components/ai-companion` 的形式出现在日程 / 活动 / 共享 / 我的四个 tab 页。

## 交互规则

- **日程页**：右下角不再有「+」FAB，小章鱼是唯一入口——点击弹出 ActionSheet：
  「📷 AI 拍照上传课表」（复用日程页 `openAiImport` 链路，含断点恢复）/「✏️ 手动添加日程」；
  章鱼下方固定「AI 课表」小标签，且每个用户首次进入日程页会收到一次噗噗的自我介绍气泡
  （storage `xipoo_companion_met`，只弹一次）；周视图右上角有固定噗噗贴纸
  （`week-corner-deco`，不随课表滚动，背景图 `week_bg.jpg` 已不再内嵌章鱼）。
- **其他 tab 页**：点击小章鱼 = 打开建议面板；面板底部固定「AI 拍照上传课表」入口，
  点击后 `switchTab` 到日程页并自动拉起上传流程（`globalData.pendingAiImport` 标记，
  由 `pages/schedule/schedule.js` 的 onShow 消费）。
- 面板集中展示当前所有建议卡片，按优先级排序，带跳转动作。
- **关闭方式**（三处入口，状态存 storage `xipoo_companion_enabled`，`utils/companionSettings.js`）：
  长按小章鱼 → ActionSheet 关闭；面板底部「关闭噗噗助手」→ 确认弹窗；
  「我的 → 设置 → 噗噗助手」开关（也是唯一的重新开启入口）。
- **动效**：入场回弹（squash-and-stretch）、待机浮动 + 呼吸光环、气泡滑入带指向尾巴、
  红点 ping 扩散、面板遮罩淡入 + 上滑、卡片按压缩放、
  混元生成的文案带 ✨ 闪烁标记、推广卡片带「推广」角标。

## 防打扰机制（不烦人是硬指标）

| 机制 | 规则 |
| --- | --- |
| 免打扰时段 | 22:00 - 07:00 不主动弹气泡（面板随时可手动打开） |
| 单次单条 | 每次页面展示最多弹 1 条气泡，取优先级最高且未冷却的场景 |
| 自动消失 | 气泡 8 秒后自动收起；点 × 立即关闭 |
| 场景冷却 | 每条建议带 `dedupeKey` + `cooldownHours`，storage 记录 `xipoo_companion_cooldown`；按天/按实例去重的场景同一天不重复弹 |
| 红点克制 | 有建议但不弹气泡时只在章鱼角上显示一个小红点 |
| 数据节流 | 页面展示间隔 60s 内不重复拉数据；「好友同课」每节课 12 小时内只查一次，最多查 3 位好友 |
| 页面过滤 | 日程页只推课程类、活动页只推活动类、好友页只推搭子类场景（`companionAdvisor.js` 的 `PAGE_TYPES` 白名单；推广卡片与 profile 页不受限） |
| 学期口径 | 「今天有没有课」与日程页一致按教学周判定：声明了教学周的课程只在学期起算日（`semesterStartDate`）后的对应周次内重复，假期/学期外不会提示「今天 N 节课」 |

## 场景与话术表

话术实现在 `utils/companionLines.js`（每场景多条文案按 seed 稳定轮换，中英双语，
变量缺失时自动避开带该占位符的文案）；判定逻辑在 `utils/companionAdvisor.js`。

| 场景 type | 触发条件 | 跳转动作 | 示例话术 |
| --- | --- | --- | --- |
| `class-soon` | 45 分钟内有课（「不去上」的课除外） | 日程 tab | 「DTS101」还有 15 分钟就开始啦，教室在 TC-D-201，现在过去刚刚好～ |
| `classmate-together` | 即将上的课，好友课表里有同一门（courseId 相同、时间重叠） | 好友课表页 | 这节「DTS101」，小王也一起上！要不要约着一起去？ |
| `new-activity` | 关注的活动方有未来 10 天内的活动 | 活动方主页 | 你关注的趣工坊发新活动啦：「陶艺体验课」，08-15 举行，去看看？ |
| `activity-soon` | 已订阅活动 48 小时内开始 | 活动详情 | 「Livehouse Night」明天就要开始啦，地点 MAO，记得留出时间～ |
| `needs-review` | AI 导入的课程有待补全（needsReview） | 导入记录设置页 | 上次导入的课表还有 3 节课缺信息，抽空补全一下吧～ |
| `early-class-tomorrow` | 20 点后且明天第一节课 ≤ 10:00 | 无 | 明天 09:00 就有「DTS101」，今晚早点休息哦，晚安～ |
| `free-gap` | 当前处于 ≥60 分钟的课间空档 | 无 | 接下来空 2小时，去喝杯咖啡还是图书馆坐会儿？ |
| `day-overview` | 上午（12 点前）且今天有课 | 日程 tab | 早上好呀！今天有 3 节课，噗噗帮你盯着时间。 |
| `day-done` | 今天最后一节课已结束（22 点前） | 有临近活动则跳活动详情 | 今天的课都上完啦，辛苦辛苦！剩下的时间都是你自己的。 |
| `weekend-match` | 周四/周五且有日程联系人 | 多人共同空闲页 | 周末要到啦，去看看你和朋友们哪天都有空吧～ |
| `schedule-empty` | 课表为空 | AI 上传流程 | 还没有课表哦～点我拍张照，10 秒帮你生成整学期课表！ |
| `no-class-day` | 今天没课（18 点前） | 今天的活动详情 / 活动 tab | 今天没有课！自由安排的一天，要不去活动页看看有什么好玩的？ |
| `free-gap-activity` | 课间空档 ≥60 分钟且今天有活动 | 活动详情 | 接下来空 2小时，「陶艺体验课」就在今天，正好去逛逛！ |
| `activity-recommend` | 活动页打开，7 天内有活动 | 活动详情 | 给你种草：「陶艺体验课」明天举行，地点趣工坊～ |
| `week-preview` | 周日 18 点后且下周有课 | 无 | 下周一共 12 节课，最早 09:00 开始。今晚早点休息，新的一周冲鸭！ |
| `profile-incomplete` | 专业或签名未填（仅面板） | 编辑资料页 | 你的资料还差点意思～补全专业和签名，好友一眼认出你。 |
| `subscription-hint` | 一个活动方都没关注（仅面板） | 活动 tab | 还没关注活动方哦～关注之后，新活动噗噗第一时间告诉你。 |
| `promotion` | 后台投放的推广卡片（场景命中才可弹气泡） | 后台配置的链接 | 由后台投放，见 docs/ai-companion-ads.md |

## AI 文案层（混元大模型）

话术表是兜底；实际展示前会经过混元润色，链路为：

- 云函数 `companion`（`cloudfunctions/companion`，Nodejs20.19，`@cloudbase/node-sdk`）：
  - `action=polish`：输入场景 type + 变量 + 模板兜底文案，输出一句润色后的提醒
  - `action=greeting`：输入当日课程/活动摘要，输出面板顶部的每日寄语
  - 模型：`createModel('cloudbase')` + `hy3-preview`
- 前端 `utils/companionAi.js`：调用云函数，结果按 `polish:lang:type:vars` /
  `greeting:lang:date:summary` 持久化缓存（storage `xipoo_companion_ai_cache`，上限 150 条），
  同一场景不重复消耗 token；云端失败/无云环境一律静默返回 null，前端用模板话术兜底。
- 组件行为：气泡先展示模板文案，混元结果返回后原地替换；面板打开时预润色前 3 条建议并加载寄语。

> 注意：新增场景 type 时，需要同时在 `cloudfunctions/companion/index.js` 的
> `SCENARIO_NAMES` 里登记中英文场景描述，否则 polish 会返回 INVALID_PARAM（前端自动回退模板）。

## 数据来源

- 课程：`api.getSchedule()`（`schedules` 集合，`excludedFromFreeTime` 的课不参与提醒）
- 好友：`api.getFriendships()`；好友课表：`api.getFriendSchedule(friendId)`（仅 `friendShare` 且最多 3 位）
- 活动订阅：`api.getActivitySubscriptions()`（含 `latestActivityTitle/Date`）
- 活动列表：`api.getActivities({ pageSize: 20 })`

## 扩展新场景

1. 在 `utils/companionLines.js` 的 `LINES` 里登记话术（中英、priority、cooldownHours、icon）；
2. 在 `utils/companionAdvisor.js` 的 `buildSuggestions` 里加判定分支并给出 dedupeKey 与 action；
3. 在 `tests/ai-companion.test.js` 补断言；
4. 更新本文档的场景表。
