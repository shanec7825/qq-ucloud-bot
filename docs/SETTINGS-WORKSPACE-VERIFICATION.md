# 设置页验证记录

本轮完成：五个模块、20 个页面的统一布局，包含短页签、列表与编辑区、只读正文、直接更新待办、条件授权字段、一层更多设置、原生号码选择与工作台入口。

人格编辑只保留名称与系统提示词。旧人格、模型覆盖及账号 / 会话分配仍保留，记忆在独立入口管理。

## 验证

- `node --test`：160 项通过。
- `node scripts/check-extension-ui.mjs`：真实 HeroUI、NapCat iframe、人格增删改、未保存保护、群多选、好友选择、连接失败反馈、教学云正文、手机适配及文本注入防护通过。全部使用隔离数据。
- `node scripts/check-native-napcat-ui.mjs`：原生配置兼容性、人格精简、账号连接、会话分配及独立记忆管理通过。
- 本机部署：五个插件均启用，20 个可见页面及工作台入口已核对；实际提供的资源与测试构建哈希一致，QQ 在线。旧界面保存在 `data/ui-backups/`。未向 QQ 发测试消息。
- 教学云：旧会话续期被学校拒绝，已显示“教学云登录已过期，请重新登录”。真实作业 / 通知正文尚待重新登录验证。

## 接口依据

教学云站内通知使用学校公开前端 [app.d43c9ed612d8b052819d.js](https://ucloud.bupt.edu.cn/uclass/static/js/app.d43c9ed612d8b052819d.js) 中 `getNewsList` 的只读列表调用：`POST /ykt-basics/api/inform/news/list`。读取时不调用已读、删除或提交接口；只返回经过文本化的标题、正文、时间和未读状态。

## 截图

- `data/napcat-persona-simple-desktop.png`
- `data/napcat-persona-simple-mobile.png`
- `data/napcat-extension-native-mobile-dark.png`
- `data/napcat-school-reader-mobile-dark.png`
- `data/settings-overhaul-groups.png`
- `data/settings-overhaul-notices-mobile.png`

截图使用测试数据，不代表学校登录已恢复。

## 界面美化验证（2026-10-22）

- 沿用同版本 HeroUI 与 NapCat 主题、字体；统一标签栏、连续列表面板、固定外置标签和操作栏，移除重复分区标题与分隔。
- `npm run ui:build` 与扩展界面回归通过：20 个页面、深浅主题、320px 窄屏、人格两字段、号码选择、保存保护及减少动态效果。下拉菜单保留即时开合，避免退场期间暂时遮挡焦点。
- 人工核对原生框架浅色、桌面深色、人格窄屏与群消息窄屏截图。
- 已将测试构建同步到五个本机插件，10 个在线 JS / CSS 资源哈希一致，QQ 在线；此次无需重启服务。此前资源备份于 `data/ui-backups/2026-10-21T19-42-55.682Z-visual/`。
- 新截图：`data/napcat-ui-polished-dark.png`、`data/napcat-ui-persona-dark.png`、`data/napcat-ui-persona-mobile-dark.png`；原生浅色截图为 `data/napcat-extension-native-light.png`。均为隔离测试数据。
