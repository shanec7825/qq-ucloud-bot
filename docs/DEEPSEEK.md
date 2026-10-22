# DeepSeek 接入

在 **插件管理 → 机器人 → 配置 → 模型**，或 **扩展页面 → 机器人 → 模型**，选择模型来源，填写设置后保存。可选 ChatGPT、自定义 API、DeepSeek API、DeepSeek Harness；切换来源会保留各自的模型设置。

## DeepSeek API

选择 **DeepSeek API**，填写 **DeepSeek API Key**，模型默认 `deepseek-flash`，保存后执行“测试模型”。地址固定使用官方 `https://api.deepseek.com/chat/completions`。需要代理服务或其他兼容地址时，使用原来的自定义 API 入口。

“深度思考”默认关闭，可用于需要推理的问题；开启可能增加等待时间。文字、已准备的图片和教材页沿用相同的内容与路径校验，是否支持图片还取决于所选模型。API Key 与自定义 API 的密钥分开加密保存，输入框留空保留已有值。

## DeepSeek Harness

开发工作区首次使用执行 `npm run setup:deepseek`，安装到项目的 `tools/deepseek-harness/`，不会更新全局 dsh。脚本固定使用已验证的官方 `@deepseek-ai/dsh@0.2.1-rc.2`；需要 Node.js 24+ 和 npm。桌面发行包不预装这个可选运行时，缺少 npm 时需先安装含 npm 的 Node.js。

选择 **DeepSeek Harness**，填写 Harness 中可用的模型名称，然后选择授权方式：

- **使用 API Key**：使用上面的 DeepSeek API Key。
- **Harness 已有账号登录**：先在本机官方 DeepSeek Harness 桌面端登录。此选项明确授权机器人复用当前 Windows 用户的 Harness 登录。账号余额/额度与 ChatGPT 订阅、API Key 授权分开，以 DeepSeek 实际响应为准。

账号模式仅读取 Harness 的账号及设备登录记录到一次性运行目录，不导入全局插件、配置补丁、API Key、聊天历史或其他会话，不修改原 Harness 登录。默认读取 `~/.dsh/.credentials.yaml`；自定义安装可通过 `DEEPSEEK_HARNESS_HOME` 指定登录所在目录。不要通过 QQ 或聊天发送凭据文件。

宿主使用官方 SDK 标准输入输出协议，不把问题放进命令行参数。每次调用使用新的会话和临时工作目录，禁用文件、终端及工作目录工具，并检查实际请求的工具列表为空。成功必须有本会话的最终答案和成功终态；空闲通知、部分文字或失败终态不算成功。子进程退出后清理临时会话；清理失败会在本机后台日志留下提示。

## 环境变量

首次初始化可使用以下变量；已有工作区以 `data/settings.json` 为准，请优先在设置页修改。

```dotenv
AI_BACKEND=deepseek
DEEPSEEK_API_KEY=自行设置，勿公开
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_THINKING=false
DEEPSEEK_HARNESS_MODEL=deepseek-flash
DEEPSEEK_HARNESS_AUTH=api-key
```

`AI_BACKEND=deepseek-harness` 选择 Harness；`DEEPSEEK_HARNESS_AUTH=account` 选择已有登录。可选 `DEEPSEEK_HARNESS_BIN` 必须是官方 dsh `lib/bin.js` 的绝对路径，不能填写 shell 命令或 `.cmd/.ps1` 启动脚本。

## 验证范围

本次验证包含配置迁移、独立密钥路由、各后端的角色模型覆盖、请求与错误处理、浏览器桌面/窄屏表单，以及真实 Harness 运行时对本机假服务的 API Key 和虚构账号两种完整协议测试。后者均确认工具数量为零，不证明外部模型生成可用。

经用户明确授权，本机已有 Harness 账号的真实请求已到达官方服务，但返回 `ACCOUNT_QUOTA`（账号额度不足），没有生成答案；界面会显示对应原因。尚未配置独立 DeepSeek API Key，因此直接 API 的真实模型调用尚未验证。没有向 QQ 联系人或群发送测试消息。

接口依据：[DeepSeek API 官方文档](https://api-docs.deepseek.com/)、[Harness 官方仓库及 SDK 入口](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk)。
