# slyra · 北邮教学云 QQ 机器人

用自然语言查询北京邮电大学 UCloud 最近截止的作业、阅读指定教材目录，并在 QQ 中聊天。通过 NapCat / OneBot 11 登录独立机器人 QQ；默认使用官方 Codex CLI 的 ChatGPT 登录，模型为 `gpt-6-luna`，也保留 OpenAI 兼容 API 接口。

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

所有允许群仍必须 @，共享同一份公开作业和教材目录，聊天上下文隔离。空列表表示不响应任何群，新入群不会自动开放权限。旧 `NATURAL_GROUPS` 配置不再允许免 @。

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

`npm test` 当前 37 项通过，覆盖权限、必须 @、多群隔离、表情名称、媒体范围、引用隔离、历史调用频率、学校认证和并发续期等行为。实际集成曾验证学校登录与续期、Codex Luna 文字与图片、教材索引、扫描页渲染，以及本机合成音视频识别。已验证真实群图片从新 QQ 域名下载并转成模型用 PNG；QQ 语音、视频的完整真实下载链路仍需现场验证。

`.env`、`data/`、`tools/`、`node_modules/` 和二维码不纳入仓库，其中可能含会话、OAuth 凭据、历史聊天和 QQ 缓存。迁移机器时重新安装和授权。Windows 目录保护使用 ACL。NapCat 是社区 QQ 自动化方案，协议与账号可用性可能变化。

音视频可选安装：用选定 Python 执行 `python -m pip install --target tools/asr -r requirements-media.txt`，再运行 `python scripts/media-worker.py --setup` 下载公开模型，把该解释器绝对路径写入 `MEDIA_PYTHON`。正常聊天不自行安装或下载模型。

## 参考与第三方

- [UCloud 接口参考](https://github.com/YouXam/ucloud/blob/main/src/crawler.ts)、[AstrBot 插件](https://github.com/94yi/astrbot_plugin_ucloud)、[北邮作业客户端](https://github.com/Nemoyuzx/where_to_study)。
- [byrdocs/bupt-auth](https://github.com/byrdocs/bupt-auth)：标准 CAS / UCloud 认证流程参考，本项目独立实现，不使用第三方验证码 OCR。
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：协议适配；表情名称数据来源及许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。
- [Codex CLI](https://github.com/openai/codex)、[rclone Drive](https://rclone.org/drive/)、[GitHub CLI](https://cli.github.com/manual/gh_auth_login)。
