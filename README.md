# daytime

A desktop sticky note for Windows: live clock, date, sunrise and sunset, a week strip, and the day's Google Calendar events and tasks. Nothing design language — black glass, thin lines, big light numerals, one red accent.

It is a small (about 100 KB) native app (WinForms + the Edge **WebView2** runtime that ships with Windows 10/11). No Electron, no Node, no installer framework.

---

## Run it

Double-click **`daytime.cmd`**.

The first run compiles `desktop\DaytimeNote.exe` with the C# compiler that ships with Windows, then starts the note. Later runs start it straight away and rebuild only when `desktop\DaytimeNote.cs` has changed. Running it again while the note is open just brings the note to the front.

From a terminal, the same entry point takes a command:

| Command | npm equivalent | What it does |
| --- | --- | --- |
| `daytime` | `npm start` | Build if needed, then start the note |
| `daytime install` | `npm run install-app` | Copy to `%LOCALAPPDATA%\daytime`, add a Start Menu shortcut, start with Windows, launch |
| `daytime uninstall` | `npm run uninstall-app` | Remove the installed copy, its shortcut and the startup entry |
| `daytime build` | `npm run build` | Rebuild `desktop\DaytimeNote.exe` |

Options: `-NoStartup` and `-NoLaunch` for `install`; `-Fresh` for `install` or `uninstall` also deletes the WebView2 profile (Google sign-in and cache, in `%APPDATA%\daytime-desktop`).

Use **`daytime install`** for everyday use: the installed copy no longer depends on this folder, and re-running it updates the installed copy in place.

> **SmartScreen:** the exe is unsigned, so the first launch may show *"Windows protected your PC"*. Choose **More info → Run anyway**. Windows does not ask again for that file.

Requirements: Windows 10 or 11 with the **WebView2 runtime** (preinstalled on Windows 11 and most Windows 10 machines; the app says so if it is missing) and .NET Framework 4 (built into Windows). Node.js is only needed for `npm test` and `npm run dev`.

## Using the note

- **Drag** it by the top bar or the big date. It remembers its position.
- **Stays on the desktop until you close it.** Clicking the desktop, Win+D or *Show desktop* leaves it in place. Other apps cover it while you use them; *Always on top* in the tray keeps it above them too.
- It has no taskbar button and stays out of Alt+Tab; reach it from the tray icon.
- **—** hides it to the tray; click the tray icon to bring it back. **×** quits.
- Tray menu: show/hide, always on top, start with Windows, reset position, quit.
- **‹ ›** move a week at a time; click a day to see its agenda; **Today** jumps back.
- **Use location** calculates sunrise and sunset on the device.
- Diagnostics: `desktop\boot.log` (or `boot.log` next to the installed exe).

---

## Google Calendar

Click **Connect Google Calendar** and sign in. Access is **read-only**: events from every calendar you show in Google Calendar, plus tasks due that day. The sign-in token stays in memory; when it is about to expire (after about an hour), the next click renews it without the consent screen.

The **ⓘ** button at the bottom shows which account is connected, with two options:

- **Switch Google account** opens Google's account chooser, where you can pick another signed-in account or add one.
- **Sign out** revokes daytime's access for that account and forgets the Google sign-in inside the note, so the next **Connect** starts from a clean sign-in.

A client ID is set in [`config.js`](./config.js). To use your own Google Cloud project instead (about 3 minutes):

1. Enable **Google Calendar API** and **Google Tasks API**.
2. On the OAuth consent screen, add the scopes `calendar.events.readonly`, `calendar.calendarlist.readonly` and `tasks.readonly`.
3. Create an **OAuth client ID → Web application** with the authorized JavaScript origin **`http://127.0.0.1:4173`** — the address the note serves itself from.
4. Paste the client ID in the app (**Connect Google Calendar → Change client ID**) or into `config.js`. A pasted ID overrides `config.js`; **Use the default client ID** switches back. The client *secret* is never needed; don't keep `client_secret_*.json` in this folder.

The Calendar scopes are *sensitive* in Google's terms: until the OAuth app is verified, sign-in shows an "unverified app" warning, and while the consent screen is in **Testing** only listed test users can sign in.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `origin_mismatch` | Add `http://127.0.0.1:4173` exactly under Authorized JavaScript origins. If another program holds port 4173 the note picks a random port; close that program and restart the note |
| 403 from Google | Enable the Calendar and Tasks APIs for that project |
| "Google sign-in couldn't load" | Check the connection to `accounts.google.com`, then Try again |
| Only the primary calendar shows | Reconnect and allow access to the list of your calendars |
| "Google hasn't verified this app" | Expected until verification; test users can choose Advanced → continue |
| Sunrise stays `--:--` | Click **Use location**, or set `location` in `config.js` |
| Note does not appear | Read `desktop\boot.log`; launch from Explorer rather than a sandboxed terminal |

---

## Settings

[`config.js`](./config.js):

- `googleClientId` — default OAuth client ID.
- `timeFormat` — `"locale"`, `"24h"` or `"12h"`.
- `weekStart` — `"locale"` (follows your region), `"sunday"`, `"monday"` or `"saturday"`.
- `location` — fixed `{ latitude, longitude }` so sunrise/sunset work without asking.

---

## Privacy

- The Google token lives in memory only; events and tasks are never stored. Access is read-only.
- The note's built-in server listens on `127.0.0.1` only, serves only the app's own files, and refuses requests addressed to any other host name.
- A Content-Security-Policy limits scripts to the app and Google sign-in, and network requests to the Google APIs it reads.
- **Location** is requested only when you click **Use location**. A copy rounded to ~1 km is remembered on this PC; **About → Forget location** removes it. The nearest city comes from `cities.js`, a bundled extract of [GeoNames](https://www.geonames.org/) `cities15000` (CC BY 4.0). Nothing is sent to a geocoding service.
- No web fonts or analytics: the UI uses Inter if installed, otherwise Segoe UI.

---

## Development

```bash
npm test        # dependency-free tests (node:test)
npm run dev     # the same UI in a normal browser at http://127.0.0.1:4173
```

Quit the note before `npm run dev`; both use port 4173. To release a new version: `npm version patch --no-git-tag-version`, then `npm run sync-version` (copies the version into `app.js`; the tests fail if they differ).

```
daytime.cmd                 the one entry point: run, build, install, uninstall
desktop/
  daytime.ps1               what daytime.cmd runs
  DaytimeNote.cs            the native window, tray, and local file server
  *.dll                     WebView2 SDK libraries (Microsoft, redistributable)
index.html, styles.css      UI
app.js, core.js             behaviour; pure date and sun maths
cities.js                   offline nearest-city list
config.js                   settings
logo.svg                    mark shown in the UI
desktop/daytime.ico         app icon (Start, shortcuts, tray)
public-files.js, server.js  file allowlist and the browser dev server
tests/, tools/              tests and the version script
```

---

## Design

- `#050505` background, `#111` surfaces, `#242424` hairlines.
- `#F5F5F5` type, `#93A3B4` for quiet blue-grey metadata, `#8F8F8F` for secondary copy.
- One accent, `#ED1C2E`, used as a single dot — never a large fill.
- Light numerals, lowercase labels with wide tracking, generous spacing, no shadows.

## Licence

MIT. Not affiliated with Nothing Technology Limited; the palette and restraint are a tribute, not a copy.
