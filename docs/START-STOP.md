# 网页与后台启停

## 打开网页

1. 从桌面或开始菜单打开 **Qlyra**。
2. 后台未启动时，点击 **启动机器人**。已经运行时可直接显示网页。
3. 浏览器也可打开 <http://127.0.0.1:6099/webui/>。

找不到窗口时，在 Windows 右下角展开隐藏图标，双击 **Qlyra** 托盘图标。也可再次打开桌面快捷方式。

应用窗口和浏览器网页共用同一个本机后台，可以同时打开。浏览器入口只在后台启动后可用。

## 关闭界面与暂停回复

| 想做什么 | 操作 | 结果 |
| --- | --- | --- |
| 关闭浏览器里的网页 | 关闭标签页或浏览器窗口 | 机器人继续运行 |
| 收起 Qlyra 窗口 | 点击窗口右上角 × | 收到托盘，机器人继续运行 |
| 暂停 AI 回复 | 右键 Qlyra 托盘 → 运行管理 → 停止机器人 | AI 后台停止；NapCat 网页与 QQ 保留 |
| 恢复 AI 回复 | 托盘 → 运行管理 → 启动机器人 | AI 后台重新启动 |
| 退出桌面外壳 | 托盘 → 退出桌面程序（后台继续运行） | 桌面窗口退出，后台继续运行 |

“退出 Web Login”只退出网页管理登录，不等于退出 QQ，也不停止机器人。要暂停回复，必须使用“停止机器人”。

当前桌面菜单没有“一键停止全部 NapCat 服务”的入口。“停止机器人”不会让 6099 网页端口关闭。

## 项目内的命令行入口

在当前项目目录的 PowerShell 中运行：

```powershell
node scripts/desktop-service.mjs status 'D:\Users\Lenovo\bupt-qq-homework-bot'
node scripts/desktop-service.mjs start 'D:\Users\Lenovo\bupt-qq-homework-bot'
node scripts/desktop-service.mjs stop-bot 'D:\Users\Lenovo\bupt-qq-homework-bot'
```

`status` 检查后台；`start` 启动或复用后台；`stop-bot` 停止 AI。网页仍由 NapCat 提供。
