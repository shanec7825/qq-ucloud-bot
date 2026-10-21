# 插件扩展设置页

入口：NapCat → 扩展页面 → QQ Agent · 账号与人格；GitHub、Google Drive、UCloud、群消息与提醒各有自己的页面。旧版升级后重新加载插件并刷新页面。

使用官方 `ctx.router.page` 注册页面、`ctx.router.static` 提供资源。配置请求走 NapCat 鉴权接口 `/api/Plugin/ext/<id>/settings-ui`，复用原生配置适配器的版本冲突、记忆范围与删除确认规则。原生配置弹窗保留。页面不会读取或返回已保存密钥；空密钥输入保留原值。

设计采用分栏工作台：左侧分类，右侧记录选择与编辑区域，底部保存。颜色使用蓝色重点、低饱和背景与清晰边界，中文采用系统雅黑字体；没有外部字体或运行时依赖。长提示词使用可调整高度的多行输入，手机改为换行导航，支持系统深浅主题、键盘焦点与未保存切换提醒。

运行 `npm run test:extension-ui`。隔离 Edge 验证覆盖五个模块载入、人格创建、第二账号及独立 Token 保存、私聊人格绑定、未保存切换取消、恶意记忆文本安全显示、390px 深色布局与跨来源拦截。截图为 `data/extension-accounts.png`、`data/extension-mobile-dark.png`。测试只用内存数据，未登录第二个真实 QQ，未调用外部模型。

官方 API 说明：https://doc.napneko.icu/develop/plugin/start-webui
