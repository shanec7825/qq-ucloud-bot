# NapCat 扩展设置页

入口：NapCat → 扩展页面。机器人、GitHub、云盘、教学云和群消息使用 NapCat 自带的页签。原生插件卡片配置仍可使用。

扩展内容使用与 NapCat 官方前端依赖清单一致版本的 React 19、HeroUI Input / Textarea、Select、Switch、Button 和 Spinner。没有额外品牌栏、侧栏、顶层工具条或固定保存条。桌面包装器也移除了额外顶栏和 NapCat 页面下方的状态条，运行管理入口放在托盘菜单中。设置分类使用原生样式的分组下拉框，保存按钮放在表单末尾；清晰的中文命名保留。

扩展页只读取外层 NapCat 的 HeroUI 主题变量、深浅模式与字体，跟随外层变化，不修改外层 DOM 或前端文件。扩展页在 NapCat 的标准 iframe 中运行，内部下拉框不锁定页面滚动，避免 iframe 中的菜单定位跳动。

使用官方 `ctx.router.page` / `ctx.router.static` 注册页面和资源。请求仍走鉴权接口 `/api/Plugin/ext/<id>/settings-ui`，复用原生配置适配器的冲突检测、记忆范围和删除确认。密钥留空保留，不读取已保存的密钥原文。

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
