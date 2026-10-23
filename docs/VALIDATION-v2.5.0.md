# Qlyra 2.5.0 验证记录

日期：2026-10-23（北京时间）。用户明确授权“允许协调，统一部署”后，现用目录已升级为 Qlyra 2.5.0。QQ 已自动登录，AI 引擎连接正常，六个插件均为 2.5.0 且处于 active 状态；未打开桌面窗口。

## 交付内容

- MiMo `mimo-v2.5-tts-voiceclone`：上传 WAV / MP3 参考音频，通过 `audio.voice` data URL 调用；固定音色与逐条对话表达指导分开。
- 参考音频按内容哈希持久保存；10 MiB Base64 上限，约 7.5 MiB 原文件；64 KiB 分块兼容 NapCat 外层 100 KB JSON 限制。
- 上传的大小、顺序、格式、会话数量、过期和取消均有边界；相同音频重新上传可修复本机丢失或损坏的引用文件。
- 语音页拆为“声音设置”和“试听”。只展示当前音色方式；固定表达、连接设置、模拟对话及表达指导按需展开。试听页不显示保存设置按钮。
- 软件名称 Qlyra；使用用户附件推荐的紫色折带 L 图标，提供七尺寸 ICO。窗口、托盘、安装器、快捷方式和页面名称统一。
- 保留旧安装标识、数据位置、互斥锁与 `QQAgent.exe` 兼容入口。
- 插件静态 ESM 依赖以内容哈希标识更新；动态 bootstrap 沿用入口版本查询，避免热重载仍引用旧代码。

## 已完成验证

| 项目 | 结果 |
| --- | --- |
| Node 全量回归 | 315 项通过，0 失败；日志 `data/qlyra-tests-final.log` |
| 插件缓存刷新 | 在同一 Node 进程内加载依赖 1、再热更新为 2，通过 |
| 真实本地 HTTP 链路 | 鉴权、分块上传 200 KB 文件、参考原声、配置保存及模拟 MiMo 结果通过 |
| 语音请求格式 | WAV / MP3 data URL、固定身份、手动及对话语气、原文保持、配置与 Key 竞态通过 |
| 六插件浏览器回归 | 12 次保存；3 块上传 117 KiB 音频，设置／试听分离、未保存保护、语气覆盖、移动布局及鉴权通过；外部请求 0 |
| 启动向导浏览器检查 | 375 / 1440 宽度、明暗主题、键盘、减少动画与模拟操作通过 |
| Windows 发行构建 | Qlyra.exe 和安装器编译成功，版本 2.5.0.0；兼容 EXE 内容一致 |
| ICO | 16 / 24 / 32 / 48 / 64 / 128 / 256 七尺寸，结构有效 |
| 发行包审计 | 682 个后端文件与最终源码一致；无 data、tools、环境配置或本机凭据指纹 |
| 六插件打包审计 | 首次解压与再次升级保留用户 data；无部署机器路径 |
| 现用程序升级 | `C:/QQAgent/Qlyra.exe` 为 2.5.0.0；现用 workspace 的 682 个文件逐个匹配发行包 |
| 数据保留 | 账户、角色与绑定一致；环境及凭据文件字节一致；原有 12 个素材的元数据和实际文件均与备份一致 |
| 素材合并 | 追加 374 个公共动漫表情素材，未覆盖原有素材 |
| 真实语音页 | 三种音色入口可见，设置／试听分开，设置未改变，QQ 已登录且 AI 已连接；模型调用 0、QQ 消息 0 |
| 真实校园扩展 | 5 条课程均有课程名称和官方提交入口；列表与详情链接一致，未提交作业、未保存配置 |
| 自动语音降级 | 超过语音字数限制时保留正文，附言仅在普通文字预算允许时补入；明确语音请求仍严格校验 |

发行文件与 SHA-256 清单位于 `release/2.5.0/`，审计报告为 `release-audit.json` 与 `plugin-audit.json`。

界面截图：`data/ui-fixtures/qlyra-speech-settings-desktop.png`、`qlyra-speech-settings-mobile.png`、`qlyra-speech-clone-desktop.png`、`qlyra-speech-clone-mobile.png`。

## 验证边界

浏览器与音频链路测试使用隔离数据和模拟音频服务。本轮没有用用户真实参考音频请求 MiMo，也没有主动发送 QQ 消息；不能据此声称克隆相似度或真实 QQ 播放效果已验证。

现用安装目录为 `C:/QQAgent`，后端为 `C:/Users/Lenovo/AppData/Local/QQAgent/workspace`。本次仅恢复网页版后台；升级前 NapCat 已停止，升级后自动登录成功。

完整备份：`data/deployment-backups/2.5.0-2026-10-23T08-40-34-743Z/`，含原程序、后端代码、数据、插件和连接配置。部署报告：`data/qlyra-deployment.json`。真实页面报告与截图：`data/live-ui/qlyra-live-validation.json`、`qlyra-settings.png`、`qlyra-audition.png`；校园只读报告：`data/live-ui/school-speech-result.json`。

安装后辅助验收曾将 `Plugin/List` 误用为 POST，返回网页并中断检查；修正为 GET 后，在不重复安装或重启的情况下完成 `verify-deployed-2.5.0.mjs` 和真实页面验收。辅助脚本现使用已有认证缓存，只读核验现用目录。
