# RCT (RedChurch Tech): AI Project File

Read this first. It says what the project is, who uses it, what the owner wants, and what the owner does NOT want. Update it as decisions are made. If a request conflicts with this file, ask before building.

Last updated: 2026-11-28 (fifth pass: remote page grown into two tabs with a PIN, lower thirds, message, verse, videos and photos; fourth pass: 4.3 remote control page, first version, built on top of the third pass: 4.1 countdown-to-zero; END confirmation already existing; improvement 5 settings-to-file; improvement 3 auto reconnect / resume; 4.2 sermon clip)

---

## 1. The one rule that beats everything

**Less is more.** This runs a small church's Sunday service. Older volunteers often run it. Someone shows up about 5 minutes before the service, boots it up, and it must just work.

- Nothing may need to be prepared in advance. Everything is gathered **during the service**.
- It must be **easy to put up** (show a verse, a name, a video, a photo, a QR code) in a couple of taps.
- Do not add screens, settings, checklists, confirmations or choices the operator has to think about, unless this file says so.
- Prefer behavior that happens **automatically and silently** over a new button.
- Plain, friendly words in the UI. No technical jargon in anything the operator sees.
- If something goes wrong, the app should fix itself or fall back safely before it asks the operator anything.

## 2. What this project is

- **Repo:** `Ethan-html/RCT` on GitHub (public, so the launcher can read releases without login).
- **Red Launcher** (`launcher/`): the only thing installed on a church PC. It installs, updates and opens the apps. Updates are never automatic; the launcher offers them. Startup setting is currently `"ask"`.
- **Redcast** (`apps/redcast/`): Electron app. Camera / capture card, preview and output canvases, lower thirds, Bible verses, videos and photos, queue, web page display, external screens, recording, YouTube streaming via ffmpeg. About 5,000 lines across `app.js`, `looks.js`, `main.js`, `scene.js`, `yt.js`, `qr.js`, etc.
- **Redcam** (`apps/redcam/`): PTZ camera controller. Python / Flask backend (packaged as `backend/ptz-backend.exe`, port 8080) plus a web UI (`index.html`). Has presets, move / zoom / focus, an END-stream hotkey macro, and a tracker (`tracker.py`, `tracker.html`) using VISCA and OpenCV.
- **Other folders:** `shared/` (icons), `tools/` (release scripts), `docs/` (`SETUP.md`, `RELEASING.md`), `.github/workflows/release.yml`.
- **Releasing:** GitHub Actions, then Release, then pick the app and bump. Or `RELEASE.bat`.

### Things that already exist (do not rebuild)

- One-button start and end of the stream, including the YouTube broadcast and title template (`{longdate}`). Owner confirmed these exist. Verify in code before changing.
- Countdown card, "Until service starts" card, Welcome, Thank you, Follow us, Give (QR), custom slide-in name lower thirds.
- Tech error screen (stand-by screen, audio cut), Black, test pattern.
- Video and photo queue, loop, end-of-video behavior.
- Smart mic gain, audio meter, screen capture with crop.
- Crash recovery banner (Redcast), recordings folder, logs in `.local-data/logs/`.

## 3. Decisions the owner has made

### Improvements

| # | Item | Decision |
|---|------|----------|
| 1 | Pre-service "Sunday ready" checklist | **CHANGED.** Do it **in the background only**. Do not show it to the operator. (Older people run this; less is more.) When it finds a problem it **fixes it automatically**. It only **alerts the operator for a bigger issue** it cannot fix itself. |
| 2 | Auto-start Redcast and Redcam together | **NO. Do not change** how startup works. |
| 3 | Auto reconnect / resume the stream after a crash | **YES.** **BUILT 2026-11-27** (see section 9). Owner chose 3 minutes of retrying (5 was too long) and wants backup pieces joined. Not yet tested on a real PC or a real YouTube stream. |
| 5 | Settings out of `localStorage` into a file | **YES.** Save settings to a file, **on close**, and also **quietly in the background** whenever something changes, so a crash does not lose them. No message to the operator. **BUILT 2026-11-27** (see section 9). Not yet tested on a real PC. |
| 6 | "Restore last Sunday's settings" button | **NO.** |
| 7 | Service mode (block sleep / updates / notifications) | **NO.** |
| 9 | Offline Bible text | **NO.** No internet means no stream, so it is not needed. |
| 10 | YouTube auto-refresh and status light | **NO.** Less is more. |
| 11 | One-button GO LIVE | **ALREADY HAVE IT.** |
| 12 | One-button END | **ALREADY HAVE IT.** |
| 13 | "Are you sure?" confirmation | **YES, for END only** (not for START). **ALREADY IN PLACE** (verified in `app.js`, `btnStream.onclick` asks "Stop the stream?" / "Stop recording?"; START does not ask). Nothing to build. |

### New features

| # | Item | Decision |
|---|------|----------|
| 1 | Service Plan file | **NO.** There are no plans, workshops, or prep. |
| 2 | Pre-service video / slideshow loop | **NO.** Not applicable. (See "Countdown reaches zero" below for the replacement.) |
| 16 | Auto-clip the sermon | **YES.** Redesigned. See "Sermon clip" below. |
| 22 | Remote control | **YES.** Redesigned as one combined web page. See "Remote control page" below. **FIRST VERSION BUILT 2026-11-27** (see 4.3 and section 9). |

Anything not listed above has **not been decided**. Do not build it without asking. See section 6.

## 4. Features the owner wants (specs)

### 4.1 Countdown reaches zero (BUILT 2026-11-27)

**Status:** Done in `apps/redcast/app.js` (`checkCountdownZero`, checked twice a second). When a live Countdown or Until service starts card hits zero it runs the same steps as CLEAR ALL (stops any video, clears lower thirds and photos, back to the plain camera) and writes a line to the log. It applies to both the minutes countdown and the service-time one. It only touches the Output; screens sent to external displays are not changed. Not yet tested on a real PC. Needs a quick check with a 1-minute countdown.

When the **Countdown** or **Until service starts** lower third reaches **zero**:

- It clears **everything** from the page.
- Only the **camera** is shown.
- No operator action needed.

### 4.2 Sermon clip (automatic, driven by a Redcam preset) (BUILT 2026-11-27)

**Status:** Built, using my assumed answers for the open questions in section 6 (grace period 15 seconds). Not tested on a real PC or camera. How it works is in section 9. The operator sees nothing; the files just appear in the stream's folder. Note: it needs a saved recording, so it does nothing when the output mode is "stream only" with no backup copy.

Goal: the sermon is cut out automatically, with no one marking anything by hand.

1. In **Redcam settings**, add an option to choose a **Sermon preset**.
2. When the camera **goes to the Sermon preset**, Redcam sends **"sermon started"** to Redcast. Redcast records that moment as the **cut start time**.
3. The sermon **ends when another preset is pressed**. Redcast records the **cut end time**. Moving the camera by hand (joystick, zoom, focus) does **not** end it.
4. If the Sermon preset is used **more than once** in a service, the parts are **joined together** into one sermon file, in order.
5. There is a **grace period** for misclicks: if the operator leaves the Sermon preset and comes back within the grace period, it counts as one continuous sermon (the brief time away is kept, not cut out or split). The grace period length is not decided yet (see section 6).
6. The sermon is saved as **its own video file**, and also as a **plain MP3 audio file**.
7. **One folder per stream**, containing:
   - the **full livestream** recording
   - the **cut sermon** video
   - the **sermon audio** (MP3)

Technical notes (starting ideas, not decisions):

- Redcam (Python, port 8080) and Redcast (Electron) are separate programs, so they need a small local link between them (for example a local HTTP call from Redcam to Redcast).
- Cutting from the finished full recording by timestamps (ffmpeg, stream copy for the video, `-vn` MP3 for the audio) avoids re-encoding. ffmpeg is already bundled with Redcast.
- Recordings currently go to the folder set by `recDir`, and the stream recording is fed by `stream:chunk` in `main.js`.

### 4.3 Remote control page (FIRST VERSION BUILT 2026-11-27)

**Status (2026-11-28, second version):** Built. Redcast serves one phone-first page on the local network at `http://<church PC address>:8766` (address and PIN are in Settings > Troubleshooting). It scales to a tablet or laptop (two columns: picture and big buttons on the left, controls on the right). Not tested on a real PC, phone or network; the server (PIN, cookie, lockout, Camera pass-through) was tested on its own, and every changed file passes a syntax check.
- **PIN:** 4 digits. A random one is made the first time and shown in Settings > Troubleshooting, where it can be changed. The phone remembers it after the first entry (browser storage), so it is not typed again. Changing the PIN logs every phone out. 5 wrong tries lock that device out for a minute, longer if it keeps guessing.
- **Stream tab:** live picture of the Output (every 2 seconds, only while this tab is open), CLEAR ALL, TECH ERROR (lights up when on), Lower thirds (Welcome, Thank you, Follow us, Give if a link is set, Until service starts if a time is set, and a Countdown with a minutes stepper), Your own message (big and small line, full lower third or slide-in), Bible verse (type a reference like John 3:16, pick KJV / WEB / ASV / BBE), Videos and photos (the shelf, tap to put it on the Output) with a Stop the video button. Everything goes straight to the Output (no Preview and SEND from a phone).
- **Camera tab:** the full Redcam page, passed through Redcast so the PIN covers it.
- **Still not on the page:** START / END stream (on purpose), Web page / slideshow, the external screen.

**For now: local network only** (same Wi-Fi / network as the church PC), protected by the 4-digit PIN. Not reachable from the internet. Internet access is a later decision and needs a stronger password and a safe way to connect first.

One **web page** that combines, in a single place:

- the **livestream / camera view**,
- the **camera (PTZ) controls**,
- **whatever other apps are open** (Redcast controls, etc.),

so the owner can **control anything remotely** from one page.

## 5. Things the owner does NOT want

- No service plans, workshops, or anything that needs preparing ahead of time.
- No visible pre-flight checklist, status lights, or technical screens for the operator.
- No changes to how the launcher / apps auto-start (item 2).
- No remote access from the internet for now (local network only).
- No "restore settings", "service mode", offline Bible, or YouTube-refresh features.
- No pre-service video or slideshow loop.
- No extra confirmations except on END.
- No UI that adds decisions for older volunteers.

## 6. Open questions (ask the owner before building)

**Sermon clip**
- Grace period: BUILT AS 15 SECONDS (a guess, one constant `GRACE_MS` in `sermon.js`). Owner to confirm or give a number.
- Stream ends while still on the Sermon preset: BUILT to end the sermon at that moment. Confirm.
- Sermon preset never used: BUILT to save nothing extra. Confirm.
- Operator sees nothing when a sermon is cut (files just appear in the stream's folder). Confirm.

**Remote control page**
- Which device is it for (phone, tablet, laptop)? Not answered yet. Built to work on a phone first (big buttons, one column), and it also works on a tablet or laptop.
- A 4-digit PIN is now built in (see 4.3). Is the church Wi-Fi private (staff only)? A PIN on a shared guest Wi-Fi is still only a light lock.
- **Redcam's own address is still open.** Redcam listens on port 8080 for the whole network, as it did before. The remote page's PIN only protects the page and the Camera tab; someone who types `http://<church PC>:8080` can still reach Redcam without a PIN. Should Redcam be locked to the church PC only (the remote page's Camera tab would keep working)? Not changed yet because it could break how you open Redcam from another device today.
- Should START / END stream be added to the page (END would still ask "are you sure?"), and the Web page / slideshow controls?
- Windows may ask once to allow Redcast through the firewall for private networks. That must be allowed for the page to open from another device.
- Later, if it is ever opened to the internet, it will need a password / PIN and a safe way to connect. Not needed now.

**Background check (item 1)**
- What counts as a "bigger issue" worth alerting the operator about (for example camera missing, audio missing, no internet, disk nearly full)? Needs a short list from the owner. Keep the alert wording simple and calm.

**Other**
- Countdown-to-zero camera-only: built to apply to BOTH the hand-started Countdown and "Until service starts" (the spec says both). Tell me if it should be only "Until service starts".
- Note: if "Until service starts" is put up within 30 minutes after the set start time, it counts as zero and clears right away.

## 7. Not yet decided (backlog)

Raised earlier, still waiting on a yes or no. **Do not build without asking.**

**Improvements:** 4 remember last devices, 8 low disk space warning, 14 big ON AIR indicator, 15 panic button, 16 SEND cut / fade, 17 forgiving verse entry, 18 auto-fit text, 19 stream health display, 20 private test stream, 21 smooth preset speed, 22 preset thumbnails, 23 lock PTZ while live, 24 camera online status, 25 repo cleanup (`.local-data/`, `.local-data-releases/`, bundled `runtime/`, `__pycache__` should not be in git; check `.gitignore`).

**Features:** 3 (partly covered by 4.1), 4 saved scenes, 5 announcement slides, 6 to 9 song lyrics library, 10 verse queue, 11 multiple translations, 12 sermon notes, 13 verse history, 14 auto "Live now" lower third, 15 chat on screen, 17 post-service upload, 18 viewer count, 19 silent-audio alert, 20 camera auto-switch rules, 21 Stream Deck / hotkeys, 23 volunteer mode, 24 send-logs button, 25 after-service report.

## 8. How to work with the owner

- The owner types fast and informally (typos are common). Read generously, and ask if unsure.
- The owner prefers short, clear answers and decides item by item.
- Before changing existing behavior, check the real code. Do not assume.
- Keep changes small. Match the existing code style.
- When a decision is made, **update sections 3 to 7 of this file**.

## 9. Known facts about the code (verify before relying on them)

- `apps/redcast/main.js`: Electron main process. IPC handlers for capture, displays, media, lower thirds, ffmpeg, streaming (`stream:start`, `stream:chunk`, `stream:stop`), YouTube (`yt:*`), Bible (`bible:fetch`), recordings, logs.
- `apps/redcast/app.js`: the main UI logic (about 2,400 lines). Settings still use `localStorage` in the code (`settings`, `camPrefs`, `layout`, `cards`, `screenPrefs`, `recDir`, look keys), but `apps/redcast/store.js` (loaded first in `index.html`) mirrors ALL of `localStorage` into `redcast-settings.json` in the app's data folder (`%APPDATA%/church-switcher-poc/`). On start the file is loaded first and wins. Changes are saved about 1 second after they happen, and again when the window closes. First run after the update copies the existing browser settings into the file. Main process handlers: `settings:load` / `settings:save` in `main.js`, exposed in `preload.js`. No message is shown to the operator. Any new setting that uses `localStorage` is saved automatically.
- `apps/redcam/app.py`: Flask routes for presets (`/api/presets/<n>/recall`, `/save`), PTZ (`/api/ptz/move`, `zoom`, `focus`, `stopall`), `/api/hotkey/<n>`, and END-stream (`/api/endstream/*`). Preset recall is the natural place to hook the sermon start / end.
- `apps/redcam/tracker.py`: auto-tracking engine (VISCA over network, OpenCV).
- `.local-data/settings.json` is a launcher file (`startup`, `repo`, `screens`). It is not the Redcast settings file.
- Windows is the target (`.bat`, `.ico`, `.exe`).
- **Stream auto reconnect / resume (item 3)**, all in `apps/redcast/app.js` (look for `quietReconnect`, `tryReconnect`, `resumeAfterRestart`, `finalizeEnd`):
  - If the stream drops by itself (YouTube or own stream address only, not record-only or test file), Redcast quietly tries again every 5 seconds with the same address / key, for up to 36 tries (3 minutes, the owner's choice). The YouTube broadcast is kept, not ended. The button stays on STOP and the only text is a small "Connection lost. Reconnecting..." line. Each reconnect makes a new backup recording file, and when the stream finally ends the pieces are joined into one `...-joined.mp4` (pieces deleted only after the join works). With a backup copy running, ffmpeg does not stop when the internet drops, so `main.js` watches for the tee error line and ends ffmpeg itself to trigger the reconnect.
  - If it gives up, or the operator presses STOP, it ends as before (broadcast ended, the old "stopped unexpectedly" banner on give-up).
  - If the app or its screen restarts mid-stream, Redcast saves a small note (`resumeStream`, refreshed every 10 seconds, saved to the settings file) and on the next start, within 3 minutes and with the camera ready, goes live again with the same broadcast and no questions. A normal close removes the note, so closing the app on purpose never resumes. If it cannot resume, the old "press START STREAM" banner shows.
  - Open question: the resume-after-restart window (3 minutes) is still my guess. Owner to confirm.
- **Remote control page (4.3), second version**: the page is built from `apps/redcast/remote.js` (written inline). Routes: `GET /` (public, just the page), `POST /remote/login` (PIN, sets an HttpOnly cookie that is a hash of the PIN and a per-run secret; per-IP lockout), then with the cookie only: `GET /remote/snapshot.jpg`, `GET /remote/state`, `POST /remote/do` {op, args} with ops state, clear, tech, card, message, verse, play, stopvideo (anything else refused). Every other path with a valid cookie is passed through to Redcam on `127.0.0.1:8080` (`/cam/` becomes `/`), because Redcam's page uses root paths like `/api/...`. The screen side is in `app.js` (the `OPS` table next to `remote:call`): it reuses `showCardNow`, `sendItemNow`, `addName`, `addVerse`, `followLiveVerse`, `playTarget`, `selectClip` + `goLive`, `stopPlayback` and clicks the real CLEAR ALL / TECH ERROR buttons. IPC: `remote:reply`, `remote:setPin`, `remote:address`; events `remote:snap`, `remote:call`. The PIN is `localStorage.remotePin`. Older notes follow: `apps/redcast/remote.js` (started from `main.js` with `remote.listen()` in `app.whenReady`). Listens on `0.0.0.0:8766` (all network cards, local network only, no internet, no password). Routes: `GET /` (the page, written inline in `remote.js`), `GET /snapshot.jpg` (asks the screen for a 640x360 JPEG of `liveCanvas` through `remote:snap` / `remote:frame`, 1.5 second time-out), `POST /cmd` with `clear` or `tech` only (anything else is refused). The screen handles `remote:cmd` in `app.js` by clicking the real CLEAR ALL / TECH ERROR buttons, so the behavior is identical to pressing them. The camera part is an iframe to `http://<same host>:8080/`; Redcam already listens on `0.0.0.0` (`app.run(host="0.0.0.0")`), so Redcam itself needed no change. If port 8766 is busy the page simply does not start (one line in the log). IPC added: `remote:frame`, `remote:address`; events `remote:snap`, `remote:cmd` in `preload.js`.
- **Sermon clip (4.2)**:
  - Redcam (`apps/redcam/app.py`): new setting `sermonPreset` (0 = none), chosen in Redcam Settings under Camera as "Sermon scene". `notify_preset()` is called when a scene is recalled (UI) or the tracker switches scenes. It tells Redcast "start" when the sermon scene becomes current and "end" when any other scene does, by POST to `http://127.0.0.1:8765/sermon`. Joystick, zoom and focus never call it. `GET /api/sermon/state` lets Redcast check at stream start if the camera is already on the sermon scene.
  - Redcast (`apps/redcast/sermon.js`, hooked from `main.js`): listens on 127.0.0.1:8765 only. Notes the sermon times against the recording clock, keeps them in `.sermon-session.json` in the stream's folder (survives reconnects and restarts), and when the stream ends cuts the parts out of the full recording with ffmpeg stream copy, joins them in order, and makes the MP3 (needs `libmp3lame` in the bundled ffmpeg; if missing, only the video is made).
  - **One folder per stream** now: each stream makes `<recordings folder>/Redcast <date-time>/` holding the full recording, `Sermon.mp4` and `Sermon audio.mp3`. This changes where all recordings go (they used to sit loose in the recordings folder).
  - Cut start may be up to about 2 seconds early (cut snaps to the video's keyframes, which come every 2 seconds). Timing is from the moment video starts flowing, so expect a second or so of error.
