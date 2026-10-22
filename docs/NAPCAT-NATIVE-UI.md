# NapCat 原生界面验证

**Last Updated:** 2026-10-21 · 2.0.0 本地候选版

QQ Agent 的五个插件均使用 NapCat 自带插件卡片和配置弹窗。控件、下拉框、开关、保存按钮、手机布局与深浅主题由原版 NapCat 前端提供。原生配置弹窗由 NapCat 直接渲染。扩展页面另外使用相同版本 HeroUI 组件，放入 NapCat 官方 iframe 容器；详情见 EXTENSION-UI.md。两种入口都不修改 NapCat 前端资源。

当前原生配置采用短标签、条件字段和一层“更多设置”。“号码来源 → 从 QQ 选择”可读取当前账号的群和好友；“打开工作台”链接由原版支持的 HTML 字段呈现，只含固定本机路径。重复的初始化事件不会触发表单重绘；去掉重复描述，避免底部下拉框被弹窗滚动收起。

运行 `npm run test:ui`。需要已安装的 `tools/napcat/napcat/static` 原版资源和 Playwright 可启动的 Edge（可用 `CAPTURE_BROWSER` 指定其他浏览器）。

验证脚本建立随机端口的本机临时服务，原样读取安装目录中的静态资源。插件列表、配置接口、实时配置流和平台状态接口由隔离测试替身提供；配置数据仅在内存中保存，不读取真实用户配置，不连接运行中的 NapCat，不调用模型，不发 QQ 消息。所有外部页面请求被拦截。

覆盖五个插件原生配置弹窗、原生保存、群组绑定人格、人格池保存、独立账号与连接密钥保存、群聊/私聊人格绑定、实时通知开关（不误启用定时历史整理）、不同记忆之间切换、恶意记忆及原始通知文本的安全预览，以及 390 像素手机深色布局。任何必需控件缺失、保存失败或脚本异常都会使验证失败。

截图位于 `data/napcat-native-core.png`、`data/napcat-native-groups.png`、`data/napcat-native-persona.png`、`data/napcat-native-account.png`、`data/napcat-native-binding.png`、`data/napcat-native-memory.png`、`data/napcat-native-notices.png`、`data/napcat-native-source.png`、`data/napcat-native-mobile-dark-core.png`、`data/napcat-native-mobile-dark-notices.png`、`data/napcat-native-mobile-dark-github.png`、`data/napcat-native-mobile-dark-drive.png`、`data/napcat-native-mobile-dark-ucloud.png`。这些是原版前端与测试替身的组合证据，不能证明真实 QQ、模型或外部授权已经连通。

旧的 `scripts/check-napcat-ui.mjs` 已转为相同隔离验证入口，不再登录实际本机 NapCat 或保存用户配置。
