# NapCat 扩展设置页

入口：NapCat → 扩展页面。机器人、GitHub、云盘、教学云和群消息使用 NapCat 自带的页签。原生插件卡片配置仍可使用。

人格页采用角色列表和编辑区，只需填写名称、系统提示词。角色分配、长期记忆各有独立入口。连接使用滑动开关和直接检测按钮；QQ / 群可搜索选择，仍支持手填。教学云页可直接阅读待交作业、站内通知和作业详情，通知翻页读取，不自动标记已读。

扩展内容使用与 NapCat 官方前端一致版本的 React 19、HeroUI Input / Textarea、Select、Switch、Button 和 Spinner。20 个页面使用短页签直接导航。群聊、账号、分配和记忆采用可搜索列表与编辑区；对话、待办、整理记录采用列表与正文。待办状态直接点击更新，阅读页不显示无用的保存按钮。常用字段分区，技术参数放在一层“更多设置”中。默认 QQ 的连接统一在账号页管理，避免重复入口。

ChatGPT / API 与各授权方式只显示当前需要的字段。切换连接方式保留未保存输入，未显示的已有设置继续保留。原生配置同步使用短标签、条件字段及“更多设置”，可从 QQ 列表选择号码；卡片内的“打开工作台”提供直接操作入口。重复的控件初始化事件不会再次刷新表单，避免选择框意外收起。

扩展页只读取外层 NapCat 的 HeroUI 主题变量、深浅模式与字体，跟随外层变化，不修改外层 DOM 或前端文件。扩展页在 NapCat 的标准 iframe 中运行，内部下拉框不锁定页面滚动，避免 iframe 中的菜单定位跳动。

视觉沿用 NapCat 的 HeroUI 组件与主题：轻量标签栏、连续的列表与编辑面板、固定外置标签、统一操作栏。选中项使用低饱和主题色；搜索、新建、刷新和删除采用同一线宽图标。窄屏上下排列，深色自动跟随；状态过渡为 140–160ms，并尊重系统减少动态效果设置。下拉菜单保留即时开合，避免 iframe 内退场时焦点被短暂遮挡。人格编辑仍只有名称和系统提示词。

使用官方 `ctx.router.page` / `ctx.router.static` 注册页面和资源。通用表单走鉴权接口 `/api/Plugin/ext/<id>/settings-ui`；人格编辑、联系人和教学云阅读经 `/bridge` 访问固定白名单接口。所有设置更新均校验版本；密钥留空保留，不回显原文。

## 构建

首次执行 `npm ci --prefix ui/napcat`，再执行 `npm run ui:build`。可维护源代码在 `ui/napcat/src/`，输出为 `napcat-plugin/webui/app.js`、`style.css` 和 `THIRD-PARTY.txt`。运行时不需要 npm、CDN 或额外网络请求。前端依赖与后端依赖分别安装，不把开发依赖放进插件包。

## 验证

运行 `npm run test:extension-ui`。脚本原样提供本机安装的 NapCat 前端，在真实的扩展页 iframe 中加载插件内容，验证组件交互、五个模块、角色创建、多 QQ 独立密钥、私聊角色分配、群聊回复保存、未保存保护、恶意文本安全显示、主题变量继承与手机深色布局。外部网络请求全部拦截，配置仅保存在内存，不连接真实 QQ 或模型。

截图：`data/napcat-extension-native-light.png`、`data/napcat-extension-native-mobile-dark.png`、`data/extension-native-controls.png`。

## 依据

- [NapCat 官方前端依赖](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-webui-frontend/package.json)
- [NapCat 原生扩展页](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-webui-frontend/src/pages/dashboard/extension.tsx)
- [NapCat 扩展页注册 API](https://doc.napneko.icu/develop/plugin/start-webui)
- [设置文案调研](SETTINGS-COPY-RESEARCH.md)
