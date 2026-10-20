using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("QQ Agent")]
[assembly: AssemblyDescription("QQ Agent Windows desktop launcher")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]

namespace QQAgentDesktop {
    internal static class Program {
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2000000 };
        internal static readonly string AppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QQAgent");
        internal static readonly string InstallDirectory = AppDomain.CurrentDomain.BaseDirectory;
        internal static string Argument(string[] args, string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        [STAThread] static void Main(string[] args) {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            bool smoke = args.Contains("--self-test"), created;
            using (var mutex = new Mutex(true, smoke ? "Local\\QQAgentDesktopSmoke" : "Local\\QQAgentDesktop", out created)) {
                if (!created) { try { EventWaitHandle.OpenExisting("Local\\QQAgentDesktopShow").Set(); } catch { } return; }
                Directory.CreateDirectory(AppData);
                try { Application.Run(new MainWindow(args, smoke)); }
                catch (Exception error) { MessageBox.Show("桌面程序未能打开：" + error.Message + "\n请检查 WebView2 Runtime，或查看 README 的恢复入口。", "QQ Agent", MessageBoxButtons.OK, MessageBoxIcon.Error); Environment.ExitCode = 1; }
            }
        }
    }

    internal sealed class MainWindow : Form {
        readonly WebView2 browser = new WebView2();
        readonly Label progress = new Label();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer();
        readonly List<Button> actions = new List<Button>();
        readonly bool smoke;
        readonly string[] arguments;
        string workspace, injection;
        bool busy, quitting, home = true;
        CoreWebView2Environment environment;
        EventWaitHandle showEvent;
        const string HomeURL = "https://qq-agent.local/home.html";
        const string LocalOrigin = "http://127.0.0.1:6099";

        public MainWindow(string[] args, bool test) {
            smoke = test; arguments = args; Text = "QQ Agent"; Width = 1180; Height = 840; MinimumSize = new Size(900, 640);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9F); BackColor = Color.FromArgb(248, 246, 252);
            AutoScaleMode = AutoScaleMode.Dpi; Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (smoke) { Opacity = 0; ShowInTaskbar = false; }
            var sidebar = new Panel { Dock = DockStyle.Left, Width = 188, Padding = new Padding(14, 22, 14, 14), BackColor = Color.FromArgb(244, 236, 250) };
            var brand = new Label { Text = "QQ Agent", Font = new Font("Segoe UI", 20F, FontStyle.Bold), Height = 58, Dock = DockStyle.Top, ForeColor = Color.FromArgb(77, 52, 116) };
            var navigation = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
            AddAction(navigation, "首页与运行状态", delegate { return NavigateHome(); });
            AddAction(navigation, "启动机器人", delegate { return Operate("start"); });
            AddAction(navigation, "QQ 登录", delegate { return OpenPage("/webui/qq_login"); });
            AddAction(navigation, "切换 QQ 账号", SwitchAccount);
            AddAction(navigation, "机器人与插件设置", delegate { return OpenPage("/webui/plugins"); });
            AddAction(navigation, "准备运行组件", delegate { return Operate("install"); });
            AddAction(navigation, "选择已有项目", SelectWorkspace);
            AddAction(navigation, "打开数据目录", delegate { OpenFolder(Path.Combine(workspace, "data")); return Task.FromResult(0); });
            AddAction(navigation, "停止机器人", delegate { return Operate("stop-bot"); });
            var tip = new Label { Text = "关闭窗口会收起到托盘。\n桌面／开始菜单也可重新打开。", Dock = DockStyle.Bottom, Height = 80, ForeColor = Color.FromArgb(112, 98, 130), Padding = new Padding(0, 16, 0, 0) };
            sidebar.Controls.Add(navigation); sidebar.Controls.Add(brand); sidebar.Controls.Add(tip);
            progress.Dock = DockStyle.Bottom; progress.Height = 34; progress.Padding = new Padding(16, 8, 0, 0); progress.ForeColor = Color.FromArgb(105, 87, 124); progress.Text = "正在读取本机状态…";
            browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser); Controls.Add(progress); Controls.Add(sidebar);
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示主窗口", null, delegate { RestoreWindow(); });
            menu.Items.Add("QQ 登录", null, async delegate { RestoreWindow(); await RunSafely(delegate { return OpenPage("/webui/qq_login"); }); });
            menu.Items.Add("机器人设置", null, async delegate { RestoreWindow(); await RunSafely(delegate { return OpenPage("/webui/plugins"); }); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出桌面程序（后台继续运行）", null, delegate { quitting = true; Close(); });
            tray.Icon = Icon; tray.Text = "QQ Agent · 双击打开"; tray.ContextMenuStrip = menu; tray.Visible = true; tray.DoubleClick += delegate { RestoreWindow(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!quitting && !smoke && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideToTray(); } };
            FormClosed += delegate { refresh.Stop(); tray.Dispose(); if (showEvent != null) showEvent.Dispose(); };
            Shown += async delegate { await Initialize(); };
            refresh.Interval = 12000; refresh.Tick += async delegate { if (!busy && home) await RefreshStatus(); };
            if (!smoke) { showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\QQAgentDesktopShow"); Task.Run(delegate { while (!IsDisposed) { try { if (showEvent.WaitOne(1500)) BeginInvoke((Action)RestoreWindow); } catch { break; } } }); }
        }
        void AddAction(FlowLayoutPanel panel, string title, Func<Task> action) {
            var button = new Button { Text = title, Width = 154, Height = 43, Margin = new Padding(0, 0, 0, 9), FlatStyle = FlatStyle.Flat, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0), BackColor = Color.FromArgb(254, 251, 255), ForeColor = Color.FromArgb(76, 55, 102), Cursor = Cursors.Hand };
            button.FlatAppearance.BorderSize = 0; button.Click += async delegate { await RunSafely(action); }; panel.Controls.Add(button); actions.Add(button);
        }
        async Task RunSafely(Func<Task> action) {
            if (busy) return; busy = true; actions.ForEach(button => button.Enabled = false);
            try { await action(); }
            catch (Exception error) { progress.Text = error.Message; if (!smoke) MessageBox.Show(error.Message, "QQ Agent", MessageBoxButtons.OK, MessageBoxIcon.Information); else throw; }
            finally { busy = false; actions.ForEach(button => button.Enabled = true); }
        }
        static bool IsProject(string folder) { return !String.IsNullOrEmpty(folder) && File.Exists(Path.Combine(folder, "scripts", "desktop-service.mjs")) && File.Exists(Path.Combine(folder, "src", "main.mjs")); }
        async Task Initialize() {
            try {
                workspace = Program.Argument(arguments, "--workspace");
                string saved = Path.Combine(Program.AppData, "desktop.json");
                if (!IsProject(workspace) && File.Exists(saved)) { try { workspace = (string)Program.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(saved))["workspace"]; } catch { } }
                if (!IsProject(workspace) && IsProject(Environment.CurrentDirectory)) workspace = Environment.CurrentDirectory;
                if (!IsProject(workspace)) { workspace = Path.Combine(Program.AppData, "workspace"); await Task.Run((Action)ExtractWorkspace); }
                SaveWorkspace();
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.AppData, smoke ? "WebView2-smoke" : "WebView2"));
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.Settings.AreHostObjectsAllowed = false; browser.CoreWebView2.Settings.IsWebMessageEnabled = true;
                browser.CoreWebView2.SetVirtualHostNameToFolderMapping("qq-agent.local", Path.Combine(Program.InstallDirectory, "assets"), CoreWebView2HostResourceAccessKind.DenyCors);
                browser.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                    Uri uri; if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) { e.Cancel = true; return; }
                    if (uri.GetLeftPart(UriPartial.Authority) != LocalOrigin && uri.GetLeftPart(UriPartial.Authority) != "https://qq-agent.local" && e.Uri != "about:blank") { e.Cancel = true; if (uri.Scheme == "https") OpenExternal(uri.AbsoluteUri); }
                };
                browser.CoreWebView2.NewWindowRequested += PopupRequested;
                browser.CoreWebView2.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                    if (!e.Source.StartsWith(HomeURL, StringComparison.Ordinal)) return;
                    string action; try { action = e.TryGetWebMessageAsString(); } catch { return; }
                    await RunSafely(async delegate {
                        if (action == "login") await OpenPage("/webui/qq_login"); else if (action == "settings") await OpenPage("/webui/plugins"); else if (action == "workspace") await SelectWorkspace();
                        else if (action == "switch") await SwitchAccount(); else if (new[] { "start", "install", "stop-bot" }.Contains(action)) await Operate(action);
                    });
                };
                browser.CoreWebView2.NavigationCompleted += async delegate { if (home && browser.Source != null && browser.Source.Host == "qq-agent.local") await RefreshStatus(); };
                await NavigateHome(); refresh.Start();
                if (smoke) await SmokeTest();
            } catch (Exception error) {
                if (smoke) { WriteSmoke(false, error.Message); quitting = true; Close(); }
                else { progress.Text = error.Message; MessageBox.Show("打开失败：" + error.Message + "\nWebView2 Runtime 下载：https://developer.microsoft.com/microsoft-edge/webview2/", "QQ Agent"); }
            }
        }
        void ExtractWorkspace() {
            Directory.CreateDirectory(workspace);
            if (Directory.GetFiles(workspace).Length > 0 && !File.Exists(Path.Combine(workspace, ".qq-agent-managed"))) throw new Exception("默认工作区已有其他文件，请通过“选择已有项目”指定目录。");
            string zip = Path.Combine(Program.InstallDirectory, "backend.zip");
            using (var archive = ZipFile.OpenRead(zip)) foreach (var entry in archive.Entries) {
                string path = Path.GetFullPath(Path.Combine(workspace, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                if (!path.StartsWith(Path.GetFullPath(workspace).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装包包含无效路径。");
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(path); continue; }
                if (entry.FullName.StartsWith("data/") || entry.FullName.StartsWith("tools/") || Path.GetFileName(path).StartsWith(".env")) throw new Exception("安装包包含不允许覆盖的配置目录。");
                Directory.CreateDirectory(Path.GetDirectoryName(path)); entry.ExtractToFile(path, true);
            }
            File.WriteAllText(Path.Combine(workspace, ".qq-agent-managed"), "1.0.1");
        }
        void SaveWorkspace() { if (!smoke) File.WriteAllText(Path.Combine(Program.AppData, "desktop.json"), Program.Json.Serialize(new { workspace = workspace })); }
        async Task SelectWorkspace() { using (var dialog = new FolderBrowserDialog { Description = "选择现有 QQ Agent 项目目录，配置和授权会继续使用", SelectedPath = workspace }) {
            if (dialog.ShowDialog(this) == DialogResult.OK) { if (!IsProject(dialog.SelectedPath)) throw new Exception("此目录未找到桌面支持脚本，请先更新项目，或使用安装包默认工作区。"); workspace = dialog.SelectedPath; SaveWorkspace(); await NavigateHome(); }
        } }
        async Task NavigateHome() { home = true; browser.CoreWebView2.Navigate(HomeURL); await Task.FromResult(0); }
        async Task Operate(string action) { progress.Text = action == "install" ? "准备组件中，首次下载可能需要几分钟…" : action == "stop-bot" ? "正在停止机器人…" : "正在启动并复用本机后台…"; await Service(action, action == "install" ? 600000 : 150000); await NavigateHome(); }
        async Task OpenPage(string path) {
            var status = await Service("status", 25000);
            if (!GetBool(status, "webuiAvailable")) { progress.Text = "正在启动 QQ 登录服务…"; await Service("start", 150000); }
            var session = await Service("session", 25000); string credential = GetText(session, "credential");
            if (String.IsNullOrEmpty(credential)) throw new Exception("未取得本机登录会话。");
            if (injection != null) browser.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(injection);
            injection = await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin==='" + LocalOrigin + "'){localStorage.setItem('token',JSON.stringify(" + Program.Json.Serialize(credential) + "));}");
            home = false; browser.CoreWebView2.Navigate(LocalOrigin + path); progress.Text = path.Contains("qq_login") ? "QQ 登录入口始终可从左侧或托盘打开。已登录时会显示当前账号。" : "配置保存在当前项目，切换 QQ 不会清除。";
        }
        async Task SwitchAccount() {
            if (MessageBox.Show(this, "将断开当前机器人 QQ，重新显示登录入口。\n机器人设置、模型和其他服务授权会保留。\n\n现在切换 QQ？", "切换 QQ", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            progress.Text = "正在切换 QQ，请等待新的登录页面…"; await Service("switch-account", 150000); await OpenPage("/webui/qq_login");
        }
        async Task RefreshStatus() {
            try { var status = await Service("status", 25000); status["workspace"] = workspace; status["version"] = "1.0.1";
                if (home && browser.CoreWebView2 != null) await browser.CoreWebView2.ExecuteScriptAsync("window.renderStatus&&window.renderStatus(" + Program.Json.Serialize(status) + ")");
                progress.Text = GetBool(status, "webuiAvailable") ? GetBool(status, "qqLoggedIn") ? "QQ 已登录 · 关闭窗口收起到托盘" : "QQ 等待登录 · 点击左侧“QQ 登录”" : "后台未运行 · 首次使用先准备组件，再启动机器人";
            } catch (Exception error) { progress.Text = error.Message; }
        }
        static bool GetBool(Dictionary<string, object> value, string key) { return value.ContainsKey(key) && value[key] is bool && (bool)value[key]; }
        static string GetText(Dictionary<string, object> value, string key) { return value.ContainsKey(key) && value[key] != null ? value[key].ToString() : ""; }
        internal static string Quote(string text) {
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in text) { if (c == '\\') { slashes++; continue; } if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); } else { result.Append('\\', slashes); result.Append(c); } slashes = 0; }
            result.Append('\\', slashes * 2); return result.Append('"').ToString();
        }
        async Task<Dictionary<string, object>> Service(string action, int timeout) {
            string node = Path.Combine(Program.InstallDirectory, "runtime", "node.exe"), script = Path.Combine(workspace, "scripts", "desktop-service.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new Exception("运行文件不完整，请重新安装 QQ Agent，或选择已更新的项目。");
            using (var process = new Process { StartInfo = new ProcessStartInfo(node, Quote(script) + " " + Quote(action) + " " + Quote(workspace)) { WorkingDirectory = workspace, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 } }) {
                process.Start(); var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
                bool exited = await Task.Run(delegate { return process.WaitForExit(timeout); });
                if (!exited) { try { process.Kill(); } catch { } throw new Exception("操作等待超时；请先检查后台状态，避免重复启动。"); }
                string output = await stdout; await stderr;
                Dictionary<string, object> result; try { result = Program.Json.Deserialize<Dictionary<string, object>>(output.Trim()); } catch { throw new Exception("本机服务返回异常，请查看项目 data 目录日志。"); }
                if (process.ExitCode != 0 || !GetBool(result, "ok")) throw new Exception(GetText(result, "error")); return result;
            }
        }
        async void PopupRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
            e.Handled = true;
            if (e.Uri != "about:blank") { if (e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) OpenExternal(e.Uri); return; }
            var deferral = e.GetDeferral(); var popupForm = new Form { Opacity = 0, ShowInTaskbar = false, Width = 800, Height = 700 }; var popup = new WebView2 { Dock = DockStyle.Fill }; popupForm.Controls.Add(popup); popupForm.Show();
            try { await popup.EnsureCoreWebView2Async(environment); popup.CoreWebView2.NavigationStarting += delegate(object source, CoreWebView2NavigationStartingEventArgs nav) { if (nav.Uri == "about:blank") return; nav.Cancel = true; if (nav.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) OpenExternal(nav.Uri); popupForm.BeginInvoke((Action)popupForm.Close); }; e.NewWindow = popup.CoreWebView2; }
            catch { popupForm.Close(); } finally { deferral.Complete(); }
        }
        static void OpenExternal(string url) { try { var uri = new Uri(url); if (uri.Scheme == "https") Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { } }
        static void OpenFolder(string path) { Directory.CreateDirectory(path); Process.Start(new ProcessStartInfo("explorer.exe", Quote(path)) { UseShellExecute = true }); }
        void HideToTray() { Hide(); tray.Visible = true; }
        void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
        async Task SmokeTest() {
            var status = await Service("status", 25000); if (!GetBool(status, "webuiAvailable")) throw new Exception("实机验证需要本机 NapCat 正在运行。");
            await OpenPage("/webui/plugins"); bool ready = false;
            for (int i = 0; i < 100; i++) { string value = await browser.CoreWebView2.ExecuteScriptAsync("document.body.innerText.includes('Google Drive')&&document.body.innerText.includes('机器人核心')"); if (value == "true") { ready = true; break; } await Task.Delay(150); }
            if (!ready) throw new Exception("内嵌插件管理未能加载。");
            string output = Program.Argument(arguments, "--output") ?? Path.Combine(workspace, "data", "desktop-smoke"); Directory.CreateDirectory(output);
            using (var stream = File.Create(Path.Combine(output, "plugins.png"))) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            await OpenPage("/webui/qq_login"); await Task.Delay(1500);
            HideToTray(); if (Visible || !tray.Visible) throw new Exception("托盘收起失败。"); RestoreWindow(); if (!Visible) throw new Exception("托盘恢复失败。");
            await NavigateHome(); await Task.Delay(300); await RefreshStatus();
            string shown = await browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('#qq').textContent");
            if (GetBool(status, "qqLoggedIn") && shown != Program.Json.Serialize("已登录")) throw new Exception("首页 QQ 登录状态与本机真实状态不一致。");
            using (var stream = File.Create(Path.Combine(output, "home.png"))) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            WriteSmoke(true, "Native WebView2, authenticated plugin page, QQ login navigation and tray restore verified. No account switch, QQ message or model request."); quitting = true; Close();
        }
        void WriteSmoke(bool passed, string message) {
            string output = Program.Argument(arguments, "--output") ?? Path.Combine(workspace, "data", "desktop-smoke"); Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "result.json"), Program.Json.Serialize(new { passed = passed, message = message }), Encoding.UTF8); if (!passed) Environment.ExitCode = 1;
        }
    }
}
