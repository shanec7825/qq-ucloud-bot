# 桌面版版本脱节排查

核查日期：2026-10-21（Asia/Shanghai）。以下记录最初的只读排查；用户随后授权修复及删除 C 盘旧工作区。

## 修复结果

- C 盘旧工作区已完整备份到 `D:/Users/Lenovo/bupt-qq-homework-bot/data/migration-20261021/C-workspace`，4,107 个文件通过 SHA-256 校验。另有 D 盘数据与 NapCat 配置恢复点。
- 实际后台已迁移到 D 盘，QQ 登录成功，机器人已连接；五个插件均为 2.0.1，五个扩展页面已注册，实际页面脚本与源码 SHA-256 一致。保留 D 盘较新的群配置和授权，补齐 C 盘独有数据及 QQ 设备配置。
- 原 `C:/Users/Lenovo/AppData/Local/QQAgent/workspace` 已删除，现场释放 1,360,961,536 字节。C 盘标准应用安装目录和 WebView2 缓存不属于旧工作区。
- 启动与认证前检查 6099 监听进程所属工作区；阻止复用别处的旧后台。插件版本不一致时部署重启，并等待 QQ 登录后的异步插件加载。
- 托管工作区升级先备份将被覆盖的代码并保留数据、工具与环境配置；运行中的 NapCat 需先退出。Git 源码目录不自动覆盖。
- 发布流程拒绝用已有版本号对应另一个提交；后台源码与插件改动也会触发构建。
- Node 24 完整测试 153 项通过；实际 .NET 桌面宿主编译通过。实测代码升级、旧代码备份、用户配置保留和非法包写入前拒绝。发行包审核与五个便携插件升级保留数据审核通过。
- 运行状态与清理回执保存在上述备份目录中的 `live-verification.json`、`C-workspace-manifest.json`、`deletion-receipt.json`。没有发送测试 QQ 消息或发起测试模型请求。

## 最初排查快照

## 结论

没有发现当前 D 盘源码误退回旧分支。已确认的问题是源码、GitHub 发行包、桌面宿主、实际 NapCat 工作区分别处于不同状态。

| 层级 | 现场证据 | 判断 |
|---|---|---|
| D 盘源码 | HEAD 与现场 git ls-remote 的 main 均为 54f7f2fdd199f6fe2be9fd002aa4dc617ddfa015 | 当前主线；多 QQ 与扩展页提交都在历史中 |
| GitHub 下载包 | 最新 v2.0.0 指向 9fab177561b3d12d218554c97fa99c8d8917a12a，发布于北京时间 20:54 | 缺少随后两次扩展页与界面提交 |
| 已安装桌面宿主 | C:/Users/Lenovo/AppData/Local/Programs/QQAgent/QQAgent.exe 为 2.0.0.0 | EXE 版本不能代表后台版本 |
| 桌面保存的目录 | C:/Users/Lenovo/AppData/Local/QQAgent/desktop.json 已指向 D:/Users/Lenovo/bupt-qq-homework-bot | 保存路径切换未使既有后台迁移 |
| 实际 NapCat | PID 38292 与 28080 的可执行文件及脚本仍在 C:/Users/Lenovo/AppData/Local/QQAgent/workspace/tools/napcat | 当前仍运行 C 盘后台 |
| C 盘插件 | 五个插件均为 1.1.0，deployment.json 的 projectRoot 都指向 C 盘旧工作区 | 新界面与功能不会从 D 盘自动生效 |
| 本地补丁 | package.json 等四个文件改为 2.0.1，另有未跟踪版本说明；未提交 | 上次工作中断在打包完成之后 |
| 本地 2.0.1 包 | release/2.0.1 有安装包、便携包及 SHA256SUMS.txt；无远端 v2.0.1 tag | 不能称为已发布或已部署 |

## 源码与构建核对

从 9fab177 到 HEAD 有两次提交：54b3de8（扩展设置页）、54f7f2f（NapCat 风格与使用说明）。

抽查本地 2.0.0 和 2.0.1 的 backend.zip，src/main.mjs、src/settings.mjs、napcat-plugin/index.mjs、napcat-plugin/native-config.mjs、napcat-plugin/webui/app.js 五个文件均与当前源码 SHA-256 一致。这说明本地包含最新抽查代码；并不意味着 GitHub 上同名 2.0.0 包也已更新。

最新提交的远端构建 39621535247 状态为 success。发布脚本 .github/workflows/release-windows.yml 明确在 tag 已存在时 exit 0；相同版本号下的成功流水线不等于发布了新资产。

## 代码中的两个长期缺口

1. desktop/QQAgent.cs 的 Initialize 在 IsProject(workspace) 成立时跳过 ExtractWorkspace。旧托管目录一旦有效，就没有按版本升级后端的步骤。
2. src/desktop-service.mjs 固定访问 127.0.0.1:6099。status/start 校验认证与插件 ID，但没有核对该服务实际来自哪个工作区，也没有按插件版本判断升级。仅改 desktop.json 不能切换已有进程。

以上为静态代码判断，实际运行目录已另由现场进程路径和插件部署文件确认。

## 后续修复顺序

1. 保留 D 盘 main 为源码基准，先对 C/D 配置、授权和 QQ 登录数据建立可恢复备份。
2. 核对数据差异后，受控停止 C 盘实例并启动 D 盘实例；校验监听进程、插件 projectRoot、页面资源哈希和 QQ 状态。
3. 修复托管工作区升级及运行目录核验；有效自选源码目录必须与托管升级区分，避免覆盖开发代码。
4. 完成补丁测试与审核后提交、发布新版本；以远端 tag SHA、安装包和校验清单确认发布完成。
5. 确认不再依赖 C 盘且备份有效后，再处理旧目录。

上述顺序为最初排查时的修复建议；后续实施结果见本文开头。

远端证据：https://github.com/shanec7825/qq-ucloud-bot/releases/tag/v2.0.0
构建记录：https://github.com/shanec7825/qq-ucloud-bot/actions/runs/39621535247
