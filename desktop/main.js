"use strict";

/*
 * daytime desktop — a frameless, always-on-top sticky note.
 *
 * It serves the project over http://127.0.0.1:4173 (a secure origin, so the
 * service worker and location API behave like the browser version), then loads
 * it into a borderless window that can be dragged from the header or the date
 * area. Position, size and pin state are remembered in the user data folder.
 *
 * Flags:
 *   --hidden       start in the tray only
 *   --screenshot   save screenshot.png and quit
 *   --smoke        create the window, print ok, quit
 *   --reset        forget the saved window position and size
 *   --transparent  use a transparent window (opt-in; opaque is the safe default)
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  shell,
  globalShortcut,
} = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { publicPath, isAllowedHost } = require("../public-files.js");

if (!app || typeof app.whenReady !== "function") {
  console.error(
    "daytime desktop was started with Node instead of Electron.\n" +
      "Run `npm start` inside the desktop folder (it clears ELECTRON_RUN_AS_NODE for you)."
  );
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const ICON = path.join(ROOT, "icons", "icon-512.png");

// Chromium refuses to start if its profile folder cannot be written. That
// happens when the app is launched from a sandboxed shell, so fall back to a
// data folder next to the app instead of failing with a breakpoint.
function resolveUserData() {
  const preferred = path.join(app.getPath("appData"), "daytime-desktop");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(__dirname, "data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

app.setPath("userData", resolveUserData());

const PREFERRED_PORT = 4173;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 640;

const SCREENSHOT = process.argv.includes("--screenshot");
const SMOKE = process.argv.includes("--smoke");
const START_HIDDEN = process.argv.includes("--hidden");
const RESET = process.argv.includes("--reset");
const TRANSPARENT = process.argv.includes("--transparent");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

const DESKTOP_CSS = `
  html, body {
    background: ${TRANSPARENT ? "transparent" : "#050505"} !important;
    padding: 0 !important;
    margin: 0 !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }
  body { display: block !important; }
  .widget {
    width: 100vw !important;
    height: 100vh !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    resize: none !important;
    border-radius: ${TRANSPARENT ? "18px" : "0"} !important;
  }
  .topbar { -webkit-app-region: drag; }
  .topbar a, .topbar button { -webkit-app-region: no-drag; }
  .date-hero { -webkit-app-region: drag; }
  .date-hero button { -webkit-app-region: no-drag; }
  .week, .agenda, .widget-footer, .sheet { -webkit-app-region: no-drag; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 6px; }
`;

let window = null;
let tray = null;
let server = null;
let port = 0;
let settings = { alwaysOnTop: true, openAtLogin: false, bounds: null };

const settingsFile = () => path.join(app.getPath("userData"), "window.json");
const logFile = () => path.join(app.getPath("userData"), "desktop.log");

function logLine(message) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > 200_000) fs.truncateSync(file, 0);
    } catch {
      /* No log yet. */
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* Logging must never crash the app. */
  }
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    if (parsed && typeof parsed === "object") settings = { ...settings, ...parsed };
  } catch {
    /* First run. */
  }
  if (RESET) {
    settings.bounds = null;
    saveSettings();
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    /* Persisting the window position is a nicety. */
  }
}

/* ------------------------------------------------------------------ */
/* Local server                                                        */
/* ------------------------------------------------------------------ */

function serve(request, response) {
  // Only the web app's own files, and only for loopback Host headers: the
  // repository also holds keystores, OAuth secrets and browser profiles.
  if (!isAllowedHost(request.headers.host)) {
    response.writeHead(421, { "Content-Type": "text/plain" }).end("Misdirected request");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  const relative = publicPath(pathname);
  if (!relative) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const file = path.join(ROOT, relative);

  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(file).pipe(response);
  });
}

function startServer() {
  return new Promise((resolve) => {
    const listen = (wantedPort, fallback) => {
      const candidate = http.createServer(serve);
      candidate.once("error", (error) => {
        if (fallback && error.code === "EADDRINUSE") {
          listen(0, false);
        } else {
          logLine(`server error: ${error.message}`);
          resolve(0);
        }
      });
      candidate.listen(wantedPort, "127.0.0.1", () => {
        server = candidate;
        resolve(candidate.address().port);
      });
    };
    listen(PREFERRED_PORT, true);
  });
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function computeBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = settings.bounds;

  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  let x;
  let y;

  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    width = Math.round(saved.width);
    height = Math.round(saved.height);
    x = saved.x;
    y = saved.y;
  }

  width = Math.max(320, Math.min(width, area.width));
  height = Math.max(420, Math.min(height, area.height));

  // A saved "almost full screen" size is almost always a compositor glitch,
  // not something the user chose.
  if (width > area.width * 0.94 || height > area.height * 0.94) {
    width = DEFAULT_WIDTH;
    height = DEFAULT_HEIGHT;
  }

  if (!Number.isFinite(x) || x < area.x - 40 || x > area.x + area.width - 80) {
    x = Math.round(area.x + (area.width - width) / 2);
  }
  if (!Number.isFinite(y) || y < area.y - 40 || y > area.y + area.height - 80) {
    y = Math.round(area.y + (area.height - height) / 2);
  }

  return { x, y, width, height };
}

function loadErrorPage(reason) {
  const html = `<!doctype html><meta charset="utf-8">
<style>
  body { background:#050505; color:#f5f5f5; font:13px/1.7 system-ui, sans-serif; padding:26px; }
  h1 { font-size:16px; font-weight:500; margin:0 0 10px; }
  p { color:#8f8f8f; margin:0 0 10px; }
  code { background:#181818; padding:2px 6px; border-radius:6px; color:#f5f5f5; }
</style>
<h1>daytime couldn't open the page</h1>
<p>${String(reason).replace(/[<>&]/g, "")}</p>
<p>Start it with <code>npm start</code> inside the <code>desktop</code> folder.</p>
<p>Log: <code>${logFile()}</code></p>`;
  window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

async function createWindow() {
  port = await startServer();
  if (!port) {
    app.quit();
    return;
  }

  const bounds = computeBounds();
  logLine(
    `create window transparent=${TRANSPARENT} port=${port} bounds=${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}`
  );

  window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 420,
    frame: false,
    transparent: TRANSPARENT,
    backgroundColor: TRANSPARENT ? "#00000000" : "#050505",
    hasShadow: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop,
    show: false,
    skipTaskbar: false,
    title: "daytime",
    icon: ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (window.setMenuBarVisibility) window.setMenuBarVisibility(false);
  window.setAlwaysOnTop(settings.alwaysOnTop, "floating");
  window.loadURL(`http://127.0.0.1:${port}/`);

  window.webContents.on("did-finish-load", () => {
    logLine("page loaded");
    window.webContents.insertCSS(DESKTOP_CSS).catch(() => {});
  });

  window.webContents.on(
    "did-fail-load",
    (event, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      logLine(`load failed ${code} ${description} ${validatedURL}`);
      loadErrorPage(`${code} ${description}`);
    }
  );

  window.webContents.on("render-process-gone", (event, details) => {
    logLine(`render process gone: ${details.reason}`);
  });

  const showFallback = setTimeout(() => {
    if (window && !window.isDestroyed() && !window.isVisible() && !START_HIDDEN && !SMOKE) {
      logLine("showing window on fallback timer");
      window.show();
    }
  }, 3000);

  window.once("ready-to-show", async () => {
    clearTimeout(showFallback);
    logLine("ready to show");

    if (!START_HIDDEN && !SMOKE) window.show();

    if (SCREENSHOT) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const image = await window.webContents.capturePage();
      const target = path.join(__dirname, "screenshot.png");
      fs.writeFileSync(target, image.toPNG());
      logLine(`screenshot written to ${target}`);
      app.quit();
    } else if (SMOKE) {
      console.log("daytime desktop: window created ok");
      setTimeout(() => app.quit(), 600);
    }
  });

  const remember = () => {
    if (!window || window.isDestroyed()) return;
    settings.bounds = window.getBounds();
    saveSettings();
  };
  window.on("moved", remember);
  window.on("resized", remember);
  window.on("show", refreshTray);
  window.on("hide", refreshTray);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://accounts.google.com") || url.startsWith("https://accounts.youtube.com")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 480,
          height: 700,
          parent: window,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`) && !url.startsWith("data:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  window.webContents.on("context-menu", () => {
    buildMenu().popup({ window });
  });

  window.on("closed", () => {
    window = null;
  });
}

function toggleWindow() {
  if (!window) {
    createWindow();
    return;
  }
  if (window.isVisible()) {
    window.hide();
  } else {
    window.show();
    window.focus();
  }
  refreshTray();
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu());
}

function buildMenu() {
  const visible = Boolean(window && window.isVisible());
  return Menu.buildFromTemplate([
    { label: visible ? "Hide daytime" : "Show daytime", click: toggleWindow },
    { type: "separator" },
    {
      label: "Always on top",
      type: "checkbox",
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        saveSettings();
        if (window) window.setAlwaysOnTop(item.checked, "floating");
        refreshTray();
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: settings.openAtLogin,
      click: (item) => {
        settings.openAtLogin = item.checked;
        saveSettings();
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
        refreshTray();
      },
    },
    {
      label: "Reset size and position",
      click: () => {
        settings.bounds = null;
        saveSettings();
        if (window) {
          const area = screen.getPrimaryDisplay().workArea;
          window.setSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
          window.setPosition(
            Math.round(area.x + (area.width - DEFAULT_WIDTH) / 2),
            Math.round(area.y + (area.height - DEFAULT_HEIGHT) / 2)
          );
        }
      },
    },
    { label: "Open log", click: () => shell.openPath(logFile()) },
    { type: "separator" },
    { label: "Quit daytime", click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("daytime");
  tray.setContextMenu(buildMenu());
  tray.on("click", toggleWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    createTray();
    createWindow();
    globalShortcut.register("CommandOrControl+Alt+D", toggleWindow);
    // Escape hatch: works even if the window is stuck off-screen or black.
    globalShortcut.register("CommandOrControl+Alt+Q", () => app.quit());
  });

  app.on("window-all-closed", () => app.quit());

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (server) server.close();
  });
}
