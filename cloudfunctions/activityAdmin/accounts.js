/**
 * 宣传部后台账号表。
 *
 * 每个账号绑定一个默认发布方 publisherKey（新建活动时表单会默认选中，可改）。
 * publisherKey 必须是 activity_publishers 集合中存在的 key。
 *
 * role 字段：
 *   - super_admin: 最高权限，可管理所有活动方、调度配额、操作日志
 *   - publisher_admin: 可管理自己 publisherKeys 关联的活动方
 *   - viewer: 仅查看，不可编辑
 *
 * 密码只保存为 SHA-256 摘要；不要把明文密码提交到代码仓库。
 *
 * 修改后需重新部署 activityAdmin 云函数才能生效。
 */
module.exports = [
  {
    username: 'xipoo',
    passwordHash: 'b55893a950d015c9f35579b0b80e1a27380cf7f663830524b79c4eedf692b1ae',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],  // super_admin 为空表示全部
    displayName: '总管理员'
  },
  {
    username: 'chips',
    passwordHash: '63b17116ceb01d7b86636db160d0220254112433b27bcb9a0b9d9f461fc2d52c',
    role: 'publisher_admin',
    publisherKey: 'chips',
    publisherKeys: ['chips'],
    displayName: '芯片学院宣传'
  },
  {
    username: 'viewer',
    passwordHash: '35cbe0aaf4e558ac53847cf7b057f4a3a86a427e08935bffdf81d7b4ed7cd9f3',
    role: 'viewer',
    publisherKey: '',
    publisherKeys: [],
    displayName: '只读查看员'
  },
  {
    username: 'wangyahan',
    passwordHash: 'd455cdff9d2ccda8304b654e1575460249e866c8438060c889b1fb2f61107275',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '王雅涵'
  },
  {
    username: 'sunsihan',
    passwordHash: '01a13f62b2cdc0224bf671f2760c5eb916a2c1de1226953d532e7312623b1761',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '孙思涵'
  },
  {
    username: 'shizhuozheng',
    passwordHash: '1fe0fee580c16203bea88f77e7ac355aa357e24d1c1b4eda038daebb11e97ab0',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '施焯政'
  },
  {
    username: 'lizixi',
    passwordHash: 'abc83ac5f1ef78926bddee721263c6e021a06e2403c695099b8e9909a6447b5d',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '李子溪'
  },
  {
    username: 'wupeiyang',
    passwordHash: 'a2a0e98f2718a311da6801452d6576b0dbae3c1fe0fbd78da629bbab61473186',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '吴沛阳'
  },
  {
    username: 'wenxiuling',
    passwordHash: 'd9986b16367a17a8f3f1c11620f459db5ff508d388c25b295a24a68acb88ead4',
    role: 'super_admin',
    publisherKey: 'chips',
    publisherKeys: [],
    displayName: '文秀玲'
  },
  {
    username: 'xinpian',
    passwordHash: '7291c9d7de68c1a876259f87528162a83bcf7d04fe9be970c6192241d6af8411',
    role: 'publisher_admin',
    publisherKey: 'chips',
    publisherKeys: ['chips'],
    displayName: '芯片学院管理员'
  }
]
