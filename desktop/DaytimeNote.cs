using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DaytimeNative
{
    internal static class Program
    {
        internal static void Log(string message)
        {
            try
            {
                string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "boot.log");
                FileInfo info = new FileInfo(file);
                if (info.Exists && info.Length > 100000)
                {
                    File.Delete(file);
                }
                File.AppendAllText(
                    file,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine);
            }
            catch
            {
                // Diagnostics must never throw.
            }
        }

        internal const string ShowSignalName = @"Local\daytime-desktop-show";
        private const string InstanceMutexName = @"Local\daytime-desktop-instance";

        [STAThread]
        private static void Main()
        {
            bool firstInstance;
            using (Mutex instance = new Mutex(true, InstanceMutexName, out firstInstance))
            {
                if (!firstInstance)
                {
                    // Already running (maybe hidden in the tray): bring it back
                    // instead of opening a second note.
                    try
                    {
                        EventWaitHandle.OpenExisting(ShowSignalName).Set();
                    }
                    catch
                    {
                        // The first instance is still starting up.
                    }
                    return;
                }
                Run();
            }
        }

        private static void Run()
        {
            Log("main");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Log("creating form");
                Application.Run(new NoteForm());
                Log("form closed");
            }
            catch (Exception error)
            {
                Log("fatal: " + error);
                MessageBox.Show(
                    "daytime could not start.\n\n" + error.Message,
                    "daytime",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }

    /// <summary>
    /// A frameless, always-on-top note that hosts the daytime web app in
    /// WebView2 (the Edge runtime). No Electron, no bundled browser.
    /// </summary>
    internal sealed class NoteForm : Form
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "daytime-desktop";

        private readonly WebView2 browser = new WebView2();
        private readonly string root;
        private readonly string dataDirectory;
        private readonly string settingsPath;
        private NotifyIcon tray;
        private TcpListener listener;
        private int port;
        private bool alwaysOnTop;

        // The smallest size at which every row is readable without scrolling.
        private const int NoteWidth = 380;
        private const int NoteHeight = 720;

        private readonly bool screenshot;

        public NoteForm()
        {
            Program.Log("form constructor");
            screenshot = Array.IndexOf(Environment.GetCommandLineArgs(), "--screenshot") >= 0;
            root = ResolveRoot();
            dataDirectory = ResolveDataDirectory();
            settingsPath = Path.Combine(dataDirectory, "native.json");

            Text = "daytime";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(5, 5, 5);
            MinimumSize = new Size(NoteWidth, NoteHeight);
            MaximumSize = new Size(NoteWidth, NoteHeight);
            Size = new Size(NoteWidth, NoteHeight);
            TopMost = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;

            StartServer();
            BuildTray();
            Icon = LoadAppIcon(SystemInformation.IconSize);
            ApplySavedBounds();

            browser.Dock = DockStyle.Fill;
            browser.DefaultBackgroundColor = Color.FromArgb(5, 5, 5);
            Controls.Add(browser);
            Load += OnLoaded;

            // Desktop-note behaviour: whenever another window takes focus, drop
            // behind it instead of floating above everything.
            Deactivate += delegate
            {
                if (!alwaysOnTop)
                {
                    SendToBack();
                }
            };

            ListenForShowSignal();

            FormClosing += delegate
            {
                SaveBounds();
                if (tray != null) tray.Visible = false;
                StopServer();
            };
        }

        private async void OnLoaded(object sender, EventArgs e)
        {
            Program.Log("loaded, starting WebView2");
            try
            {
                string webData = screenshot
                    ? Path.Combine(Path.GetTempPath(), "daytime-preview-" + Process.GetCurrentProcess().Id)
                    : Path.Combine(dataDirectory, "webview");
                Directory.CreateDirectory(webData);
                CoreWebView2Environment environment =
                    await CoreWebView2Environment.CreateAsync(null, webData, null);
                Program.Log("environment ready");
                await browser.EnsureCoreWebView2Async(environment);
                Program.Log("webview ready");

                browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                browser.CoreWebView2.Settings.IsZoomControlEnabled = false;
                browser.CoreWebView2.PermissionRequested += OnPermissionRequested;
                browser.CoreWebView2.NewWindowRequested += OnNewWindow;
                browser.CoreWebView2.WebMessageReceived += OnWebMessage;
                browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                browser.CoreWebView2.Navigate("http://127.0.0.1:" + port + "/index.html?shell=desktop");
            }
            catch (Exception error)
            {
                Program.Log("webview failed: " + error);
                if (!screenshot)
                {
                    MessageBox.Show(
                        "daytime needs the Microsoft Edge WebView2 runtime.\n\n" + error.Message,
                        "daytime",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                Close();
            }
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Program.Log("navigation completed, success=" + e.IsSuccess);
            if (!screenshot)
            {
                return;
            }

            try
            {
                await Task.Delay(1600);
                string target = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "preview.png");
                using (FileStream stream = File.Create(target))
                {
                    await browser.CoreWebView2.CapturePreviewAsync(
                        CoreWebView2CapturePreviewImageFormat.Png, stream);
                }
                Program.Log("preview written to " + target);
            }
            catch (Exception error)
            {
                Program.Log("preview failed: " + error);
            }
            Close();
        }

        private void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
        {
            // Ask before reading the location â€” nothing is taken silently.
            if (e.PermissionKind != CoreWebView2PermissionKind.Geolocation)
            {
                return;
            }

            DialogResult answer = MessageBox.Show(
                "daytime would like to use your location to calculate sunrise and sunset.\n\n"
                    + "Your coordinates stay on this device â€” the nearest city is looked up "
                    + "from a list bundled with the app.",
                "Use your location?",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button1);

            e.State = answer == DialogResult.Yes
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;
        }

        private async void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // Keep Google's sign-in popup inside the app so it can post back to
            // the page that opened it.
            CoreWebView2Deferral deferral = e.GetDeferral();
            try
            {
                Form popup = new Form();
                popup.Text = "daytime";
                popup.Width = 480;
                popup.Height = 700;
                popup.StartPosition = FormStartPosition.CenterParent;
                popup.BackColor = Color.FromArgb(5, 5, 5);
                popup.Icon = Icon;
                popup.MinimizeBox = false;
                popup.MaximizeBox = false;

                WebView2 view = new WebView2();
                view.Dock = DockStyle.Fill;
                popup.Controls.Add(view);
                popup.Show(this);

                await view.EnsureCoreWebView2Async(browser.CoreWebView2.Environment);
                // Google closes the popup when the sign-in flow finishes.
                view.CoreWebView2.WindowCloseRequested += delegate { popup.Close(); };
                e.NewWindow = view.CoreWebView2;
            }
            catch
            {
                e.Handled = true;
            }
            finally
            {
                deferral.Complete();
            }
        }

        /* ---------------------------------------------------------------- */
        /* Window behaviour                                                  */
        /* ---------------------------------------------------------------- */

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message;
            try
            {
                message = e.TryGetWebMessageAsString();
            }
            catch
            {
                return;
            }

            if (message == "drag")
            {
                // Start a native window move with the current cursor position.
                ReleaseCapture();
                SendMessage(Handle, 0x00A1, (IntPtr)0x0002, IntPtr.Zero);
            }
            else if (message == "back")
            {
                // Hide to the tray. (Minimizing a tool window would leave a
                // small title stub above the taskbar.)
                SaveBounds();
                Hide();
            }
            else if (message == "quit")
            {
                Close();
            }
        }

        private void ListenForShowSignal()
        {
            EventWaitHandle signal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowSignalName);
            Thread thread = new Thread(delegate()
            {
                while (true)
                {
                    signal.WaitOne();
                    if (IsDisposed) return;
                    if (!IsHandleCreated) continue;
                    try
                    {
                        BeginInvoke((MethodInvoker)RestoreWindow);
                    }
                    catch (InvalidOperationException)
                    {
                        return; // Form is closing.
                    }
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        /// <summary>
        /// A tool window: no taskbar button and not listed in Alt+Tab or Task
        /// View, so the note stays a quiet desktop object. It is reached from
        /// the tray icon instead.
        /// </summary>
        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_TOOLWINDOW = 0x00000080;
                const int WS_EX_APPWINDOW = 0x00040000;
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= WS_EX_TOOLWINDOW;
                parameters.ExStyle &= ~WS_EX_APPWINDOW;
                return parameters;
            }
        }

        private void RestoreWindow()
        {
            WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        private void BuildTray()
        {
            tray = new NotifyIcon();
            tray.Icon = LoadAppIcon(SystemInformation.SmallIconSize);
            tray.Text = "daytime";
            tray.Visible = true;
            tray.DoubleClick += delegate { RestoreWindow(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Show daytime", null, delegate { RestoreWindow(); });
            menu.Items.Add("Hide daytime", null, delegate { Hide(); });

            ToolStripMenuItem pin = new ToolStripMenuItem("Always on top");
            pin.Checked = alwaysOnTop;
            pin.Click += delegate
            {
                alwaysOnTop = !alwaysOnTop;
                TopMost = alwaysOnTop;
                pin.Checked = alwaysOnTop;
                SaveBounds();
            };
            menu.Items.Add(pin);

            ToolStripMenuItem login = new ToolStripMenuItem("Start with Windows");
            login.Checked = IsStartupEnabled();
            login.Click += delegate
            {
                SetStartup(!IsStartupEnabled());
                login.Checked = IsStartupEnabled();
            };
            menu.Items.Add(login);

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Reset size and position", null, delegate
            {
                Size = new Size(400, 640);
                Rectangle area = Screen.PrimaryScreen.WorkingArea;
                Location = new Point(
                    area.Left + (area.Width - Width) / 2,
                    area.Top + (area.Height - Height) / 2);
                SaveBounds();
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit daytime", null, delegate { Close(); });

            tray.ContextMenuStrip = menu;
        }

        /// <summary>
        /// daytime.ico is compiled into the exe twice: as the Win32 icon that
        /// Explorer, Start and shortcuts show, and as a managed resource so the
        /// tray and window get the frame drawn for their exact size.
        /// </summary>
        private static Icon LoadAppIcon(Size size)
        {
            try
            {
                using (Stream stream = typeof(NoteForm).Assembly.GetManifestResourceStream("daytime.ico"))
                {
                    if (stream != null)
                    {
                        return new Icon(stream, size);
                    }
                }
            }
            catch
            {
                // Fall through to the default icon.
            }
            return SystemIcons.Application;
        }

        /* ---------------------------------------------------------------- */
        /* Window state                                                      */
        /* ---------------------------------------------------------------- */

        private static string ResolveRoot()
        {
            // Works both in the repository (desktop -> ..) and in an installed
            // copy where the web files sit next to the exe.
            string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string[] candidates = new string[]
            {
                baseDirectory,
                Path.Combine(baseDirectory, "app"),
                Path.GetFullPath(Path.Combine(baseDirectory, "..")),
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(Path.Combine(candidate, "index.html")))
                {
                    return candidate;
                }
            }
            return baseDirectory;
        }

        private static string ResolveDataDirectory()
        {
            // Prefer the roaming profile, but fall back next to the app when the
            // process is not allowed to write there (sandboxes, locked-down PCs).
            try
            {
                string preferred = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "daytime-desktop");
                Directory.CreateDirectory(preferred);
                return preferred;
            }
            catch
            {
                string fallback = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }

        private void ApplySavedBounds()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int x = area.Left + (area.Width - NoteWidth) / 2;
            int y = area.Top + (area.Height - NoteHeight) / 2;

            try
            {
                if (File.Exists(settingsPath))
                {
                    string[] parts = File.ReadAllText(settingsPath).Split(',');
                    if (parts.Length >= 2)
                    {
                        x = int.Parse(parts[0]);
                        y = int.Parse(parts[1]);
                    }
                }
            }
            catch
            {
                // Corrupt settings: use the centred default.
            }

            if (x < area.Left - 40 || x > area.Right - 80)
            {
                x = area.Left + (area.Width - NoteWidth) / 2;
            }
            if (y < area.Top - 40 || y > area.Bottom - 80)
            {
                y = area.Top + (area.Height - NoteHeight) / 2;
            }

            Bounds = new Rectangle(x, y, NoteWidth, NoteHeight);
            TopMost = false;
            alwaysOnTop = false;
        }

        private void SaveBounds()
        {
            try
            {
                File.WriteAllText(
                    settingsPath,
                    Bounds.X + "," + Bounds.Y + "," + Bounds.Width + "," + Bounds.Height + "," + (alwaysOnTop ? "1" : "0"));
            }
            catch
            {
                // Position is a nicety.
            }
        }

        private bool IsStartupEnabled()
        {
            using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey))
            {
                return key != null && key.GetValue(RunValue) != null;
            }
        }

        private void SetStartup(bool enabled)
        {
            using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (key == null) return;
                if (enabled) key.SetValue(RunValue, "\"" + Application.ExecutablePath + "\"");
                else key.DeleteValue(RunValue, false);
            }
        }

        /* ---------------------------------------------------------------- */
        /* Tiny static server for the web build                              */
        /* ---------------------------------------------------------------- */

        private void StartServer()
        {
            try
            {
                listener = new TcpListener(IPAddress.Loopback, 4173);
                listener.Start();
            }
            catch
            {
                listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
            }

            port = ((IPEndPoint)listener.LocalEndpoint).Port;
            Thread thread = new Thread(ServeLoop);
            thread.IsBackground = true;
            thread.Start();
        }

        private void StopServer()
        {
            try
            {
                if (listener != null) listener.Stop();
            }
            catch
            {
                // Already stopped.
            }
        }

        private void ServeLoop()
        {
            while (true)
            {
                TcpClient client;
                try
                {
                    client = listener.AcceptTcpClient();
                }
                catch
                {
                    return;
                }
                ThreadPool.QueueUserWorkItem(delegate(object state) { Serve((TcpClient)state); }, client);
            }
        }

        private void Serve(TcpClient client)
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                string requestLine = reader.ReadLine();
                string host = null;
                while (true)
                {
                    string line = reader.ReadLine();
                    if (line == null || line.Length == 0) break;
                    if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase))
                    {
                        host = line.Substring(5).Trim();
                    }
                }

                if (string.IsNullOrEmpty(requestLine))
                {
                    return;
                }

                string[] parts = requestLine.Split(' ');
                string target = parts.Length > 1 ? parts[1] : "/";
                int query = target.IndexOf('?');
                if (query >= 0) target = target.Substring(0, query);
                try
                {
                    target = Uri.UnescapeDataString(target);
                }
                catch
                {
                    target = "";
                }

                // Only the web app's own files, and only for loopback Host
                // headers: the repository also holds keystores, OAuth secrets
                // and browser profiles, and a DNS-rebinding page must not be
                // able to read anything here.
                string relative = IsLoopbackHost(host) ? PublicPath(target) : null;
                string file = relative == null
                    ? null
                    : Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));

                string status;
                string contentType;
                byte[] body;

                if (file == null)
                {
                    status = "404 Not Found";
                    contentType = "text/plain";
                    body = Encoding.UTF8.GetBytes("Not found");
                }
                else if (File.Exists(file))
                {
                    status = "200 OK";
                    contentType = MimeType(file);
                    body = File.ReadAllBytes(file);
                }
                else
                {
                    status = "404 Not Found";
                    contentType = "text/plain";
                    body = Encoding.UTF8.GetBytes("Not found");
                }

                string header = "HTTP/1.1 " + status + "\r\n"
                    + "Content-Type: " + contentType + "\r\n"
                    + "Content-Length: " + body.Length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";

                byte[] head = Encoding.ASCII.GetBytes(header);
                stream.Write(head, 0, head.Length);
                stream.Write(body, 0, body.Length);
            }
        }

        private static readonly string[] PublicFiles = new string[]
        {
            // Keep in sync with public-files.js and $webFiles in daytime.ps1.
            "index.html", "styles.css", "app.js", "core.js", "cities.js",
            "config.js", "logo.svg",
        };

        private static string PublicPath(string target)
        {
            if (string.IsNullOrEmpty(target)) return null;
            string relative = target.TrimStart('/');
            if (relative.Length == 0) relative = "index.html";
            if (relative.IndexOf('\\') >= 0 || relative.IndexOf('\0') >= 0) return null;
            foreach (string segment in relative.Split('/'))
            {
                if (segment.Length == 0 || segment.StartsWith(".")) return null;
            }
            return Array.IndexOf(PublicFiles, relative) >= 0 ? relative : null;
        }

        private static bool IsLoopbackHost(string host)
        {
            if (string.IsNullOrEmpty(host)) return false;
            string name = host.ToLowerInvariant();
            if (name.StartsWith("["))
            {
                int end = name.IndexOf(']');
                name = end > 0 ? name.Substring(0, end + 1) : name;
            }
            else
            {
                int colon = name.IndexOf(':');
                if (colon >= 0) name = name.Substring(0, colon);
            }
            return name == "localhost" || name == "127.0.0.1" || name == "[::1]";
        }

        private static string MimeType(string file)
        {
            switch (Path.GetExtension(file).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".md": return "text/markdown; charset=utf-8";
                default: return "application/octet-stream";
            }
        }
    }
}
