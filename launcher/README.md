# Red Launcher

The only program installed on a church PC. On first launch it downloads Redcast and Redcam from this repo's
GitHub Releases, then opens them on the screens you chose. It also updates the apps and itself, but only when asked.

Setup and releasing are in the top-level docs: [`docs/SETUP.md`](../docs/SETUP.md) and [`docs/RELEASING.md`](../docs/RELEASING.md).

## Test it on your PC

```
npm install
npm start
```

Set the repo in **Settings** (like `yourname/RCT`). Building an installer by hand: `npm run dist` → `dist\Red-Launcher-Setup-x.y.z.exe`.
Normally GitHub builds that for you (the **Release** workflow).

## How updates work

| Release tag | Attached file | What the launcher does with it |
|---|---|---|
| `redcast-v0.2.0` | `redcast-0.2.0.zip` | Offers an **Update** on the Redcast card. |
| `redcam-v1.3.0` | `redcam-1.3.0.zip` | Offers an **Update** on the Redcam card. |
| `launcher-v0.2.0` | `Red-Launcher-Setup-0.2.0.exe` | Offers an **Update** on the launcher card, then runs the installer silently and reopens. |

An app release can carry `<!-- min-launcher: 0.2.0 -->` in its notes. If this launcher is older, the app's Update button is
hidden (the card explains why) until the launcher is updated.

Updates are offered at **startup** (before the apps open), when **quitting**, on the **Apps** tab (one button per app, one for the launcher, plus
**Update all**), and every 6 hours in the background.

## Code map

| Piece | What it does |
|-------|--------------|
| `main.js` | Starts the launcher, or, when `RED_RUN_APP` is set, runs one app (`runner.js`). |
| `lib/launcher.js` | First-launch install, startup choice, update checks and prompts, launcher self-update, tray, window. |
| `lib/installer.js` | Unpacks an app zip, keeps the previous version, runs setup (ffmpeg), installs a new launcher. |
| `lib/runtime.js` | Opens and closes apps on their screen, and hands Redcam's page to Redcast's window when they share a screen. Closing hides the window at once and finishes in the background. |

**Windows.** Every app opens in its own window (own taskbar icon and window controls), maximized on the screen you chose for it in the launcher. Two apps on the same screen simply open two windows. **Start both** opens them at the same time.

| `lib/brand.js` | Gives each app its own copy of the Electron program named and iconed like the app (`%APPDATA%\Red Launcher\runtime`), so Windows Firewall shows "Redcast" and its icon, not "Electron". Uses `rcedit`. |
| `lib/github.js` | Finds the newest `<name>-v<version>` release, reads `min-launcher`, downloads files. |

Everything on a PC lives in `%APPDATA%\Red Launcher` (`apps`, `logs`, `settings.json`). Redcast keeps its own data where it always was.

## Getting back into the launcher

Tray icon (click it, or right-click for Open / Check for updates / Quit), hold **Shift** while starting it, or start it with
`--launcher`. Starting it a second time brings the window forward.
