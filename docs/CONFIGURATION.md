# QQ Agent 配置手册

**Last Updated:** 2026-10-21 · 2.0.0 本地候选版

## 启动与保存

```powershell
npm.cmd ci
npm.cmd run napcat:install -- --trust-local-plugin
npm.cmd run admin:open
```

运行 NapCat 并登录机器人 QQ。常用入口为 **NapCat → 扩展页面**，默认 `http://127.0.0.1:6099/webui/extension`。插件卡片的原生配置也保留，可点击其中的“打开工作台”。机器人、GitHub、Google Drive、教学云、群消息共用本机后端与一份设置。切换页面前先保存；内部 6100 服务承担本机 API 与 OAuth 回调。

安装脚本的 `--trust-local-plugin` 为本项目固定插件 ID 添加本机信任例外，安装前备份相关文件。NapCat 更新后可能需要重新安装；不要删除 `data/` 或 `tools/`。关闭配置窗口不会停止共享后端，停用模块会停止对应能力。

## 核心、账号与人格

核心页配置昵称、主人 QQ、模型、ChatGPT 登录、共享教材和允许的群。群聊必须真正 @ 机器人，私聊无需 @。通知监测群禁止出站回复。主人 QQ 用于私人资料及工具授权，普通聊天不要求配置主人。

「人格」只编辑名称和系统提示词；「QQ 账号」保存每个 OneBot 连接及默认人格；「分配」选择账号、群或好友以及人格。每个账号需要独立运行并登录的 NapCat 实例。详细优先级和记忆隔离见 [账号与人格](ACCOUNT-PERSONAS.md)。

默认使用本机官方 Codex 的 ChatGPT 登录和订阅可用模型，也可选择 OpenAI 兼容 API、MiMo 按量 API、MiMo Token Plan 中国集群或 DeepSeek。API 单独配置和计费；订阅失败不会自动改用 API。私人检索正文会交给所选回答模型，ChatGPT 插件凭据不会交给第三方模型。

选择 MiMo 后，默认模型为 `mimo-v2.6-pro`；可按账号可用模型调整。按量 API 使用 `sk-` Key，Token Plan 中国集群使用 `tp-`/`ttp-` Key。回答模型与 TTS 共用保存的 MiMo Key；Token Plan 模式会连接 `https://token-plan-cn.xiaomimimo.com/v1`。

## 私人资料与工具代理

GitHub / Drive 仅允许主人私聊访问。连接方式和可用工具取决于实际授权，连接测试成功不等于已验证写入。

| 服务 | 独立连接 | ChatGPT 插件 |
| --- | --- | --- |
| GitHub | Token 或已有 gh 登录；REST 读取仓库、文件、提交、Issue、PR 等；可选确认后的写入 | 动态发现可用工具，仅开放只读元数据与检索能力 |
| Drive | OAuth 或已有 rclone 读取；独立 OAuth 读写需要明确授予读写权限 | 动态发现只读搜索、列表、文本等工具；文档/PDF 依赖插件返回可读文本 |

Drive 独立文本读取最多 32KB，配置根文件夹限制独立连接的访问范围。OAuth 回调默认 `http://127.0.0.1:6100/oauth/google/callback`；客户端需启用 Drive API，并登记界面所示回调。只读授权不能因开启工具代理而自动升级为写权限，应重新明确授权读写。

工具代理默认关闭，写入另有默认关闭的开关。仅主人私聊可以调用；默认最多 4 步，可设 1–8。写入先展示工具、目标和完整具体内容，过长而无法完整展示时拒绝。主人在同一会话回复一次性确认码，5 分钟内有效；账号、人格、配置和授权变化会使确认失效。不要把群里转发的确认码当作授权。

GitHub 支持确认后的文件更新、Issue / PR 创建与更新。Drive OAuth 支持确认后的文本创建/更新、移动与移入回收站，并检查根目录。ChatGPT 插件保持只读。详细能力见 [2.0.0 说明](releases/v2.0.0.md)。

## UCloud 与消息

UCloud 是可选北邮模块，登录学校后查询近期作业。个人文字提交适配当前公开 JS，限 2000 字符；先预览，主人 QQ 私聊确认后只发一次提交请求，并回读核对。附件、小组作业及已有附件的修改请在教学云完成。结果不确定时先到教学云检查，不自动重试。

普通聊天支持图片、表情和嵌套转发：转发深度最多 4、40 个节点、10 次补取 API；最多 3 张图片，GIF 使用首帧。表情包通过 `/表情包` 列表与 ID 使用，会话间隔离。QQ 输出为纯文本并保留代码内容。历史批量通知仅分析文字。

## 通知、数据与升级

实时提醒选择账号，默认 10 秒合并在线文字，不依赖 QCE；定时历史整理使用默认账号的 QCE 历史并持久保存报告。两个开关独立，实时模式不补抓离线消息。详见 [通知说明](GROUP-NOTICES.md)。

配置在 `data/settings.json`，首次从环境初始化后以保存设置为准。v2 升级 v3 前保留 `data/settings.v2.backup.json`。授权密钥在加密凭据文件，Windows 使用当前用户 DPAPI；换电脑或 Windows 用户需重新授权。不要上传 `.env`、`data/` 和 `tools/`。故障先检查 `data/napcat-engine.log`，公开日志前移除认证信息。

本地测试和隔离界面检查不代表真实 QQ 或外部写入验证。公开下载安装见 [README](../README.md)，本地候选包与公开版本分开。

## DeepSeek

“模型”中可选择 **DeepSeek API** 或 **DeepSeek Harness**，各自保留模型名称，API Key 与自定义 API 分开加密保存。Harness 支持 API Key 和本机官方桌面端已有账号两种授权方式。组件准备、授权范围及验证状态见 [DeepSeek 接入](DEEPSEEK.md)。
