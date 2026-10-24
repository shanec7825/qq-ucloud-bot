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

[assembly: AssemblyTitle("Qlyra")]
[assembly: AssemblyProduct("Qlyra")]
[assembly: AssemblyDescription("Qlyra Windows desktop AI companion for QQ")]
[assembly: AssemblyVersion("2.6.2.0")]
[assembly: AssemblyFileVersion("2.6.2.0")]

namespace QQAgentDesktop {
    internal static class Program {
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2000000 };
        // Preserve the existing profile and workspace location across the Qlyra rename.
        internal static readonly string AppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QQAgent");
        internal static readonly string InstallDirectory = AppDomain.CurrentDomain.BaseDirectory;
        internal static string Argument(string[] args, string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        [STAThread] static void Main(string[] args) {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            bool smoke = args.Contains("--self-test"), webOnly = args.Contains("--web") && !smoke, created;
            using (var mutex = new Mutex(true, smoke ? "Local\\QQAgentDesktopSmoke" : webOnly ? "Local\\QQAgentWebLaunch" : "Local\\QQAgentDesktop", out created)) {
                if (!created) { try { EventWaitHandle.OpenExisting("Local\\QQAgentDesktopShow").Set(); } catch { } return; }
                Directory.CreateDirectory(AppData);
                try { Application.Run(new MainWindow(args, smoke)); }
                catch (Exception error) { MessageBox.Show("桌面程序未能打开：" + error.Message + "\n请检查 WebView2 Runtime，或查看 README 的恢复入口。", "Qlyra", MessageBoxButtons.OK, MessageBoxIcon.Error); Environment.ExitCode = 1; }
            }
        }
    }

    internal sealed class MainWindow : Form {
        readonly WebView2 browser = new WebView2();
        readonly Label progress = new Label();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer();
        readonly List<ToolStripItem> actions = new List<ToolStripItem>();
        readonly bool smoke, webOnly;
        readonly string[] arguments;
        string workspace, injection;
        bool busy, quitting, home = true, refreshInFlight;
        int navigationGeneration;
        readonly SemaphoreSlim navigationLock = new SemaphoreSlim(1, 1);
        CoreWebView2Environment environment;
        EventWaitHandle showEvent;
        const string HomeURL = "https://qq-agent.local/home.html";
        const string LocalOrigin = "http://127.0.0.1:6099";

        public MainWindow(string[] args, bool test) {
            smoke = test; webOnly = args.Contains("--web") && !test; arguments = args; Text = "Qlyra"; Width = 1180; Height = 840; MinimumSize = new Size(900, 640);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Microsoft YaHei UI", 9F); BackColor = Color.FromArgb(244, 246, 248);
            AutoScaleMode = AutoScaleMode.Dpi; Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (smoke || webOnly) { Opacity = 0; ShowInTaskbar = false; }
            progress.Dock = DockStyle.Bottom; progress.Height = 34; progress.Padding = new Padding(16, 8, 0, 0); progress.ForeColor = Color.FromArgb(82, 97, 115); progress.Text = "正在读取本机状态…";
            browser.Dock = DockStyle.Fill; browser.DefaultBackgroundColor = BackColor;
            Controls.Add(browser); Controls.Add(progress);
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示主窗口", null, delegate { RestoreWindow(); });
            menu.Items.Add("QQ 登录", null, async delegate { RestoreWindow(); await RunSafely(delegate { return OpenPage("/webui/qq_login"); }); });
            menu.Items.Add("机器人设置", null, async delegate { RestoreWindow(); await RunSafely(delegate { return OpenPage("/webui/plugins"); }); });
            menu.Items.Add("扩展设置页", null, async delegate { RestoreWindow(); await RunSafely(delegate { return OpenPage("/webui/extension"); }); });
            var management = new ToolStripMenuItem("运行管理"); menu.Items.Add(management);
            AddAction(management.DropDownItems, "一键准备并启动", delegate { return SetupAll(); });
            AddAction(management.DropDownItems, "启动机器人", delegate { return Operate("start"); });
            AddAction(management.DropDownItems, "停止机器人", delegate { return Operate("stop-bot"); });
            AddAction(management.DropDownItems, "切换 QQ 账号", SwitchAccount);
            AddAction(management.DropDownItems, "准备运行组件", delegate { return Operate("install"); });
            AddAction(management.DropDownItems, "选择已有项目", SelectWorkspace);
            AddAction(management.DropDownItems, "打开数据目录", delegate { OpenFolder(Path.Combine(workspace, "data")); return Task.FromResult(0); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出桌面程序（后台继续运行）", null, delegate { quitting = true; Close(); });
            tray.Icon = Icon; tray.Text = "Qlyra · 双击打开"; tray.ContextMenuStrip = menu; tray.Visible = !webOnly; tray.DoubleClick += delegate { RestoreWindow(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!quitting && !smoke && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideToTray(); } };
            FormClosed += delegate { refresh.Stop(); tray.Dispose(); if (showEvent != null) showEvent.Dispose(); };
            Shown += async delegate { await Initialize(); };
            refresh.Interval = 12000; refresh.Tick += async delegate { if (!busy && home) await RefreshStatus(); };
            if (!smoke && !webOnly) { showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\QQAgentDesktopShow"); Task.Run(delegate { while (!IsDisposed) { try { if (showEvent.WaitOne(1500)) BeginInvoke((Action)RestoreWindow); } catch { break; } } }); }
        }
        void AddAction(ToolStripItemCollection items, string label, Func<Task> action) {
            var item = new ToolStripMenuItem(label); item.Click += async delegate { await RunSafely(action); }; items.Add(item); actions.Add(item);
        }
        async Task RunSafely(Func<Task> action) {
            if (busy) return; busy = true; navigationGeneration++; actions.ForEach(button => button.Enabled = false);
            try { await action(); }
            catch (Exception error) { progress.Text = error.Message; if (!smoke) MessageBox.Show(error.Message, "Qlyra", MessageBoxButtons.OK, MessageBoxIcon.Information); else throw; }
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
                else if (File.Exists(Path.Combine(workspace, ".qq-agent-managed")) && !Directory.Exists(Path.Combine(workspace, ".git"))) {
                    string current = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
                    Version previous;
                    if (!Version.TryParse(File.ReadAllText(Path.Combine(workspace, ".qq-agent-managed")).Trim(), out previous)) throw new Exception("工作区版本记录无效，请先备份并检查该目录。");
                    if (previous < new Version(current)) {
                        if (System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == 6099)) throw new Exception("工作区需要升级，请先退出正在运行的 NapCat 后台，再重新打开桌面程序。配置和授权会保留。");
                        await Task.Run((Action)ExtractWorkspace);
                    }
                }
                SaveWorkspace();
                if (webOnly) {
                    await Service("start", 150000);
                    Process.Start(new ProcessStartInfo(LocalOrigin + "/webui/") { UseShellExecute = true });
                    quitting = true; Close(); return;
                }
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.AppData, smoke ? "WebView2-smoke" : "WebView2"));
                await browser.EnsureCoreWebView2Async(environment);
                // NapCat plugin assets keep fixed URLs and can remain cached for 24 hours across upgrades.
                await browser.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache);
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
                        else if (action == "switch") await SwitchAccount(); else if (action == "data") OpenFolder(Path.Combine(workspace, "data")); else if (action == "home") await NavigateHome();
                        else if (action == "open-webui") await OpenPage("/webui/"); else if (action == "setup") await SetupAll();
                        else if (action == "stop-conflict") await StopConflict(); else if (action == "trim-ports") await Operate("trim-ports"); else if (new[] { "start", "install", "stop-bot" }.Contains(action)) await Operate(action);
                    });
                };
                browser.CoreWebView2.NavigationCompleted += async delegate { if (home && browser.Source != null && browser.Source.Host == "qq-agent.local") await RefreshStatus(); };
                await NavigateHome(); refresh.Start();
                if (smoke) await SmokeTest();
            } catch (Exception error) {
                if (smoke) { WriteSmoke(false, error.Message); quitting = true; Close(); }
                else if (webOnly) { Environment.ExitCode = 1; MessageBox.Show("网页端启动失败：" + error.Message, "Qlyra"); quitting = true; Close(); }
                else { progress.Text = error.Message; MessageBox.Show("打开失败：" + error.Message + "\nWebView2 Runtime 下载：https://developer.microsoft.com/microsoft-edge/webview2/", "Qlyra"); }
            }
        }
        void ExtractWorkspace() {
            Directory.CreateDirectory(workspace);
            if ((File.GetAttributes(workspace) & FileAttributes.ReparsePoint) != 0) throw new Exception("工作区包含目录重定向，未自动升级。");
            if (Directory.GetFileSystemEntries(workspace).Length > 0 && !File.Exists(Path.Combine(workspace, ".qq-agent-managed"))) throw new Exception("默认工作区已有其他文件，请通过“选择已有项目”指定目录。");
            string zip = Path.Combine(Program.InstallDirectory, "backend.zip");
            using (var archive = ZipFile.OpenRead(zip)) {
            var entries = archive.Entries.Where(entry => !entry.FullName.EndsWith("/")).ToArray();
            foreach (var entry in entries) {
                string relative = entry.FullName.Replace('\\', '/');
                if (relative.Split('/').Any(part => part == ".." || part.StartsWith(".env", StringComparison.OrdinalIgnoreCase)) || new[] { "data/", "tools/", ".git/" }.Any(prefix => relative.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) || Path.IsPathRooted(relative)) throw new Exception("安装包包含不允许覆盖的路径。");
                string check = workspace;
                foreach (string part in relative.Split('/')) {
                    check = Path.Combine(check, part);
                    if ((File.Exists(check) || Directory.Exists(check)) && (File.GetAttributes(check) & FileAttributes.ReparsePoint) != 0) throw new Exception("工作区包含文件或目录重定向，未自动升级。");
                }
            }
            if (File.Exists(Path.Combine(workspace, ".qq-agent-managed"))) {
                string backup = Path.Combine(workspace, "data", "code-backups", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + ".zip");
                Directory.CreateDirectory(Path.GetDirectoryName(backup));
                using (var snapshot = ZipFile.Open(backup, ZipArchiveMode.Create)) foreach (var entry in entries) {
                    string previous = Path.GetFullPath(Path.Combine(workspace, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                    if (!previous.StartsWith(Path.GetFullPath(workspace).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装包包含无效路径。");
                    if (File.Exists(previous)) snapshot.CreateEntryFromFile(previous, entry.FullName);
                }
            }
            foreach (var entry in archive.Entries) {
                string path = Path.GetFullPath(Path.Combine(workspace, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                if (!path.StartsWith(Path.GetFullPath(workspace).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装包包含无效路径。");
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(path); continue; }
                if (entry.FullName.StartsWith("data/") || entry.FullName.StartsWith("tools/") || Path.GetFileName(path).StartsWith(".env")) throw new Exception("安装包包含不允许覆盖的配置目录。");
                Directory.CreateDirectory(Path.GetDirectoryName(path)); entry.ExtractToFile(path, true);
            }
            }
            File.WriteAllText(Path.Combine(workspace, ".qq-agent-managed"), Assembly.GetExecutingAssembly().GetName().Version.ToString(3));
        }
        void SaveWorkspace() { if (!smoke) File.WriteAllText(Path.Combine(Program.AppData, "desktop.json"), Program.Json.Serialize(new { workspace = workspace })); }
        async Task SelectWorkspace() { using (var dialog = new FolderBrowserDialog { Description = "选择现有 Qlyra / QQ Agent 项目目录，配置和授权会继续使用", SelectedPath = workspace }) {
            if (dialog.ShowDialog(this) == DialogResult.OK) { if (!IsProject(dialog.SelectedPath)) throw new Exception("此目录未找到桌面支持脚本，请先更新项目，或使用安装包默认工作区。"); workspace = dialog.SelectedPath; SaveWorkspace(); await NavigateHome(); }
        } }
        async Task NavigateHome() {
            int generation = ++navigationGeneration; string folder = workspace;
            var status = await Service("status", 25000);
            if (!CurrentNavigation(generation, folder)) return;
            if (GetBool(status, "webuiAvailable")) { await OpenPageCore("/webui/", generation, folder); return; }
            home = true; progress.Visible = true; browser.CoreWebView2.Navigate(HomeURL);
        }
        async Task Operate(string action, bool navigate = true) { progress.Text = action == "install" ? "准备组件中，首次下载可能需要几分钟…" : action == "stop-bot" ? "正在停止机器人…" : action == "stop-conflict" ? "正在退出其它工作区的 NapCat 后台…" : action == "trim-ports" ? "正在整理本机端口占用…" : "正在启动并复用本机后台…"; await Service(action, action == "install" ? 600000 : 150000); if (navigate) await NavigateHome(); }
        async Task SetupAll() {
            Exception failure = null;
            try { await Operate("install", false); await Operate("start", false); }
            catch (Exception error) { failure = error; }
            await SendProgressDone("setup", failure == null, failure == null ? null : failure.Message);
            if (failure != null) throw failure;
            await NavigateHome();
        }
        async Task StopConflict() {
            if (MessageBox.Show(this, "将退出其它工作区的 NapCat 后台以释放被占端口。其它后台里的 QQ 连接会断开,配置不受影响。现在继续?", "释放被占端口", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) { await SendProgressDone("stop-conflict", false, "已取消"); return; }
            await Operate("stop-conflict");
        }
        async Task OpenPage(string path) {
            await OpenPageCore(path, ++navigationGeneration, workspace);
        }
        bool CurrentNavigation(int generation, string folder) { return generation == navigationGeneration && folder == workspace && !IsDisposed; }
        async Task OpenPageCore(string path, int generation, string folder) {
            if (!CurrentNavigation(generation, folder)) return;
            var status = await Service("status", 25000);
            if (!CurrentNavigation(generation, folder)) return;
            if (!GetBool(status, "webuiAvailable")) { progress.Text = "正在启动 QQ 登录服务…"; await Service("start", 150000); if (!CurrentNavigation(generation, folder)) return; }
            var session = await Service("session", 25000); string credential = GetText(session, "credential");
            if (!CurrentNavigation(generation, folder)) return;
            if (String.IsNullOrEmpty(credential)) throw new Exception("未取得本机登录会话。");
            await navigationLock.WaitAsync();
            try {
                if (!CurrentNavigation(generation, folder)) return;
                if (injection != null) { browser.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(injection); injection = null; }
                string registered = await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin==='" + LocalOrigin + "'){localStorage.setItem('token',JSON.stringify(" + Program.Json.Serialize(credential) + "));}");
                if (!CurrentNavigation(generation, folder)) { browser.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(registered); return; }
                injection = registered;
                home = false; progress.Visible = false; browser.CoreWebView2.Navigate(LocalOrigin + path);
            } finally { navigationLock.Release(); }
        }
        async Task SwitchAccount() {
            if (MessageBox.Show(this, "将断开当前机器人 QQ，重新显示登录入口。\n机器人设置、模型和其他服务授权会保留。\n\n现在切换 QQ？", "切换 QQ", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) { await SendProgressDone("switch", false, "已取消"); return; }
            progress.Text = "正在切换 QQ，请等待新的登录页面…"; await Service("switch-account", 150000); await OpenPage("/webui/qq_login");
        }
        async Task RefreshStatus() {
            if (refreshInFlight || busy || !home) return;
            refreshInFlight = true; int generation = navigationGeneration; string folder = workspace;
            try { var status = await Service("status", 25000);
                if (!CurrentNavigation(generation, folder) || busy || !home) return;
                status["workspace"] = folder; status["version"] = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
                if (GetBool(status, "webuiAvailable")) { await OpenPageCore("/webui/", generation, folder); return; }
                if (home && browser.CoreWebView2 != null) await browser.CoreWebView2.ExecuteScriptAsync("window.renderStatus&&window.renderStatus(" + Program.Json.Serialize(status) + ")");
                if (!CurrentNavigation(generation, folder) || busy || !home) return;
                progress.Text = status.ContainsKey("workspaceError") ? GetText(status, "workspaceError") : GetBool(status, "webuiAvailable") ? "NapCat 原版 WebUI" : "后台未运行 · 首次使用先准备组件，再启动机器人";
            } catch (Exception error) { if (CurrentNavigation(generation, folder) && !busy && home) progress.Text = error.Message; }
            finally { refreshInFlight = false; }
        }
        static bool GetBool(Dictionary<string, object> value, string key) { return value.ContainsKey(key) && value[key] is bool && (bool)value[key]; }
        static string GetText(Dictionary<string, object> value, string key) { return value.ContainsKey(key) && value[key] != null ? value[key].ToString() : ""; }
        internal static string Quote(string text) {
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in text) { if (c == '\\') { slashes++; continue; } if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); } else { result.Append('\\', slashes); result.Append(c); } slashes = 0; }
            result.Append('\\', slashes * 2); return result.Append('"').ToString();
        }
        async Task<Dictionary<string, object>> Service(string action, int timeout) {
            Exception failure = null; Dictionary<string, object> result = null;
            try {
                string node = Path.Combine(Program.InstallDirectory, "runtime", "node.exe"), script = Path.Combine(workspace, "scripts", "desktop-service.mjs");
                if (!File.Exists(node) || !File.Exists(script)) throw new Exception("运行文件不完整，请重新安装 Qlyra，或选择已更新的项目。");
                using (var process = new Process { StartInfo = new ProcessStartInfo(node, Quote(script) + " " + Quote(action) + " " + Quote(workspace)) { WorkingDirectory = workspace, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 } }) {
                    process.Start(); var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = PumpProgress(process);
                    bool exited = await Task.Run(delegate { return process.WaitForExit(timeout); });
                    if (!exited) { try { process.Kill(); } catch { } throw new Exception("操作等待超时；请先检查后台状态，避免重复启动。"); }
                    string output = await stdout; await stderr;
                    Dictionary<string, object> parsed; try { parsed = Program.Json.Deserialize<Dictionary<string, object>>(output.Trim()); } catch { throw new Exception("本机服务返回异常，请查看项目 data 目录日志。"); }
                    if (process.ExitCode != 0 || !GetBool(parsed, "ok")) throw new Exception(GetText(parsed, "error"));
                    result = parsed;
                }
            } catch (Exception error) { failure = error; }
            await SendProgressDone(action, failure == null, failure == null ? null : failure.Message);
            if (failure != null) throw failure;
            return result;
        }
        async Task PumpProgress(Process process) {
            try {
                while (true) {
                    string line = await process.StandardError.ReadLineAsync();
                    if (line == null) break;
                    if (!line.StartsWith("PROGRESS ", StringComparison.Ordinal)) continue;
                    Dictionary<string, object> payload = null;
                    try { payload = Program.Json.Deserialize<Dictionary<string, object>>(line.Substring("PROGRESS ".Length).Trim()); } catch { }
                    if (payload != null) await RenderProgress(payload);
                }
            } catch { }
        }
        async Task RenderProgress(Dictionary<string, object> payload) { await RunPageScript("window.renderProgress&&window.renderProgress(" + Program.Json.Serialize(payload) + ")"); }
        async Task SendProgressDone(string action, bool ok, string error) {
            var payload = new Dictionary<string, object>(); payload["action"] = action; payload["done"] = true; payload["ok"] = ok;
            if (!ok) payload["error"] = error == null ? "" : error;
            await RenderProgress(payload);
        }
        async Task RunPageScript(string script) { try { if (home && browser.CoreWebView2 != null) await browser.CoreWebView2.ExecuteScriptAsync(script); } catch { } }
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
            for (int i = 0; i < 100; i++) { string value = await browser.CoreWebView2.ExecuteScriptAsync("location.origin==='http://127.0.0.1:6099'&&location.pathname.startsWith('/webui/plugins')&&document.body.innerText.length>20&&!!document.querySelector('#root')"); if (value == "true") { ready = true; break; } await Task.Delay(150); }
            if (!ready) throw new Exception("内嵌插件管理未能加载。");
            string output = Program.Argument(arguments, "--output") ?? Path.Combine(workspace, "data", "desktop-smoke"); Directory.CreateDirectory(output);
            using (var stream = File.Create(Path.Combine(output, "plugins.png"))) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            await OpenPage("/webui/extension"); ready = false;
            for (int i = 0; i < 100; i++) {
                string value = await browser.CoreWebView2.ExecuteScriptAsync("!!Array.from(document.querySelectorAll('iframe')).some(f=>{try{return !!f.contentDocument.querySelector('main.settings-main form [data-save]')}catch(e){return false}})");
                if (value == "true") { ready = true; break; } await Task.Delay(150);
            }
            if (!ready) throw new Exception("扩展工作台未加载最新页面，可能仍在使用旧资源缓存。");
            int navigations = 0;
            EventHandler<CoreWebView2NavigationStartingEventArgs> watchNavigation = delegate { navigations++; };
            browser.CoreWebView2.NavigationStarting += watchNavigation;
            try { await Task.Delay(13000); } finally { browser.CoreWebView2.NavigationStarting -= watchNavigation; }
            if (navigations != 0) throw new Exception("扩展页面重复跳转。");
            using (var stream = File.Create(Path.Combine(output, "extension.png"))) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            await OpenPage("/webui/qq_login"); await Task.Delay(1500);
            HideToTray(); if (Visible || !tray.Visible) throw new Exception("托盘收起失败。"); RestoreWindow(); if (!Visible) throw new Exception("托盘恢复失败。");
            await NavigateHome(); await Task.Delay(300); await RefreshStatus();
            string shown = await browser.CoreWebView2.ExecuteScriptAsync("location.origin==='http://127.0.0.1:6099'&&location.pathname.startsWith('/webui/')");
            if (shown != "true") throw new Exception("首页未打开 NapCat 原版 WebUI。");
            using (var stream = File.Create(Path.Combine(output, "home.png"))) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            WriteSmoke(true, "Native WebView2, current extension UI, 13-second navigation stability, authenticated plugin page, QQ login navigation and tray restore verified. No account switch, QQ message or model request."); quitting = true; Close();
        }
        void WriteSmoke(bool passed, string message) {
            string output = Program.Argument(arguments, "--output") ?? Path.Combine(workspace, "data", "desktop-smoke"); Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "result.json"), Program.Json.Serialize(new { passed = passed, message = message }), Encoding.UTF8); if (!passed) Environment.ExitCode = 1;
        }
    }
}
