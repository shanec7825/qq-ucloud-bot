# QQ 回复协议泄漏修复

2026-10-23。针对聊天截图中的 JSON 原文、mediaIds、generateSpeech 标签、语音指导被拆成多个气泡的问题。

## 原因与处理

原回复解析在 JSON.parse 失败后沿用模型原文。Markdown 围栏、重复编码、缺少结尾容器等格式偏差都会落入纯文字分支；随后的口语拆句会继续拆分这些内部字段。XML 语音调用也没有进入语音合成链路。

- 新增 `src/reply-protocol.mjs`，在媒体解析和聊天拆句前解码完整 JSON、围栏 JSON、最多两层 JSON 编码。仅在所有字符串均已闭合时补齐最多三个结尾容器；不补写截断的正文或值。
- 完整且仅含 text / speechStyle 参数的旧 generateSpeech 包装，转换成已有的 speech.text / speech.style 数据。仍由当前会话的语音权限、字数限制、固定音色和延迟合成流程决定实际行为；不会执行任意工具名。
- 无法恢复的内部协议、未知工具、嵌套协议在发送与语音工作前拒绝。最终投递处另有整轮检查，避免其他入口把协议当成正文发出。
- 单条 JSON 中有可用 text、但包含额外内部字段时保留正文，忽略无效的媒体与语音字段，内部元数据不会进入聊天。
- 会话系统提示明确要求完整 JSON，不输出 XML 工具标签，不在 text / speech.text 内嵌协议。

## 验证

完整回归命令为 `node --test`，宿主权限下 331 项通过、0 失败。日志：`.tmp/reply-protocol-tests-host.log`。其中回复、图片回执、语音与新协议的针对性测试共 56 项通过。

新增 `test/reply-protocol.test.mjs` 覆盖围栏与重复编码、缺少结尾括号、真实媒体段投递路径、旧语音协议进入延迟合成、未知工具与损坏片段在工作前拒绝、整轮投递检查，以及普通文本与普通代码保持原样。

## 已部署的安装版

实际运行目录为 `C:/Users/Lenovo/AppData/Local/QQAgent/workspace`。源码目录为 `D:/Users/Lenovo/bupt-qq-homework-bot`。

使用 `scripts/apply-reply-protocol-fix.mjs` 备份并更新四个文件：reply-protocol、media-replies、reply-delivery、chat-rules。备份目录记录在 `data/reply-protocol-fix-20261023.json`。部署前等待会话空闲，只重载聊天引擎，验证新进程和 QQ 重新连接，并核对设置与加密凭据的哈希未改变。

部署报告为 `data/reply-protocol-fix-20261023.json`，结果 passed=true、engineReloaded=true、connected=true、settingsUnchanged=true。安装目录的本地回放通过，捕获传输中只出现正文和 record 类型，损坏 JSON 被拒绝。

本次未向 QQ 发送测试消息，也未调用在线 MiMo 语音合成。因此这些证据确认解析、投递路径和部署状态，不能代替手机端真实收听与图片送达验证。验收时可发「发我一个语音」及「发个表情包」，确认收到可播放语音和实际图片，正文没有 JSON、标签或素材 ID。
