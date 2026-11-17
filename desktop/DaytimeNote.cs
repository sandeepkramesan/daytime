using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
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

            // Desktop-note behaviour: other apps cover the note normally when
            // they are activated, but the note never drops behind the desktop,
            // so clicking the desktop or pressing Win+D leaves it in place.
            HandleCreated += delegate { WatchDesktop(); };

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
                browser.CoreWebView2.Navigate("http://127.0.0.1:" + port + "/index.html?shell=desktop&region=" + HomeRegion());
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
            else if (message == "signout")
            {
                // Forget the Google session held in this WebView profile, so the
                // next sign-in asks which account to use. The app itself keeps
                // its settings in localStorage, which this does not touch.
                try
                {
                    browser.CoreWebView2.CookieManager.DeleteAllCookies();
                }
                catch (Exception error)
                {
                    Program.Log("sign out: " + error.Message);
                }
            }
        }

        /* ---------------------------------------------------------------- */
        /* Staying on the desktop                                            */
        /* ---------------------------------------------------------------- */

        private delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr window,
            int objectId, int childId, uint thread, uint time);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module,
            WinEventProc callback, uint process, uint thread, uint flags);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hook);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder name, int length);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const int SW_SHOWNOACTIVATE = 4;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

        private WinEventProc foregroundCallback; // Held in a field so the GC keeps it alive.
        private IntPtr foregroundHook = IntPtr.Zero;
        private System.Windows.Forms.Timer desktopTimer;
        private int desktopPasses;

        /// <summary>
        /// When the desktop itself becomes the foreground window (a click on
        /// the wallpaper, Win+D, "Show desktop"), lift the note back above it.
        /// Explorer animates Win+D, so the lift is repeated briefly.
        /// </summary>
        private void WatchDesktop()
        {
            if (foregroundHook != IntPtr.Zero) return;

            desktopTimer = new System.Windows.Forms.Timer();
            desktopTimer.Interval = 200;
            desktopTimer.Tick += delegate
            {
                KeepAboveDesktop();
                desktopPasses--;
                if (desktopPasses <= 0) desktopTimer.Stop();
            };

            foregroundCallback = delegate(IntPtr hook, uint eventType, IntPtr window,
                int objectId, int childId, uint thread, uint time)
            {
                if (!IsDesktopWindow(window)) return;
                KeepAboveDesktop();
                desktopPasses = 4;
                desktopTimer.Start();
            };
            foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, foregroundCallback, 0, 0, WINEVENT_OUTOFCONTEXT);

            FormClosed += delegate
            {
                if (foregroundHook != IntPtr.Zero) UnhookWinEvent(foregroundHook);
                foregroundHook = IntPtr.Zero;
                desktopTimer.Stop();
            };
        }

        private static bool IsDesktopWindow(IntPtr window)
        {
            if (window == IntPtr.Zero) return false;
            StringBuilder name = new StringBuilder(64);
            GetClassName(window, name, name.Capacity);
            string value = name.ToString();
            return value == "WorkerW" || value == "Progman";
        }

        private void KeepAboveDesktop()
        {
            // Hidden to the tray on purpose: leave it there.
            if (!Visible || IsDisposed) return;
            if (IsIconic(Handle)) ShowWindow(Handle, SW_SHOWNOACTIVATE);
            // Topmost and straight back: ends up first among normal windows,
            // above the desktop, without taking focus. Pinned notes stay topmost.
            SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
            if (!alwaysOnTop)
            {
                SetWindowPos(Handle, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
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
                Match holiday = IsLoopbackHost(host) ? HolidayPath.Match(target) : Match.Empty;

                if (holiday.Success)
                {
                    body = ReadHolidays(holiday.Groups[1].Value);
                    if (body != null)
                    {
                        status = "200 OK";
                        contentType = "text/calendar; charset=utf-8";
                    }
                    else
                    {
                        status = "502 Bad Gateway";
                        contentType = "text/plain";
                        body = Encoding.UTF8.GetBytes("Holiday calendar unavailable");
                    }
                }
                else if (file == null)
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

        // Google's public holiday calendars send no CORS headers, so the page
        // asks for /holidays/<id>.ics and the note fetches that one fixed
        // Google URL, keeping a copy for a week (and using it when offline).
        // Keep in sync with HOLIDAY_PATH in public-files.js.
        private static readonly Regex HolidayPath = new Regex(@"^/holidays/(en\.[a-z_]{2,24})\.ics\z");
        private static readonly object HolidayLock = new object();

        private byte[] ReadHolidays(string id)
        {
            string folder = Path.Combine(dataDirectory, "holidays");
            string cached = Path.Combine(folder, id + ".ics");
            lock (HolidayLock)
            {
                FileInfo info = new FileInfo(cached);
                if (info.Exists && DateTime.UtcNow - info.LastWriteTimeUtc < TimeSpan.FromDays(7))
                {
                    return File.ReadAllBytes(cached);
                }
                try
                {
                    byte[] fresh = DownloadHolidays(id);
                    Directory.CreateDirectory(folder);
                    File.WriteAllBytes(cached, fresh);
                    return fresh;
                }
                catch (Exception error)
                {
                    Program.Log("holidays " + id + ": " + error.Message);
                    return info.Exists ? File.ReadAllBytes(cached) : null;
                }
            }
        }

        private static byte[] DownloadHolidays(string id)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            string url = "https://calendar.google.com/calendar/ical/"
                + Uri.EscapeDataString(id + "#holiday@group.v.calendar.google.com")
                + "/public/basic.ics";
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 15000;
            request.ReadWriteTimeout = 15000;
            request.UserAgent = "daytime";
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (Stream input = response.GetResponseStream())
            using (MemoryStream copy = new MemoryStream())
            {
                byte[] buffer = new byte[16384];
                int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    copy.Write(buffer, 0, read);
                    if (copy.Length > 4 * 1024 * 1024) throw new InvalidDataException("holiday calendar too large");
                }
                byte[] bytes = copy.ToArray();
                string start = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 32));
                if (!start.StartsWith("BEGIN:VCALENDAR")) throw new InvalidDataException("not a calendar");
                return bytes;
            }
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int GetUserDefaultGeoName(StringBuilder geoName, int geoNameCount);

        /// <summary>Windows' "Country or region" setting as an ISO code, for public holidays.</summary>
        private static string HomeRegion()
        {
            try
            {
                StringBuilder name = new StringBuilder(16);
                if (GetUserDefaultGeoName(name, name.Capacity) > 0 && Regex.IsMatch(name.ToString(), "^[A-Za-z]{2}$"))
                {
                    return name.ToString().ToUpperInvariant();
                }
            }
            catch
            {
                // Older Windows: fall back to the regional format.
            }
            try
            {
                return RegionInfo.CurrentRegion.TwoLetterISORegionName;
            }
            catch
            {
                return "";
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
