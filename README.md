<p align="center">
  <img src="docs/images/logo-512.png" alt="RedChurch Tech logo" width="160">
</p>

<h1 align="center">RedChurch Tech (RCT)</h1>

<p align="center">Tools for running our church's Sunday service.<br>One launcher installs, updates and opens everything.</p>

---

## What's in here

| Folder | What it is |
|--------|-----------|
| `launcher/` | **Red Launcher**: the only thing installed on a church PC. It installs, updates and opens the apps below. |
| `apps/redcast/` | **Redcast**: camera, lower thirds, Bible verses, video, external screens and streaming. |
| `apps/redcam/` | **Redcam**: PTZ camera controller. |
| `shared/` | Icons and design files used by every app. |
| `tools/` | Scripts that bump version numbers and build release zips. |
| `docs/` | Setup and release instructions (start with the two below). |

## Start here

| I want to... | Read |
|---|---|
| Set this up on GitHub for the first time | [`docs/SETUP.md`](docs/SETUP.md) |
| Ship a fix or new feature to the church PCs | [`docs/RELEASING.md`](docs/RELEASING.md) |

## Installing on a church PC

1. Go to the **[Releases](../../releases)** page and open the newest one named `launcher ...`.
2. Download `Red-Launcher-Setup-x.y.z.exe` and run it. (Windows may say "unknown publisher". Click **More info**, then **Run anyway**. The installer is not code-signed.)
3. On first launch it downloads Redcast and Redcam by itself. No clicks needed.
4. After that, updates come from inside the launcher.

## How updates reach the church PCs

You publish a release on GitHub. The launcher then offers it, and **nothing ever updates by itself**.

- **When the launcher starts**, it checks GitHub *before* opening the apps and asks if there is anything new.
- **When someone quits the launcher**, it asks again before closing.
- **Any time**, the **Apps** tab has one **Update** button per app, one for the **launcher**, and an **Update all** bar.
- **If an app needs a newer launcher**, its Update button stays hidden until the launcher is updated. The card says why.

Details: [`docs/RELEASING.md`](docs/RELEASING.md).

## Releasing in one line

GitHub → **Actions** → **Release** → **Run workflow** → pick the app and `patch` → **Run**. Or double-click `RELEASE.bat` on your PC.

---

All rights reserved. See `LICENSE`.
