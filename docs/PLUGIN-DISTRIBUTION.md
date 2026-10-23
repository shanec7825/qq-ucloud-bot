# 下载和安装 Qlyra 插件

发行页提供五个标准 NapCat ZIP：机器人核心、GitHub、Google Drive、UCloud、群通知整理，以及整套插件 ZIP。插件显示名与机器人昵称无关。独立包当前适用于 **Windows x64**，包含干净后端和 Node 24；其他系统请使用源码部署。

## 推荐安装

安装后进入 NapCat 的“扩展页面”，选择 chat 或对应服务。扩展页提供分类导航、多行提示词、遮挡的密钥输入和保存反馈；原生插件卡片仍可使用。旧版本升级后需要重新加载插件或重启 NapCat，刷新 WebUI 才会出现入口。

多个 QQ 已受支持（最多 20 个）：在“QQ 账号连接”新增每个账号自己的 OneBot 地址、独立端口和 Token，再选默认角色。每个 QQ 必须先在对应 NapCat 实例登录；新增账号配置不会自动登录第二个 QQ。到“会话角色分配”可覆盖默认角色，记忆按账号和人格隔离。

使用同一发行页的 Qlyra Windows 安装包，选择已有项目或准备组件，打开“机器人与插件设置”。已有用户升级后继续使用原配置。

## 已有 NapCat 安装

先安装 `napcat-plugin-qq-agent.zip`，再按需安装其他模块。每个单独 ZIP 根目录直接包含 `package.json` 和 `index.mjs`，可用 NapCat 的本地插件 ZIP 导入；也可解压到 `napcat/plugins/<插件ID>/` 后重启。整套 ZIP 内含五个插件目录，解压至 plugins 目录。

核心会在自己的 `data/workspace/` 建立共享后端，其他模块连接同一个后端。不要单独删除核心。NapCat 升级插件时保留其 data 目录；请在升级前备份核心 data。ZIP 不含开发者项目路径、QQ 账号、聊天记录或授权。

在 NapCat 网络配置中开启 **正向 WebSocket 服务**，地址 `127.0.0.1:3001`、消息格式 array，并设置自己的 Token。在“机器人核心 → QQ 连接与共享教材”填入相同地址和 Token，保存后即连接。不要使用示例或其他人的 Token。

AI 可选择 OpenAI 兼容 API 并填入自己的服务配置。使用 ChatGPT 订阅时，先安装官方 Codex CLI 并确保 `codex` 在 PATH 中，或在共享工作区 `.env` 设置自己的 `CODEX_BIN`；随后从核心配置页登录 ChatGPT。此操作不会继承开发者订阅或云盘授权。Windows 应用的“准备运行组件”可以自动下载并校验 Codex。

部分 NapCat 构建仅允许白名单中的插件，会拒绝尚未收录的第三方 ZIP；本项目发布到 GitHub **不等于已进入官方插件市场**。遇到此限制，请使用配套 Windows 应用的受控安装流程，或等待该构建官方审核收录；不要修改或关闭全局安全检查。这里的 `plugins.json` 是本仓库的下载清单。

## 群场景模板

机器人核心 → 群组 → 每个群的“群场景”，默认 **AI 自动选择**。AI 在同一次回答中按实际问题选择游戏群、年级群或课程群模板，普通闲聊自然回答，无须额外分类请求。也可以固定场景，填写这个群的补充要求，并展开查看格式和示例。

- 游戏群：组队/活动主题、游戏模式、时间人数、参与方式、待确认信息；不替成员承诺报名。
- 年级群：必须处理的事项、适用对象、截止、入口材料、消息依据；合并重复通知，保留冲突来源。
- 课程群：课程/作业、题目要求、截止/考试时间、提交位置、教材依据；不编造提交状态或页码。

模板用于组织语言，不改变访问权限和消息触发：普通群仍须 @，监测群始终禁止发言，重要信息仅保存在后台或发给指定 QQ 私聊。模板不保证模型永远选对，原文依据和日期需要核对。

## 设计参考

参考 [AstrBot 的 persona 按会话解析与提示词分区](https://github.com/AstrBotDevs/AstrBot/blob/master/astrbot/core/astr_main_agent.py)、[LangBot 的会话场景预设与上下文事件](https://docs.langbot.app/en/plugin/dev/apis/pipeline-events.html)，采用“全局身份 + 按群偏好 + 当前问题”的组合；本项目场景文案、格式和实现为独立编写，没有复制它们的源码。

插件包布局参考 [NapCat 官方发布指南](https://doc.napneko.icu/develop/plugin/publish)。独立 ZIP 目前还需要已有 NapCat 提供登录与 OneBot 网络连接。
