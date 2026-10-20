# slyra · 北邮教学云 QQ 机器人

可通过本机网页配置的 QQ AI 机器人：自定义名字和系统提示词、管理群组与记忆，连接 GitHub、Google Drive，并可选查询北京邮电大学 UCloud 最近截止的作业和指定教材目录。通过 NapCat / OneBot 11 登录独立机器人 QQ；默认使用官方 Codex CLI 的 ChatGPT 登录，模型为 `gpt-6-luna`，也保留 OpenAI 兼容 API 接口。

## 网页管理台

```powershell
npm.cmd ci
npm.cmd start
# 在另一个终端打开带本机管理权限的入口。
npm.cmd run admin:open
```

管理台默认在 `http://127.0.0.1:6100`，只监听本机；不必预先创建 `.env`。首次启动会生成管理密钥与 `data/admin-launch.html`，也可以手动打开该文件进入。普通 URL 需要登录，启动链接中的密钥只用于建立 HttpOnly 会话，随后从地址中移除。不要分享启动链接或此 HTML 文件。管理台不是面向公网部署的多用户服务。

| 页面 | 可配置内容 |
| --- | --- |
| 机器人 | 名字、主人 QQ、系统提示词、Codex/API 模型、OneBot 地址与 Token、共享教材目录 |
| 服务连接 | UCloud 学号密码登录与同步间隔、GitHub Token/现有 gh 登录、Google OAuth/现有 rclone 登录、连接测试 |
| 群组 | 读取 QQ 已加入群、添加/移除/备注、允许回复、每群历史归纳授权 |
| 记忆 | 启用/停用、上下文条数和时效、长期记忆增删改、群摘要编辑/清空、最近上下文查看与清空 |

### 直接复用 ChatGPT 插件

GitHub 与 Drive 的“授权方式”都可选 **复用 ChatGPT 插件**。需要当前电脑的官方 Codex CLI 登录同一 ChatGPT 账号，且相应插件已连接；无需复制插件凭据或再填写 GitHub Token、Google OAuth 客户端。

程序通过官方 Codex App Server 的只读 MCP 调用复用连接，只允许 Drive 搜索/文件夹列表/文本读取，以及 GitHub 仓库列表/文件读取，并检查工具的只读标记。桥接本身不创建模型回合；取得的相关内容才交给当前配置的回答模型。回答模型仍关闭工具权限。不会调用插件写入、删除、分享、发信等功能，也不会在插件失败时自动切换到另一账号的旧连接。

本人私聊可以直接说“打开 Google Drive 里的‘课程内容.pdf’”“读取这个 Drive 链接”“读取第二个文件”，或提供 GitHub 文件链接。搜索遇到同名候选会返回列表，让你选定；选择按私聊保留 15 分钟，关闭记忆后不保留。Drive 文件问题不再因出现 PDF 字样误转到本机共享库。PDF 和 Google 文档使用插件返回的可读文本，正文最多提供 24000 字符；扫描件或插件不能解析的文件不能保证读取。

私人插件读取仍仅允许主人私聊。群聊继续使用指定的本机共享教材目录及公开 UCloud 快照。首次插件连接需要初始化，可能等待数十秒；空闲 10 分钟后释放连接，后续自动重新连接。此功能依赖本机 Codex App Server 协议，版本不兼容时会明确报错。

“保存并应用”对新的请求生效，修改 OneBot 设置会重新连接；机器人 QQ 的平台昵称与群名片需在 QQ 中单独修改。停用群或更换主人时，在途回答也会重新检查权限。未 @ 的群消息继续在模型入口前过滤。

配置保存在忽略的 `data/settings.json`，首次从现有 `.env` 迁移，之后网页配置优先；修改 `.env` 不会覆盖已保存的网页设置。首次安装没有绑定账号或群组，可先使用管理台完成配置；UCloud 是可选模块，目前仅支持北邮教学云，关闭后仍可自然聊天。

网页填写的连接密钥保存到 `data/secrets.enc.json`，不通过配置接口回显。Windows 使用当前用户 DPAPI；其他系统使用本机密钥文件和 AES-256-GCM，密钥文件与数据目录都需限制访问。已有 `.env`、gh、rclone 登录可继续沿用；显式清除密钥会阻止回退到旧环境值。学校密码仅用于本次认证，不保存。API 测试会发起一次请求，可能按所配服务计费。

独立连接模式下，GitHub 可使用只授权指定仓库的细粒度 Token（Contents/Metadata 只读）。Google 独立 OAuth 连接需要自己的 Client ID/Secret、启用 Drive API，并按网页显示登记回调地址，默认 `http://127.0.0.1:6100/oauth/google/callback`；使用 `state`、PKCE 与 `drive.readonly` 范围。未验证的自建客户端可能需要把本人加入测试用户。也可沿用已有 gh/rclone 登录，管理台区分“已有配置”和“实际连接测试成功”。独立 Drive 路径支持目录、文本代码及可导出的 Google 文档，单文件最多 32KB；起始文件夹设置仅用于这些独立连接模式。

长期记忆由管理员显式维护，支持全局、指定群、指定私聊；全局内容用于所有会话，私人资料应放在私聊范围。每次最多参考最近 20 条、共 6000 字符。最近对话仅在内存保存，重启或到期后清空；长期记忆和群摘要会持久保存。清空摘要不会重置历史归纳的调用频率限制，原始导出文件仍在本机。

QQ 登录仍需先安装并运行 NapCat，Codex 订阅登录需本机官方 CLI；安装流程见下文。可选 `ADMIN_PORT` 环境变量更换管理端口，需重启生效并同步更新 Google 回调地址。

```text
@slyra 最近什么作业快截止了？
@slyra 教材里怎么解释偏序关系？
@slyra 离散数学教材第20页讲了什么？
@slyra 看看这个表情是什么意思（附图片或表情）
```

群里必须真正 @ 机器人，私聊无需 @；无需记忆斜杠命令。名字由 `BOT_NAME` 控制，语气自然随意，不强制模仿群成员。

## 权限和消息支持

| 使用者 | 可以读取 |
| --- | --- |
| 已允许群中的成员，@ 机器人 | 公开作业快照、指定 pdfs 目录、当前会话附件 |
| 普通 QQ 私聊 | 公开作业、已授权的教材、当前会话附件 |
| OWNER_QQ 本人私聊 | 上述内容，以及单独授权的 Google Drive 和 GitHub 文本文件 |

权限依据 OneBot 的发送者和会话类型判定。即使主人在群里请求，也不会读取私人笔记、其他网盘目录或私人项目。群成员可直接用自然语言询问共享教材和 UCloud 内容。

没有 @ 的群消息在入口被过滤：不下载附件、不更新 AI 上下文、不调用模型。@全体或文字伪造的 CQ @ 不触发。每个群和每个私聊拥有独立上下文，最多 16 条、闲置一小时失效；会话内串行处理，最多排队 8 条。

| 消息类型 | 处理方式 |
| --- | --- |
| QQ 自带表情 face | 使用 QQ 原始名称或 329 项名称映射，例如“对的对的”“doge”；未知编号说明无法识别 |
| 图片、自定义和商城表情包 | 转成 PNG 后交给 Codex 看图；动态图片取首帧 |
| 语音 | 优先 QQ 当前消息转文字，失败时用本机 Whisper tiny |
| 视频 | 前 15 秒内最多 3 帧，音轨最多识别前 180 秒 |
| 引用、合并转发 | 有限层级的文字和附件；引用必须属于当前会话 |
| 文本、代码、PDF、PPT/PPTX | 有界正文；扫描 PDF 附件不做整本 OCR |
| 卡片、位置、音乐等 | 读取消息段已有信息，不保证获得外链全文或音频 |
| 未支持或获取失败的附件 | 明确提示，不假装已经看过或听过 |

每条最多 3 张图片，每张最多 12MB、4000 万像素；其他附件最多 40MB。下载仅允许 QQ HTTPS 媒体域名，包含 `multimedia.nt.qq.com.cn` 和商城表情域名 `gxh.vip.qq.com`，重定向同样检查。文件仅从 QQ 缓存或协议端返回的数据读取，临时附件用后删除。原始语音和视频不发给模型，只发送转写文字和抽帧。tiny 转写和动态表情首帧可能丢失信息。

## 多群使用

支持多个群。让机器人 QQ 加入目标群，在 `.env` 中逗号分隔群号，然后重启：

```dotenv
ALLOWED_GROUPS=100000001,100000002
```

所有允许群仍必须 @，共享同一份公开作业和教材目录，聊天上下文隔离。空列表表示不响应任何群，新入群不会自动开放权限。旧 `NATURAL_GROUPS` 配置不再允许免 @。已有网页配置时，请在管理台设置群组，以下环境变量仅用于首次迁移。

历史归纳另行授权，加入允许列表不等于允许导出历史：

```dotenv
GROUP_HISTORY_MODEL_GROUPS=100000001
HISTORY_DIGEST_ENABLED=true
```

仅同时出现在允许列表和历史授权列表中的群参与自动归纳，不主动向群发送摘要。

## Windows 安装与启动

需要 Node.js 24+、PowerShell、官方 Codex CLI。学校续期凭据通过 Windows 当前用户 DPAPI 加密，目前标准登录和续期面向 Windows。音视频额外需要 Python 3.12。

```powershell
git clone https://github.com/shanec7825/qq-ucloud-bot.git
cd qq-ucloud-bot
npm.cmd ci
Copy-Item .env.example .env
# 替换“你的QQ号”，生成并保留随机 OneBot token。
node scripts/configure.mjs 你的QQ号
npm.cmd run setup:tools
codex login
```

在 `.env` 填入允许群号、教材目录等。`setup:tools` 从 NapCat、GitHub CLI、rclone 官方 GitHub Release 下载 Windows amd64 包，验证 Release SHA256 后解压到 `tools/`，不执行远程安装脚本。

第一次启动 NapCat 生成配置目录，扫码登录另一个 QQ 后退出，再写入本机 OneBot 配置并重启：

```powershell
Push-Location tools\napcat
.\node.exe index.js
# 完成扫码后 Ctrl+C，回到项目目录。
Pop-Location
node --env-file=.env scripts/configure-napcat.mjs
Push-Location tools\napcat
.\node.exe index.js
```

保持 NapCat 运行，另开终端启动机器人：

```powershell
npm.cmd run doctor
npm.cmd test
npm.cmd run ai:check
npm.cmd start
```

OneBot 默认监听 `127.0.0.1:3001`，NapCat 与 `.env` 使用相同的 `ONEBOT_ACCESS_TOKEN`。WebUI token 是另一项配置，辅助脚本将 WebUI 限制为本机监听。当前未安装系统后台服务，需要保持两个进程运行。

### 学校认证与作业

标准登录使用学校 CAS 表单和 UCloud OAuth，不依赖日常 Chrome/Zen 登录状态。密码只从本次标准输入接收，不保存到配置、日志或命令参数。PowerShell 中交互输入后管道提交：

```powershell
$schoolCredential = Get-Credential -Message '请输入北邮学号和学校密码'
try {
  @{ username = $schoolCredential.UserName; password = $schoolCredential.GetNetworkCredential().Password } |
    ConvertTo-Json -Compress | node scripts/login-school.mjs
} finally {
  $schoolCredential = $null
}
npm.cmd run check
```

验证码出现时停止，不自动破解。会话与加密续期凭据保存在 `data/session.json`；临近过期或被拒绝时续期一次，并发复用续期任务。学校撤销授权后需重新登录。`npm run capture` 保留独立浏览器备用流程。

仅提取当前课程中教师布置的标题、课程、截止时间和正文，排除个人提交、成绩、评语及鉴权资源链接。详情仅查询公开快照中的 ID。同步失败保留上次完整快照，显示同步时间；`check` 不发送 QQ 消息。不保证覆盖历史学期。

默认每 15 分钟同步；剩余 24、6、1 小时的截止提醒仅发给主人私聊，不创建待办、不主动发群。QQ 确认后才记录提醒状态，确认或落盘失败可能重复。

### 共享教材

```dotenv
SHARED_PDFS_ROOT=C:/path/to/MyKnowledgeVault/pdfs
SHARED_DOCUMENTS_TO_MODEL=true
```

`true` 表示同意把按问题检索到的教材片段、明确指定的扫描页图片发给模型。目录外个人笔记不加入检索，路径跳转和目录外链接会被拒绝。源文件只读，索引和渲染缓存位于 `data/shared-library/`。

运行 `npm.cmd run library:index` 建立索引，支持 PDF、PPTX 和旧版 PPT。扫描教材支持“明确书名 + PDF 文件页序”的按页看图，没有全书 OCR。`public/books.json` 可另配明确公开的教材链接，默认空列表。

### 模型与私人资源

```dotenv
BOT_NAME=slyra
AI_BACKEND=codex
CODEX_MODEL=gpt-6-luna
```

使用官方 CLI 的 ChatGPT 登录和账号可用额度。默认 Luna，切换时修改 `CODEX_MODEL` 为账号实际可用的模型，例如 `gpt-6.1-sol`，然后重启。不按问题擅自切换，额度不足时不自动改成付费 API。

模型调用关闭命令、插件、连接器、浏览器、记忆和子代理，仅传入程序选择的当前资料与图片，不复用跨用户 Codex 线程。CLI 参数可能随版本变化，用 `npm run ai:check` 验证实际可用性。

可选 `AI_BACKEND=api` 使用 Chat Completions 兼容接口，需要 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。这是独立计费路径，Plus 订阅不是 API Key；当前兼容 API 路径主要处理文本，完整图片验证针对 Codex 后端。

```powershell
npm.cmd run connect:drive
npm.cmd run connect:github
```

主人私聊可说“我的网盘有什么”“读取网盘里的‘课程资料/笔记.txt’”“看看 github 我的项目”。Drive 使用 rclone `drive.readonly`，凭据在 `data/rclone.conf`。GitHub 使用官方 gh 设备授权，凭据在 `data/gh/`；机器人只调用固定 github.com 的 GET API。它们需要单独授权，不继承桌面聊天连接器权限。私人文本进入模型前仍做主人私聊检查。

### 群历史导出与归纳

可选依赖 [QQ Chat Exporter](https://github.com/shuakami/qq-chat-exporter) 的 NapCat 插件和本机服务，默认 `127.0.0.1:40653`，鉴权读取当前 Windows 用户的 QCE 安全配置。先安装并登录插件，再设置历史授权群。

启用后每个授权群最多每 24 小时导出最近 7 天账号可见的记录，放在 `data/history/<群号>/exports`。新增可用人类文字不足 20 条，或没有新增时，不调用模型；达到门槛后每天最多归纳一次，最多 300 条、合计 12000 字符。失败调用也计数，避免当天反复消耗额度。

发送模型前移除发送者身份，并对号码、链接及疑似凭据做文本脱敏；正文仍可能含个人信息。摘要最多 1000 字，各群分开保存，只在被 @ 且问题涉及历史时提供。账号可见历史不一定完整；原始导出仅本机保存，不进入教材检索。

```powershell
npm.cmd run history:tick
# 可选手动导出；脚本名保留旧版兼容，需传已授权群号。
node --env-file=.env scripts/export-dorm.mjs 群号
```

## 验证与存储

`npm test` 覆盖网页鉴权/Host/CSRF、配置到 QQ 的生效路径、密钥不回显、记忆隔离、Google OAuth 状态与续期，以及原有群权限、表情、附件、学校登录和续期。`node scripts/check-admin-ui.mjs` 在隔离的临时配置下验证真实 Chrome 网页交互与移动布局，不调用真实外部账号、模型或 QQ 发信。实际集成已验证管理台沿用的 QQ、UCloud、GitHub 和 Google Drive 连接；新 Google OAuth 客户端授权需用户完成 Google 同意页，自动测试使用协议替身。

既有 Codex Luna 文字与图片、教材索引、扫描页渲染、本机合成音视频识别，以及真实 QQ 图片下载转换已验证。QQ 语音、视频完整真实下载链路仍需现场验证。

`.env`、`data/`、`tools/`、`node_modules/` 和二维码不纳入仓库，其中可能含会话、OAuth 凭据、历史聊天和 QQ 缓存。迁移机器时重新安装和授权。Windows 目录保护使用 ACL。NapCat 是社区 QQ 自动化方案，协议与账号可用性可能变化。

音视频可选安装：用选定 Python 执行 `python -m pip install --target tools/asr -r requirements-media.txt`，再运行 `python scripts/media-worker.py --setup` 下载公开模型，把该解释器绝对路径写入 `MEDIA_PYTHON`。正常聊天不自行安装或下载模型。

## 参考与第三方

- [UCloud 接口参考](https://github.com/YouXam/ucloud/blob/main/src/crawler.ts)、[AstrBot 插件](https://github.com/94yi/astrbot_plugin_ucloud)、[北邮作业客户端](https://github.com/Nemoyuzx/where_to_study)。
- [byrdocs/bupt-auth](https://github.com/byrdocs/bupt-auth)：标准 CAS / UCloud 认证流程参考，本项目独立实现，不使用第三方验证码 OCR。
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：协议适配；表情名称数据来源及许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
- [Codex CLI](https://github.com/openai/codex)、[rclone Drive](https://rclone.org/drive/)、[GitHub CLI](https://cli.github.com/manual/gh_auth_login)。
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/web-server)、[桌面 OAuth 与 PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)、[Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：官方 `app/list`、`mcpServerStatus/list` 和 `mcpServer/tool/call` 协议；本项目已真实验证复用连接读取 Drive 文件正文和 GitHub README。
