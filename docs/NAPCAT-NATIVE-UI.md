# NapCat 原生界面验证

QQ Agent 的五个插件均使用 NapCat 自带插件卡片和配置弹窗。控件、下拉框、开关、保存按钮、手机布局与深浅主题由原版 NapCat 前端提供。没有自定义 iframe，也没有修改前端资源。

运行 `npm run test:ui`。需要已安装的 `tools/napcat/napcat/static` 原版资源和 Playwright 可启动的 Edge（可用 `CAPTURE_BROWSER` 指定其他浏览器）。

验证脚本建立随机端口的本机临时服务，原样读取安装目录中的静态资源。插件列表、配置接口、实时配置流和平台状态接口由隔离测试替身提供；配置数据仅在内存中保存，不读取真实用户配置，不连接运行中的 NapCat，不调用模型，不发 QQ 消息。所有外部页面请求被拦截。

覆盖五个插件原生配置弹窗、原生保存、群组绑定方案、通知开关、不同记忆之间切换、恶意记忆及原始通知文本的安全预览，以及 390 像素手机深色布局。任何必需控件缺失、保存失败或脚本异常都会使验证失败。

截图位于 `data/napcat-native-core.png`、`data/napcat-native-groups.png`、`data/napcat-native-memory.png`、`data/napcat-native-notices.png`、`data/napcat-native-source.png`、`data/napcat-native-mobile-dark.png`。这些是原版前端与测试替身的组合证据，不能证明真实 QQ、模型或外部授权已经连通。

旧的 `scripts/check-napcat-ui.mjs` 已转为相同隔离验证入口，不再登录实际本机 NapCat 或保存用户配置。
