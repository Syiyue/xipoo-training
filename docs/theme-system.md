# Xipoo 主题系统与 Figma 样式规范

> 本文档是全局换肤与 Figma 对齐的唯一事实来源。改样式前必读。

## 1. 运行时主题引擎（utils/theme.js）

- 存储：`wx.setStorageSync('xipoo_theme', { type: 'preset'|'custom', color: '#rrggbb' })`
- 入口：`getApp().setTheme(color, type)` / `getApp().resetTheme()` / `getApp().getThemeVars()`
- 注入：全局 Page 拦截器（app.js）在每个页面 onLoad/onShow 把 `themeVars`（CSS 变量串）写入 data；
  每个页面根 view 必须有 `style="{{themeVars}}"`（已全部注入，勿删）。
- 自定义组件通过 CSS 变量继承自动跟随（如 app-tabbar 的 `--tab-icon-filter`）。
- 预设色（共 10 个，前 3 个为莫奈·印象派系列，低饱和柔和色调）：
  - 莫奈·睡莲 `#7c83c7`（**全局默认**，取自《睡莲》系列 Water Lilies, c.1897–1926 的柔紫蓝）
  - 莫奈·日出 `#e8935a`（取自《日出·印象》Impression, soleil levant, 1872 的暖橙）
  - 莫奈·鸢尾 `#8a72c2`（取自《鸢尾花》系列 Irises, c.1914–1917 的蓝紫）
  - 吸噗绿 `#61b673` / 天空蓝 `#4a9bf5` / 葡萄紫 `#8b5cf6` / 樱花粉 `#f06f9c` / 活力橙 `#f2924a` / 青翠绿 `#14b8a6` / 曜石黑 `#3a3a3e`
- 主题选择页（packages/account/pages/theme/）预设从 `PRESETS` 动态渲染；莫奈系色块为
  主色派生（bright→primary→deep）的水彩渐变，其余纯色。「恢复默认」回到莫奈·睡莲。
- 注意：日程页 Figma 还原块使用的 `--color-primary`、`--color-primary-soft` 也会随
  themeVars 覆盖（静态默认值在 app.wxss，仅作兜底）；其余 `--color-*` 中性色不随主题。

## 2. 语义变量（app.wxss 定义默认值，运行时由 themeVars 覆盖）

静态默认值 = 默认主题「莫奈·睡莲」`#7c83c7` 的 `buildPalette` 派生结果：

| 变量 | 默认（莫奈·睡莲） | 用途 |
|---|---|---|
| `--brand-primary` | #7c83c7 | 主按钮、选中态、强调图标 |
| `--brand-bright` | #6659d0 | 高亮（switch 打开态、强调标记） |
| `--brand-deep` | #3843aa | 深主色（渐变末端、浅底上的主色文字、按压态） |
| `--brand-ink` | #242a62 | 深紫标题文字（浅紫底上） |
| `--brand-soft` | #cbceec | 浅主色块（选中底色、标签底、按钮氛围阴影） |
| `--brand-tint` | #e8e9f7 | 极浅底（卡片高亮、pill 背景、水彩光斑） |
| `--brand-tint-2` | #f0f1fa | 更浅底 |
| `--brand-border` | #d5d7eb | 浅紫描边（卡片描边、pill 描边） |
| `--on-brand` | #ffffff | 主色上的文字 |
| `--tab-icon-filter` | 紫蓝滤镜 | tabbar PNG 图标着色 |

## 2.1 莫奈水彩视觉（app.wxss 全局，全部基于上述变量）

- 页面背景 `--page-bg-gradient`：浅色 = 2~3 层 `var(--brand-tint/tint-2)` 径向柔光斑叠
  `tint-2 → #ffffff → tint` 多段线性渐变；深色 = `var(--brand-tint/tint-2)`（暗色 hsla）
  微光斑叠深色多段渐变。换主题时光斑颜色随主色自动变化。
- `.card`：2rpx `var(--brand-border)` 柔和描边 + 双层氛围阴影
  （中性低透明 + `var(--brand-tint)` 主色薄雾），营造「浮在水面」感；深色模式沿用暗阴影。
- `.primary-btn` / `.action-btn`：`135deg var(--brand-primary) → var(--brand-bright)` 渐变
  + `var(--brand-soft)` 氛围阴影，圆角 36rpx。
- `.xipoo-pill`：`var(--brand-tint) → var(--brand-tint-2)` 浅渐变 + 1rpx `var(--brand-border)`。
- `--id-bar-bg/--id-bar-border`：改为主色 tint 渐变 / border，不再硬编码绿色。
- 原则：渐变一律用 `var()` 派生色 + 中性色（白/深底），不新增主色系硬编码 hex。

## 2.2 语义变量映射说明

中性色（不随主题变）：#ffffff / #f4f4f4 / #212121 / #757575 / #999 / #f1f5f9 等保持硬编码。
警示色（不随主题变）：#ef4444、#fef2f2、#9d5a1b。iOS 控件蓝 #007aff 保持。

## 3. 硬编码 → 变量映射表（wxss 改造用）

主色系一律替换（含 rgba 形式，如 rgba(97,182,115,·) → 用对应变量；无对应时用 `color-mix` 不可用，直接取最近变量）：

- #61b673、#4caf50、#07c160 → `var(--brand-primary)`
- #35c76f、#55e0b7、#79f28f、#a7edba → `var(--brand-bright)`
- #247249、#246b43、#286b45、#167a44 → `var(--brand-deep)`
- #183326、#153824、#173624、#173c27、#12301f、#1c3526、#1c3729、#163322 → `var(--brand-ink)`
- #cce8c9 → `var(--brand-soft)`
- #edf7f0、#eef7f1、#e4f6e9、#f0fdf4、#eef5f0 → `var(--brand-tint)`
- #f4f7f5、#f0f6f2、#f0f5f2、#f4f8fe → `var(--brand-tint-2)`
- #dce9df、#e5ece8、#e7efe9、#edf3ef → `var(--brand-border)`

深浅场景判断：深色模式专用的 dark 覆盖块里出现的绿不用动（会由 dark palette 覆盖）。
拿不准语义的绿，按「底→tint/soft、边→border、字→ink/deep、实色块→primary」归类。

## 4. Figma 设计要点（截图提取，对齐时对照）

通用：
- 页面背景近白 #f4f4f4；卡片白底、圆角 24~30rpx、1~2rpx 浅色描边、无重阴影
- 主按钮：绿实底白字、圆角 30rpx、高约 76rpx、字重 700+
- 危险按钮：#ef4444 系实心或描边（删除好友/拒绝）
- 分段控件（日历视图/发现、日/周/月）：选中 = 绿实底白字胶囊；未选 = 透明/白底灰字
- 列表开关：打开 = 绿

日程页：
- 顶部日期卡：绿底（可渐变 deep→primary）圆角 28rpx，白色加粗日期，左右箭头
- 日视图课程卡：白底细边框，时间在上、课程名加粗、地点/老师灰色小字
- 周视图：课程块 pastel 色底（绿/粉/紫/黄）+ 深色文字、圆角约 8rpx；时间轴格线浅灰
- 月视图：选中周整条浅绿底；今天/选中日绿色圆点或圆底
- 右下 FAB：绿色圆形 +

活动页：
- 活动卡：白底圆角绿色细边框；报名 = 绿实心、转发 = 绿描边/次要
- 推荐活动两列网格，封面图区域圆角
- 发现页「选择活动方」浅绿底按钮

好友页：
- 顶部用户卡绿底白字；好友卡白底带 switch；同意 = 绿、拒绝 = 红
- 申请/资料弹层：白底圆角 28rpx，主按钮绿、次按钮灰

我的页：
- 头部背景图 + 圆形头像（白边）；Xipoo ID 胶囊浅绿渐变底
- 设置列表：图标 + 标题 + 副标题 + 箭头/开关；退出登录绿实心按钮
