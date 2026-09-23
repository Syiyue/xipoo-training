# 活动方门面后台字段

活动方门面读取 CloudBase `activity_publishers` 集合。每个活动文档通过 `publisherKey` 归属活动方，门面会自动聚合该活动方的全部活动、活动数、内容类型和参与意向数。

可在后台直接编辑以下字段：

- `key`：稳定唯一标识，与活动的 `publisherKey` 一致。
- `nameZh` / `name`：中英文名称。
- `logoUrl`：方形 Logo，可使用 `cloud://` 文件 ID 或普通图片路径。
- `coverUrl`：门面横幅，建议宽图；为空时自动使用该活动方的一张活动封面。
- `accent`：门面强调色，例如 `#65e882`。
- `verified`：是否显示官方认证。
- `taglineZh` / `tagline`：首屏品牌主张。
- `descriptionZh` / `description`：短简介。
- `locationZh` / `location`：校区或常驻地点。
- `foundedLabelZh` / `foundedLabel`：身份说明，例如“学院官方活动方”。
- `storyTitleZh` / `storyTitle`：品牌故事标题。
- `storyZh` / `story`：品牌故事正文。
- `contentTagsZh` / `contentTags`：常办内容标签数组。
- `galleryUrls`：活动现场图片数组。
- `contactLabelZh` / `contactLabel`：联系按钮文案。
- `contactValue`：邮箱、微信号或后台商务联系人。

页面本身不保存品牌资料，后台修改集合后，下次打开门面即可获得新内容。
