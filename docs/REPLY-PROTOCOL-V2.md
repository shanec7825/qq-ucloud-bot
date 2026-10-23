# 回复协议 V2：分析、取舍与验证

应用版本 2.6.0；协议版本 2。2026-10-23。

## 结论

保留 JSON 作为交换格式，改为版本化、分类型的内容计划。聊天 Agent 决定说什么，宿主决定是否允许、如何合成、向哪里发送及何时确认成功。普通资源查询继续走原来的受限工具 Agent，内容投递不伪装成工具调用。

旧协议的问题集中在四处：一个气泡混合 text、mediaIds 和 speech；缺少 speech.text 时隐式朗读 text；请求仅靠提示词约束格式；投递错误被写回聊天。单纯替换模型不能消除这些宿主行为。

## 线格式

```json
{"version":2,"messages":[
  {"type":"text","text":"给你唱两句，今晚换成预置音色。"},
  {"type":"speech","mode":"sing","text":"星光轻轻亮，晚风慢慢唱。","style":"轻快清唱，句尾柔和"}
]}
```

文字：type=text、text。图片：type=image、mediaId。语音：type=speech、mode=speak 或 sing、text、style。每个对象拒绝额外字段，语音的 style 不需要时填空字符串。完整约束见 src/reply-plan.schema.json；宿主业务校验见 src/reply-plan.mjs。

模型不能选择账号、QQ 目标、任意路径、图片 URL、服务地址、密钥或函数。图片只选择本轮提供的素材 ID。是否允许语音、是否明确要求唱歌，由宿主当前消息及设置确定；模型声明 sing 本身不授予权限。

## 校验与执行

1. MiMo 开启 response_format=json_object；Codex 开启 --output-schema。
2. 解码后校验版本、类型、字段、权限、素材 ID、数量、单项与总长度。整轮通过后才准备媒体和投递。
3. 格式错误最多再生成一次。修复请求使用原问题和上下文，不转发原始损坏协议，不因投递失败重跑模型。
4. 保持原有会话队列、首条引用、分条间隔、权限变化取消及延迟语音合成。
5. 仅将有回执的文字、图片和语音记为已投递。图片超时核对发送前后历史、本人身份、时间和 MD5；仅唯一新匹配可恢复回执，不盲目重发。

## 语音与唱歌

V2 文字项不自动朗读。文字和语音优先表达不同内容；自动语音重复时保留文字，明确要求的语音重复时将相同正文移到语音。明确要求朗读和 /语音 原文保留照读。

用户已允许唱歌改变音色。mode=sing 临时选择 mimo-v2.5-tts 和已保存的预置音色或冰糖，宿主在实际合成文本开头加 (唱歌)。本轮唱完后普通 speak 仍使用原复刻或设计模型。唱歌请求不上传原参考音频，且不修改持久设置。

## 官方依据与取舍

- [小米结构化输出](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)：支持 json_object，但只保证 JSON 语法；因此业务字段与权限仍由宿主检查。
- [Codex 开发命令](https://learn.chatgpt.com/docs/developer-commands)：提供 --output-schema。原进程沙箱及禁用工具设置继续生效。
- [OpenAI 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)：对象使用 additionalProperties=false 并显式 required，避免未定义字段混入。
- [小米语音合成](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)：预置模型支持唱歌标签；复刻和设计模型不支持唱歌。因此通过请求级路由满足歌声需求，保留日常声音身份。
- [NapCat 消息段](https://napneko.github.io/onebot/segment)：最终发送仍使用其 text、image、record 段。V2 是模型与宿主之间的内容计划，不改变 QQ 协议。

采用单次内容计划可保持整轮预检和明确发送顺序。逐条 function call 会引入额外模型往返及部分执行后继续规划的问题，本轮没有采用。Schema 也不能保证语义正确、歌声悦耳或 QQ 服务可用。

## 证据

- 完整测试 345 项通过、0 失败，日志 .tmp/v260-full-tests.log。
- 用当前 MiMo-V2.6-Pro 做两次真实生成，计划均通过 V2 校验；包含普通对话和原创短歌。报告 data/protocol-v2-live-check.json。
- 真实调用一次预置 TTS，取得 291884 字节有效 WAV；本地样本 data/protocol-v2-song-sample.wav。测试前后克隆设置一致。
- 上述真实测试未发送 QQ 消息，生成音频不等于已验证主观听感或真实 QQ 播放。图片超时恢复由模拟回执测试覆盖，真实图片显示仍需手机端验收。

兼容解码保留旧版纯文字、单对象、多气泡及完整旧语音包装；新生成提示与支持的后端统一请求 V2。运行时仍拒绝未知工具与不完整协议。后续可根据结构化诊断中的重复抑制率、修复次数和未确认图片回执数量评估是否继续收紧兼容分支。
