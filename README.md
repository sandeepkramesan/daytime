# daytime

A clock and calendar app in the Nothing design language: black glass, thin lines, big light numerals, one red accent.

This repository ships three builds of the same idea:

| | What it is | Where |
| --- | --- | --- |
| **Android app** | A real app with a home-screen widget: clock, alarms, timer, stopwatch, world clock, month calendar with agenda. Reads the calendar already on your phone — no account, no network. | [`android/`](./android) · build with `python android/build.py --release` |
| **Desktop sticky note** | A frameless, always-on-top window for Windows that floats above other windows like a note. Tray icon, drag anywhere, remembers its spot. | [`desktop/`](./desktop) |
| **Web app** | The same look in a browser, with read-only Google Calendar + Tasks over OAuth. Installable as a PWA. | repository root |

---

## Install the Android app

Build the release-signed APK first (see [Build the Android app from source](#build-the-android-app-from-source)). `android/build/` is git-ignored, so a fresh clone has no APK; publish built APKs as release assets rather than committing them. Then:

```powershell
adb install -r android/build/daytime-release.apk
```

Or copy `android/build/daytime-release.apk` to the phone and open it — Android will ask you to allow installs from that app the first time.

It is signed with a **release key** (`CN=daytime`), not the Android debug certificate. The debug certificate is what makes Play Protect treat a sideloaded build as a malicious test app; the release build avoids that.

### If Play Protect blocks it anyway

Sideloaded apps have no Play reputation, so Android may still warn. In order of least friction:

1. **Use adb.** `adb install -r android/build/daytime-release.apk` usually skips the installer's shield dialog.
2. **Install anyway.** On the blocked dialog tap **More details** → **Install anyway** (some builds hide this behind *Settings → Apps → Special access → Install unknown apps*).
3. **Pause Play Protect briefly.** Play Store → profile picture → **Play Protect** → gear icon → turn off **Scan apps with Play Protect** → install → turn it back on.
4. **Advanced Protection** (Android 16, Pixel): if that is enabled on the phone, sideloading is blocked outright. Turn Advanced Protection off while installing, then back on.

If an older copy is already installed, remove it first — a debug-signed and a release-signed build cannot replace each other:

```powershell
adb uninstall com.daytime.app
```

Worth knowing while you decide: the app declares **no `INTERNET` permission at all**, so it cannot upload anything. You can confirm that in **Settings → Apps → daytime → Permissions**.

### Add the home-screen widget

1. Long-press an empty spot on the home screen.
2. **Widgets** → **daytime**.
3. Drag the 4×2 clock onto the screen and resize it from 2×2 to 4×2.
4. Tap the widget to open the app; grant calendar access there and the widget fills in with today's events.

The widget shows a live clock (a real `TextClock`, so it never needs a wake-up to tick), the date, sunrise/sunset when a location is saved, and the next three events.

### What's inside

**clock** — live local time, date, sunrise/sunset, next alarm, world clock for four cities.

**alarms** — add, edit, enable/disable and delete alarms; repeat on any weekday; a full-screen ringing screen with snooze and dismiss. Scheduled with `AlarmManager.setAlarmClock`, which survives Doze and shows the system alarm icon.

**measure** — timer (1/5/10/25 minute presets, pause and reset; the end is scheduled with AlarmManager so it still rings with the app closed) and a stopwatch.

**calendar** — month grid with a dot for days that have events, a day agenda underneath, and **add event** which hands off to the calendar app that is already installed (so daytime never needs write access).

**widget** — clock, date, sun and the next events.

### Permissions, and why

| Permission | Used for |
| --- | --- |
| `READ_CALENDAR` | Show today's events and the month grid. Read-only; daytime never writes events. |
| `ACCESS_COARSE_LOCATION` | Sunrise and sunset only, saved on the device. Optional. |
| `POST_NOTIFICATIONS` | Alarm and timer notifications. |
| `USE_FULL_SCREEN_INTENT` | Show the ringing alarm over the lock screen. |
| `VIBRATE` | Alarm vibration. |
| `USE_EXACT_ALARM` (and `SCHEDULE_EXACT_ALARM` on Android 12) | Ring alarms and the timer at the exact minute. If exact alarms are ever revoked, daytime falls back to a slightly less precise alarm instead of failing. |
| `RECEIVE_BOOT_COMPLETED` | Android forgets every scheduled alarm on reboot; daytime re-arms them (and a running timer) after a restart, an app update, or a clock/time-zone change. |

The app does **not** declare the `INTERNET` permission at all, so it cannot send anything anywhere. No accounts, no analytics, no network code.

---

## Build the Android app from source

No Gradle, no Maven, no network: the build script drives the SDK tools directly.

```powershell
python android/build.py              # daytime-debug.apk (debug certificate)
python android/build.py --release    # daytime-release.apk (release certificate)
```

Requirements: JDK 17 and the Android SDK with a platform and build-tools (`ANDROID_HOME` set). The script runs aapt2 → javac → d8 → zipalign → apksigner and verifies the signature.

`--release` creates a private keystore in `android/release.keystore` the first time and stores its password in `android/keystore.properties`; both are git-ignored. Keep them: Android only accepts updates to an app signed with the same key.

If you prefer Android Studio, open the `android/` folder — the manifest, resources and sources are a normal single-module layout.

Regenerate the launcher icon after changing the mark:

```powershell
python android/tools/make-icon.py
```

---

## Desktop sticky note

A frameless window that floats above everything else, like a note stuck to the screen. There are two builds; the native one is the reliable default.

### Native note (no Electron) — recommended

Run **`desktop\install-daytime.cmd`** once. It copies the app to `%LOCALAPPDATA%\daytime`, creates a **Start Menu** shortcut and a **Start with Windows** shortcut, then launches it. From then on it behaves like Sticky Notes: it keeps running independently of any terminal.

If a running copy locks the app folder, the installer simply installs into a fresh `app-<timestamp>` folder and repoints both shortcuts, so it never fails on a locked file.

The exe is a build output and is git-ignored, so on a fresh clone run **`desktop\native\build.cmd`** first (it uses the C# compiler that ships with Windows). Or double-click **`desktop\native\DaytimeNote.exe`** to try it without installing.

It is a 22 KB WinForms app that hosts the web build in **WebView2** (the Edge runtime that ships with Windows 11) and serves the files from a tiny built-in HTTP server on `http://127.0.0.1:4173`. Like `server.js` and the Electron build, that server only hands out the web app's own files (an allowlist) and only to loopback `Host` headers, so keystores, secrets, `.git` and browser profiles in the folder are never exposed.

- **Drag** it anywhere by the top bar or the big date.
- **Fixed size** of 380 × 720 — the smallest size where every row, tab and the footer are legible without scrolling. No resize grip.
- Scrollbars are hidden in the note; content scrolls with the trackpad if a day has many events.
- **Sits behind other windows**, like a desktop note: when another window takes focus the note drops behind it. *Always on top* in the tray pins it above instead.
- **—** minimises it to the tray; click the tray icon (or *Show daytime*) to bring it back.
- **×** closes it completely.
- No taskbar button — it lives in the tray only.
- Tray icon: show/hide, always on top, start with Windows, reset, quit.
- Frameless, remembers its position.
- Requires the Edge **WebView2 runtime** (preinstalled on Windows 11 and on most Windows 10 machines). If it is missing, the app says so instead of failing silently.
- Diagnostics: `desktop\native\boot.log`; rebuild with `desktop\native\build.cmd`.

> **SmartScreen:** the exe is unsigned, so the first launch shows *"Windows protected your PC"*. Choose **More info → Run anyway**. That is reputation, not a detection — signing would need a paid code-signing certificate. Windows does not ask again for that file.

### Electron version

```powershell
cd desktop
npm start
```

Same window, plus **Ctrl+Alt+D** (show/hide) and **Ctrl+Alt+Q** (quit). `--hidden`, `--screenshot` and `--reset` work as before.

> **Launch from Explorer or a normal terminal, not from an agent/sandbox terminal.** Both builds need to write a browser profile; a sandboxed shell can deny `%APPDATA%`, which makes Chromium die with `0x80000003` before any window appears. Both builds now fall back to a local `data\` folder, but a normal shell is still the safest bet.

If the note does not appear, check `desktop\launch.log` (Electron) or `desktop\native\boot.log` (native).

**No install at all:** open the hosted page in Edge and choose **Apps → Install this site as an app**. That gives a clean window without any runtime, though it cannot pin itself above other windows.

---

## Web app

```bash
npm start          # http://127.0.0.1:4173
npm test           # dependency-free tests (node:test)
```

The web build shows the date, a live clock, sunrise/sunset, a week strip (starting on your region's first day of the week) and the day's events from every calendar you show in Google Calendar, plus tasks due that day. Click **Connect Google Calendar** — if no client ID is configured it asks for one in-app, stores it in the browser, and never needs a file edit. A client ID pasted in the app overrides the default in [`config.js`](./config.js); **Use the default client ID** switches back.

Hosting it for other people? Put the client ID in `config.js` once. The Calendar scopes are *sensitive* in Google's terms: until the OAuth app is [verified](https://support.google.com/cloud/answer/13463073), visitors see an "unverified app" warning, and while the consent screen is in **Testing** only the listed test users (up to 100) can sign in.

Google access tokens last about an hour and the browser flow has no refresh token. When a session is about to expire, the next click (a day, refresh, retry) asks Google for a new token without the consent screen instead of showing the connect dialog.

Google Cloud setup (once, ~3 minutes):

1. Enable **Google Calendar API** and **Google Tasks API** in a project.
2. On the OAuth consent screen, add the scopes `calendar.events.readonly`, `calendar.calendarlist.readonly` and `tasks.readonly`.
3. Create an **OAuth client ID → Web application**.
4. Add your origins (`http://localhost:4173`, and your HTTPS host).
5. Paste the client ID into the widget, or into `config.js`. The web app never needs the client *secret*: don't keep the downloaded `client_secret_*.json` in this folder.

Full details, hosting notes and troubleshooting are in the [web guide](#web-app-details) below.

---

## Privacy

- **Android:** no `INTERNET` permission, no account, no analytics. Calendar is read-only, coordinates stay in `SharedPreferences`, and alarms live on the device.
- **Web:** OAuth tokens live in memory and die with the tab; only the client ID (public) is stored; events are never persisted. The service worker caches the app shell, not your data. A Content-Security-Policy limits scripts to this site and Google sign-in, and network requests to the Google APIs daytime reads.
- **Location:** asked only when you tap **Use location**. A copy rounded to ~1 km is remembered in the browser so sunrise/sunset work next time; **About → Forget location** removes it. The nearest city is looked up in `cities.js`, a bundled extract of [GeoNames](https://www.geonames.org/) `cities15000` (CC BY 4.0), which is only downloaded once a location is known. Nothing is sent to a geocoding service.
- **Fonts:** no web fonts are fetched. The web build uses Inter if it is installed, otherwise the platform sans (Segoe UI, Roboto, Helvetica). The Android app uses the system sans (Roboto on Nothing OS).

---

## Design

- `#050505` background, `#111` surfaces, `#242424` hairlines.
- `#F5F5F5` type, `#93A3B4` for the quiet blue-grey metadata, `#8F8F8F` for secondary copy.
- One accent: `#ED1C2E`, used as a single dot — never as a large fill.
- `sans-serif-thin` / `sans-serif-light` for numerals, lowercase labels with wide tracking, generous spacing, no shadows.

---

## Project layout

```
android/
  app/src/main/            manifest, resources, Java sources
    java/com/daytime/app/  MainActivity + clock/alarms/measure/calendar sections
  build.py                 APK build without Gradle
  tools/make-icon.py       adaptive icon foreground from the shared mark
desktop/
  main.js                  Electron window, tray, drag, window state
  package.json             electron dev dependency and start script
index.html, styles.css     web app shell
app.js, core.js            web behaviour and pure date/sun helpers
cities.js                  offline nearest-city list (GeoNames, lazy-loaded)
config.js                  optional deployer config (client ID, week start, location)
server.js                  local dev server
public-files.js            allowlist of files the local servers may serve
sw.js, manifest.webmanifest
tests/                     node:test cases (no browser needed)
tools/make-icons.py        web icons + shared mark geometry
tools/sync-version.js      copies package.json's version into app.js and sw.js
```

---

## Web app details

### Hosting

Any static host works. Use **HTTPS** (required for Google sign-in, the service worker and geolocation), then add the exact origin under **Authorized JavaScript origins**. Deploy only the files listed in [`public-files.js`](./public-files.js) plus `icons/`. Before each deploy, bump the version so the service-worker cache refreshes:

```bash
npm version patch --no-git-tag-version
npm run sync-version
```

`npm test` fails if `app.js` or `sw.js` disagree with `package.json`.

The dev server (`npm start`) only serves those files, and only to `localhost`, `127.0.0.1` or `[::1]`. To test from a phone on your network, start it with `HOST=0.0.0.0 ALLOWED_HOSTS=<your PC's LAN IP>`.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Google sign-in couldn't load" | Allow `accounts.google.com`; press Try again |
| 403 from Google | Enable the Calendar and Tasks APIs for that project |
| `origin_mismatch` | Add scheme + host + port exactly to Authorized JavaScript origins |
| "access expired" | Tokens last about an hour; reconnect |
| Sunrise stays `--:--` | Allow location, or set `location` in `config.js` |
| Old version after deploy | Reload once; confirm you ran `npm run sync-version` |
| Only the primary calendar shows | Reconnect and allow access to the list of your Google calendars |
| "Google hasn't verified this app" | Expected until the OAuth app is verified; listed test users can choose Advanced → continue |

---

## Licence

MIT. Not affiliated with Nothing Technology Limited; the palette and restraint are a tribute, not a copy.
