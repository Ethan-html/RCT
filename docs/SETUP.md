# Setting up RedChurch Tech (RCT) on GitHub

Do this once. It takes about 20 minutes. After this, [`RELEASING.md`](RELEASING.md) is all you need.

## What you need

- A free GitHub account.
- **Git** on your PC: <https://git-scm.com> (or GitHub Desktop, if you prefer clicking).
- **Node.js LTS** on your PC: <https://nodejs.org> (only needed for `RELEASE.bat` and for testing the launcher).

## 1. Create the repo

1. On GitHub click **New repository**.
2. Name: **`RCT`**. (GitHub names cannot contain spaces, so "RedChurch Tech" would become `RedChurch-Tech`. Either works, the launcher figures it out. The full name "RedChurch Tech (RCT)" is already in the README and the repo description.)
3. Description: `RedChurch Tech (RCT)`.
4. Choose **Public**. The launcher reads releases without logging in, so a private repo will not work.
5. Do **not** add a README, .gitignore or license (they are already in the folder). Click **Create repository**.

## 2. Upload the files

Unzip the project, open a terminal in the folder (the one with `README.md` in it) and run, replacing `YOURNAME`:

```
git init -b main
git add .
git commit -m "First commit"
git remote add origin https://github.com/YOURNAME/RCT.git
git push -u origin main
```

## 3. Turn on the release button

1. Repo → **Settings** → **Actions** → **General**.
2. Scroll to **Workflow permissions**, choose **Read and write permissions**, click **Save**.

(Without this, the Release workflow cannot save the new version number or publish.)

## 4. Use the logo

Repo → **Settings** → **General** → **Social preview** → **Edit** → **Upload an image** → pick `docs/images/social-preview.png`. This is the card people see when the link is shared.

## 5. Publish the first releases

The launcher downloads Redcast and Redcam on first launch, so they must exist before the launcher is used. Do them in this order. For each one:

**Actions** tab → **Release** (left side) → **Run workflow** → set:

| Field | First release |
|---|---|
| app | `redcast`, then `redcam`, then `launcher` |
| bump | **`same`** (publishes the number already in the files, e.g. `0.1.0`) |
| min_launcher | leave empty |
| notes | `First release` |

Click the green **Run workflow** button and wait a few minutes. A green tick means it worked, and a new entry appears under **Releases**.

> If **redcam** fails, open the failed run and read the first red line. It is almost always a Python package in `apps/redcam/requirements.txt` that would not install.

## 6. Install on a church PC

Follow "Installing on a church PC" in the main [`README`](../README.md). That is the whole deployment.

## Try the launcher on your own PC first (optional)

Double-click **`START-LOCAL.bat`** in the project folder. The first time it installs what it needs, then opens the launcher.

- Everything it creates (`node_modules`, test settings, test-installed apps in `.local-data`) is ignored by git, so nothing from testing ever gets committed.
- It never touches a real install, because test data stays in `.local-data`. Delete that folder to start fresh.
- In **Settings** type your repo as `YOURNAME/RCT`. In this test mode the launcher cannot update *itself* (that only works for the installed version), but app updates work.

## Good to know

- You never edit the launcher's repo setting. The workflow writes the right one into the installer.
- Windows will show "unknown publisher" for the installer because it is not code-signed. That is normal. Click **More info**, then **Run anyway**.
- Everything a PC stores lives in `%APPDATA%\Red Launcher` (apps, logs, settings).
