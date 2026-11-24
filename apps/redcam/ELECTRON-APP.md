# Redcam: build, install, and run

Redcam is the PTZ camera controller in the Red family (Redcast, Redcam, launcher).

## A. Build the installer (do this once, on YOUR dev PC)

You need these installed **only on the PC that builds**:

| Tool | Get it from | Note |
|------|-------------|------|
| Python 3.10+ | python.org | tick **Add python.exe to PATH** |
| Node.js LTS | nodejs.org | includes `npm` |

Double-click **`build.bat`**. It:

1. installs the Python packages (`requirements.txt` + PyInstaller)
2. bundles the Python backend into `ptz-backend.exe` (other PCs do not need Python)
3. runs `npm install`
4. runs `npm run dist` to make the installers

The `dist\` folder then contains:

* `Redcam-Setup-<version>.exe`: normal installer (Start menu + desktop shortcut, uninstaller)
* `Redcam-Portable-<version>.exe`: one file, no install

**Bump `"version"` in `package.json` before each build.**

---

## B. Install on another computer

1. Copy the **Setup** `.exe` (or the **Portable** one) to the other PC.
2. Double-click it. If Windows SmartScreen appears, click **More info, then Run anyway** (the app isn't code-signed).
3. Open **Redcam**, then **Settings**, and enter the camera **IP, username, password**. Settings are stored per computer.
4. A **Windows Firewall** prompt may appear. Local use works either way. Click **Allow** only if you want other devices (phone, Stream Deck) to open `http://<this-pc-ip>:8080`.

Needs: Windows 10/11 64-bit and network access to the camera.

### Hotkeys / END Stream
Redcam presses **Ctrl+Alt+letter** style hotkeys to control your streaming software.
* The streaming software must use the same hotkeys on that PC.
* If the streaming software runs **as Administrator**, Redcam must too (right-click, Run as administrator).
* The END Stream button and its hotkey list are edited in **Settings, END Stream**.

### Copying your scenes to a new PC
Scene names and thumbnails live in the app data folder (`settings.json`, `presets.json`, `presets\`).
Copy `presets.json` and the `presets` folder to the same place on the new PC (run the app once there first).
**Do not copy `settings.json` into anything you share:** it contains the camera password.

---

## C. Run without installing (development)

```bat
pip install -r requirements.txt
npm install
npm start
```

---

## D. Updating other PCs
Build a new installer with a higher version number and run it on the other PC. It upgrades in place.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Blank window / "backend did not start" | Check `backend.log` in the app data folder. Make sure nothing else uses port 8080. |
| Port 8080 already in use | Close the other program, or set `PORT=9090` before launching. |
| Camera shows Offline | Check the IP in Settings; the PC and camera must be on the same network. |
| Camera moves but won't stop | Press **Stop** in the camera drawer; check the network to the camera. |
| Hotkeys do nothing | See "Hotkeys" above. |
| `build.bat` fails at step 2 | Run `py -m pip install pyinstaller` manually and re-run; antivirus can quarantine PyInstaller output. |
