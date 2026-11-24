# Releasing: bumping numbers and triggering updates

## The 10-second version

1. GitHub → **Actions** → **Release** → **Run workflow**.
2. Pick the **app** (`redcast`, `redcam` or `launcher`) and the **bump** (`patch` for a fix).
3. Click **Run workflow**. A few minutes later it is published, and church PCs will offer the update.

That one click raises the version number, builds, tags and publishes. You do not edit any numbers by hand.

## Three ways to release

### A. The GitHub button (no tools needed)

Actions → **Release** → **Run workflow**:

| Field | What to put |
|---|---|
| **app** | What you changed: `redcast`, `redcam` or `launcher`. |
| **bump** | How big the change is (table below). |
| **min_launcher** | Optional, apps only. See "When an app needs a newer launcher". Leave empty most of the time. |
| **notes** | Optional. One line about what changed. Shown on the release page. |

### B. `RELEASE.bat` on your PC

Double-click it in the project folder. It asks which app, what size of change, and (for apps) the oldest launcher needed, then saves, tags and pushes. GitHub builds it from there. Needs Git and Node.js installed. Make sure your changes are committed first.

### C. By hand (only if the other two are broken)

Raise `"version"` in the package.json, push a tag like `redcast-v0.2.0` that matches it exactly. GitHub builds on tag. Or build locally with `tools\release-redcast.bat` / `tools\release-redcam.bat` and attach the zip to a release yourself, with a tag like `redcast-v0.2.0`.

## Which number goes up?

Versions look like `1.4.2` = **major.minor.patch**.

| Bump | Use it for | Example |
|---|---|---|
| `patch` | A bug fix or tiny tweak | `0.1.0` → `0.1.1` |
| `minor` | A new feature | `0.1.1` → `0.2.0` |
| `major` | A big change | `0.2.0` → `1.0.0` |
| `same` | The very first release only (publishes the number already in the files) | `0.1.0` → `0.1.0` |

Each app and the launcher have their **own** numbers:

| What | Number lives in |
|---|---|
| Redcast | `apps/redcast/package.json` |
| Redcam | `apps/redcam/package.json` |
| Launcher | `launcher/package.json` |

Never hand-edit these. The Release button and `RELEASE.bat` do it for you, so the tag and the number always match.

## What church PCs see

Nothing updates without someone choosing it.

| When | What happens |
|---|---|
| **Launcher starts** | It checks GitHub (waits at most 6 seconds, so offline is fine) *before* opening the apps. If something is new, it asks **Update now** / **Not now**. |
| **Someone quits the launcher** (tray icon → Quit) | If an update is waiting, it asks **Update, then quit** / **Quit without updating** / **Cancel**. |
| **Apps tab, any time** | One **Update to x.y.z** button on each app card, one on the **Red Launcher** card, and an **Update all** bar when anything is waiting. |
| **Every 6 hours** while running in the tray | A quiet re-check and a tray notification. |
| **Tray icon → Check for updates** | A check right now. |

Updating the launcher closes running apps first (it asks), runs a silent install, and reopens. When several updates are waiting, **Update all** does the apps first and the launcher last.

## When an app needs a newer launcher

Redcast and Redcam run *inside* the launcher (Redcast uses the launcher's built-in Electron). So sometimes a new app version only works with a newer launcher, for example if you upgrade Electron or the app starts using a new launcher feature.

Tell the system with **min_launcher**:

1. Release the launcher, e.g. bump `minor` → `0.2.0`.
2. Release the app with **min_launcher = `0.2.0`**.

What a church PC on launcher `0.1.0` then sees:

- The app's card has **no Update button**. It shows a note: "Version 0.3.0 is ready but needs launcher 0.2.0 first."
- The **Red Launcher** card shows **Update to 0.2.0** (and the startup / quit prompts offer it).
- After the launcher updates and restarts, the app update appears and can be installed.

Good to know:

- The setting is remembered in `apps/<app>/app.json` (`"minLauncher"`). Leaving **min_launcher** empty **keeps** the last value. You only type it when the requirement goes up.
- The launcher reads it from a hidden line in the release notes (`<!-- min-launcher: 0.2.0 -->`) so it can hide the button *before* downloading anything. As a second safety net the installer refuses an app that needs a newer launcher.
- If you set a min launcher that was never published, the app update will never appear. `RELEASE.bat` warns about this.
- Order does not matter for safety. Releasing the app first just means PCs wait until the launcher is out.

## Taking a bad release back

- **Not installed anywhere yet:** on GitHub open **Releases**, open the bad release and **Delete** it (or edit it and tick *Set as a pre-release*, which the launcher ignores). Then release a fixed version.
- **Already installed on a PC:** launcher → **Settings** → **Go back to x.y.z**. The previous version is always kept.

## Checking that it worked

1. **Actions** tab: the run has a green tick.
2. **Releases** page: you see the new entry with a `.zip` (apps) or `Red-Launcher-Setup-x.y.z.exe` (launcher) attached.
3. On a church PC: start the launcher. You should get the update prompt.

## Troubleshooting

| Problem | Likely fix |
|---|---|
| Release run fails at "Save the new version number" | Settings → Actions → General → Workflow permissions → **Read and write**. If the `main` branch is protected, allow GitHub Actions to push to it. |
| Release run fails while building redcam | Read the first red line in the log. Usually a Python package in `apps/redcam/requirements.txt`. |
| PC does not show an update | Is the repo **public**? Is the release **published** (not draft or pre-release)? Is the app's card showing a "needs launcher" note? Try tray → **Check for updates**. |
| "No release for Redcast yet" on a new PC | Publish the first releases (see `SETUP.md`, step 5). |
| Launcher says "can only update itself once it is installed" | You are running the dev copy (`npm start`). Use the installed launcher. |
| Tag and number do not match error | Do not push tags by hand. Use the Release button or `RELEASE.bat`. |
