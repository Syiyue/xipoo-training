# Xipoo团队协作规范

## 1. 分支说明

本项目采用三层分支结构：

| 分支 | 作用 | 说明 |
|---|---|---|
| main | 稳定演示分支 | 只放可演示、相对稳定的版本 |
| develop | 团队联调分支 | 所有功能先合并到这里进行联调 |
| feature/* | 个人功能分支 | 每个同学负责自己的模块开发 |

## 2. 当前团队分工

| 同学 | 模块 | 分支建议 | 主要目录 |
|---|---|---|---|
| A | 日程板块 | feature/schedule-v2 | pages/schedule/, cloudfunctions/schedule/ |
| B | 匹配板块 | feature/match-v2 | pages/match/, pages/matchResult/, cloudfunctions/match/ |
| C | 活动板块 | feature/activity-v2 | pages/activities/, pages/activityDetail/, cloudfunctions/activity/ |
| D | 好友板块 | feature/friend-v2 | pages/friends/, pages/friendProfile/, pages/friendSchedule/, cloudfunctions/friend/ |
| E | 我的板块 | feature/profile-v2 | pages/profile/, cloudfunctions/user/ |

## 3. 开发流程

每位同学从develop创建自己的功能分支：

```bash
git checkout develop
git pull origin develop
git checkout -b feature/模块名-v2
```

开发完成后提交：

```bash
git add .
git commit -m "feat(module): describe your change"
git push origin feature/模块名-v2
```

然后在GitHub创建Pull Request：

```txt
base: develop
compare: feature/模块名-v2
```

## 4. 合并规则

1. 不允许直接向main提交代码。
2. 不允许直接向develop提交代码，必须通过Pull Request。
3. 每个PR必须说明：

   * 改了哪些页面
   * 改了哪些API
   * 改了哪些云函数
   * 改了哪些数据库集合
   * 是否影响Mock模式
   * 是否需要上传CloudBase云函数
4. 技术负责人审核Files changed后再合并。
5. develop联调稳定后，再由技术负责人合并到main。

## 5. 公共文件修改规则

以下文件属于公共文件，修改前必须先在团队群说明：

* app.js
* app.json
* utils/api.js
* utils/cloudApi.js
* utils/config.js
* shared/constants.js
* shared/errorCodes.js
* project.config.json
* project.private.config.json

不要用旧branch中的公共文件直接覆盖新版文件。

## 6. CloudBase上传规则

1. 不允许从个人feature分支直接上传公共CloudBase云函数。
2. 联调阶段只允许从develop分支上传云函数。
3. 正式演示前只允许从main分支上传云函数。
4. 上传前必须执行：

```bash
git branch --show-current
git status
```

必须确认当前分支是develop或main，并且working tree clean。

## 7. 页面调用规则

页面层不允许直接调用：

```js
wx.cloud.callFunction(...)
```

页面只能调用：

```js
const api = require('../../utils/api')
```

CloudBase调用统一放在：

```txt
utils/cloudApi.js
```

## 8. Mock保留规则

mockBackend.js必须保留。
CloudBase迁移过程中，应保证Mock模式仍然能运行。

开发阶段可以通过utils/config.js控制模块是否走CloudBase。