# QQ Agent for Windows

一个有固定桌面入口的 QQ AI 机器人。登录 QQ、切换账号、设置模型和插件，都可以在 Windows 应用里完成；关闭窗口后可从托盘、桌面或开始菜单回来。

支持自定义机器人昵称和提示词、群内 @ 对话、图片与表情理解、共享教材查询、北邮 UCloud 作业、GitHub / Google Drive 只读连接，以及通知群历史整理和重要事项私聊汇报。

## 下载与安装

从 [GitHub Releases](https://github.com/shanec7825/qq-ucloud-bot/releases/latest) 下载 Windows x64 发行包：

- **推荐安装包**：`QQ-Agent-Setup-1.1.0-x64.exe`，安装后创建桌面和开始菜单入口。
- **便携版**：`QQ-Agent-1.1.0-win-x64.zip`，完整解压后运行 `QQ-Agent/QQAgent.exe`；不要只复制 exe。
- **校验文件**：`SHA256SUMS.txt`。

需要 Windows 10/11 x64、.NET Framework 4.8 和 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。安装包内含 Node 24 LTS、WebView2 SDK 运行库与干净的机器人后端，不含 QQ 登录缓存、账号、密码、学校会话、云盘凭据或个人配置。当前发行版未做发布者代码签名。

## 单独下载 NapCat 插件

已有 NapCat 的用户可下载 [整套插件 ZIP](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/QQ-Agent-Plugins-1.1.0-win-x64.zip)，也可按需下载：

| 插件 | 下载 |
| --- | --- |
| 机器人核心（先安装） | [napcat-plugin-qq-agent.zip](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/napcat-plugin-qq-agent.zip) |
| GitHub | [napcat-plugin-agent-github.zip](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/napcat-plugin-agent-github.zip) |
| Google Drive | [napcat-plugin-agent-drive.zip](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/napcat-plugin-agent-drive.zip) |
| UCloud | [napcat-plugin-agent-ucloud.zip](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/napcat-plugin-agent-ucloud.zip) |
| 群通知整理 | [napcat-plugin-agent-notices.zip](https://github.com/shanec7825/qq-ucloud-bot/releases/download/v1.1.0/napcat-plugin-agent-notices.zip) |

独立包适用于 Windows x64，核心内含 Node 与后端，其他模块共用同一后端。安装、连接配置、升级和 NapCat 白名单限制见 [插件安装说明](docs/PLUGIN-DISTRIBUTION.md)。GitHub 下载不表示已经收录官方市场。

## 群场景与输出模板

在机器人核心的“群组”页，每群默认“AI 自动选择”。同一次回答中按当前话题选用游戏群、年级群或课程群格式；普通闲聊保持自然表达，不额外发起模板分类请求。可以固定场景、查看格式示例，并添加这个群的补充要求。模板不改变群内 @ 回复和通知群禁言规则。

桌面导航只保留一条侧边栏；进入 NapCat 后使用其自己的导航，顶部“工作台”可返回。

## 第一次使用

1. 打开 **QQ Agent**。
2. 有现成项目时，点“选择已有项目”；配置、模型和授权继续使用原目录。需要先将项目更新到含桌面支持的版本。
3. 全新使用时，点“准备运行组件”。应用从官方 GitHub 发行页下载并校验 NapCat 和需要的 Codex 组件，下载可能需要几分钟。
4. 点“启动机器人”，再点 **“QQ 登录”**。扫码、验证码或设备验证由本人完成。
5. 点“机器人与插件设置”，从对应插件卡片进入配置。普通聊天不要求填写主人 QQ。

QQ 登录属于 NapCat 的 QQ 账号登录；管理网页的 Web Login 是另一层本机管理认证。桌面版会使用本机已有管理会话进入页面，不把管理密钥放进网址。

## 为什么退出后还能找到登录入口

- **关闭主窗口**：收起到 Windows 托盘，双击托盘图标可回来。
- **托盘 → QQ 登录**：直接打开登录入口。
- **桌面／开始菜单 → QQ Agent**：重新打开应用；已经运行时会唤回原窗口。
- **退出桌面程序**：后台默认继续运行，托盘菜单明确标明此行为。
- **停止机器人**：左侧“停止机器人”停止 AI 后台，QQ 登录组件可以继续保留。
- **换另一个 QQ**：使用“切换 QQ 账号”，确认后暂停当前连接并重新打开登录入口。模型、提示词、群规则、记忆和其他服务授权不会清空。新账号需重新确认已加入的群和报告接收人。

即使桌面程序无法打开，网页恢复入口仍是 `http://127.0.0.1:6099/webui/`；未登录 QQ 时，登录页为 `/webui/qq_login`。已经登录时，NapCat 会自动显示当前账号信息。

## 按需启用的插件

| 插件 | 功能 |
| --- | --- |
| QQ Agent · 机器人核心 | 昵称、提示词、模型、ChatGPT 登录、群组与记忆、共享教材 |
| GitHub | ChatGPT 已授权连接器、独立 Token 或本机 gh 登录 |
| Google Drive | ChatGPT 已授权连接器、Google OAuth 或本机 rclone 登录 |
| UCloud · 北邮教学云 | 学校登录、近期截止作业与私聊提醒 |
| 群通知整理 | 历史文字整理、重要事项报告、只读群禁言与独立私聊接收人 |

配置直接位于 NapCat **插件管理 → 配置齿轮**，没有重复的扩展页面。页面内“保存并应用”立即生效。启动桌面版不会重新启用你明确停用的现有模块。

默认通过官方 Codex 的 ChatGPT 登录使用订阅可用模型，默认 `gpt-6-luna`；也可配置 OpenAI 兼容 API。API 单独计费，不会在订阅失败时自动切换。其他兼容模型可使用本程序检索到的资料正文，ChatGPT 的登录凭据不会交给其他模型；正文会发送给你所选的模型服务。

## 通知群与消息范围

通知整理默认关闭；选择目标群并保存后才会读取历史。监测列表中的群禁止机器人发言，包括 @ 回复。可以私聊问“最近有什么”“历史记录有什么”，也可把新发现的重要事项主动发给指定 QQ；报告包含原文依据。

批量整理针对 QQ 实际可读取的历史文字，受时间范围与条数限制；不保证读取新账号看不到的旧历史，也不批量解析历史图片、语音和附件正文。普通聊天仍只在群里被明确 @ 时回复。

## 数据与升级

默认独立工作区为 `%LOCALAPPDATA%\QQAgent\workspace`；已有项目继续使用所选目录。机器人配置、授权与报告在工作区 `data/`，登录组件在 `tools/`。卸载桌面程序不删除工作区。切换 Windows 用户或电脑时，DPAPI 加密授权需要重新设置。

更新安装包会更新应用文件；不要把旧工作区的 `.env`、`data/` 或 `tools/` 上传到 GitHub，也不要在升级时删除它们。已有源码项目可继续按原方式运行 `npm start`，桌面版优先复用本机正在运行的服务。

## 开发与构建

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run desktop:prepare
npm.cmd run desktop:build
```

构建需 Windows x64，使用 Windows 自带 C# 编译器。准备脚本从微软 NuGet、Node 和 Inno Setup 官方源获取已锁定组件并校验 SHA512/SHA256。输出位于 `release/1.1.0/`，包括安装包、便携包和校验清单；产物不会混入 Git 源码。

详细设置、学校登录和原有命令行部署见 [配置手册](docs/CONFIGURATION.md)。第三方组件与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
