> **Note:** this is the Phase 1 guide (engine tests). For the new screen, see PHASE2-TESTING.md. The Phase 1 stream and delay tests below still apply, and the panels they mention now live under Setup.

# Church Switcher: Phase 1 Test Guide

**What this build proves:** the capture card camera can come into one app, get a name overlay, go out to a test stream (or YouTube) using the graphics card, and show on the front TV, all without stutter for a full hour. It is a test tool, not the final screen. Do not judge it on looks.

**The big question it answers:** can this approach run smoothly on your real PC? If yes, we build Phase 2 on top of it. If not, we switch to the OBS-behind-the-scenes plan before wasting more time.

---

## Setup (about 10 minutes, mostly waiting for a download)

This works on any Windows PC, including a test computer. The setup looks at the PC's graphics card and driver and installs the matching encoder by itself.

1. **Unzip the folder** to somewhere simple, such as `C:\ChurchSwitcher`. Right-click the zip and choose Extract All. Do not run it from inside the zip.
2. **Close** XSplit, OBS, the Windows Camera app, and anything else that uses the camera or capture card. Only one program can use it at a time.
3. **Double-click `START.bat`.**
   - It checks the PC's graphics card (NVIDIA, AMD, or Intel) and driver, downloads what it needs (about 260 MB the first time), and opens the app.
   - If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
   - If a Windows Firewall box appears, click Allow.
4. Every launch re-checks the PC in a couple of seconds. If you copy the folder to a different PC (such as the stream PC), it notices and installs the ffmpeg that suits that PC.
5. The app tests which encoders really work and picks the best one. Look at the green line under the Stream section: it names the encoder it selected. A graphics-card encoder is what we want for the real stream. The CPU encoder is only a fallback.

If the wrong encoder was picked, or you changed the graphics driver, double-click **`RESET-FFMPEG.bat`** to download the right ffmpeg again.

---

## Test 1: Basic checks (5 minutes)

1. Look at the line under the Stream section (or press **Re-check this PC**). Expected: it names a working graphics-card encoder and selects it.
   - "NOT FOUND": close the app and run `START.bat` again so it can download ffmpeg.
   - "NO graphics-card encoder works": update the graphics driver, restart the PC, then run `RESET-FFMPEG.bat`.
2. Pick the capture card in **Camera**, pick the capture card or mixer in **Audio**, press **Start camera**.
   - Expected: the status turns green and shows the resolution and frame rate (aim for 1920x1080 at 30 or 60). The picture appears in Preview and Live. The audio bar moves when there is sound.
3. In Preview press **Add name to Preview**. The name appears only in Preview. Press **GO LIVE**. Now it appears in Live.
4. Press **CLEAR ALL**: the name goes away. Press **TECH DIFFICULTIES**: the blue screen shows. Preview something and GO LIVE to return.

**Pass:** all four work and nothing freezes.

---

## Test 2: Delay (10 minutes)

Goal: the app should add less than one frame (about 0.03 seconds) of delay.

1. Put a phone showing a stopwatch with milliseconds (search "online stopwatch milliseconds") in front of the camera.
2. With your own phone or another camera, take a photo that has **both** the real stopwatch and the **Live box** on the monitor in the same shot. Take 5 or more photos.
3. The difference between the two times is the total delay (camera + capture card + app).
4. Close the app, open the **Windows Camera app** on the same capture card, and repeat the photo test. The difference you get there is the delay without our app.
5. Our app's added delay is the first number minus the second.

**Pass:** our app adds about 0.05 seconds or less compared with the Windows Camera app. Write down both numbers.

---

## Test 3: TV output (10 minutes)

1. Press **Refresh displays**. Pick the display that is the TV (the one with the emulator). Press **Open TV output**.
2. Expected: a color bars pattern fills the TV screen, with a running clock and a yellow bar sweeping left to right smoothly.
3. Press **Black**, then **Show text**, then **Test pattern**. The TV should change instantly each time.
4. Look at the corners: all four red squares must be visible (no cut-off edges).
5. Click around in the main app and type in a box. The main window must keep working and keep focus.
6. Press **Close TV output**, then open it again. Repeat 5 times.
7. Start the camera and a stream (Test 4) with the TV open. The stream must not stutter when the TV window is showing.

**Pass:** the TV shows the pattern smoothly every time, and the camera never appears on the TV.

---

## Test 4: The one-hour stream (the main test)

Do a **local file test first (10 minutes)**, then a **private YouTube test for a full hour**.

**Local file test**
1. Set **Send to** to *Local test file*, the auto-selected graphics-card encoder, 6000 kbps, 30 fps.
2. Tick **Burn test clock into Live**.
3. Press **Start stream**, watch for 10 minutes, then **Stop stream**.
4. Read the **Test result** box. Open the logs folder and play the `.mkv` file in VLC. It should be smooth with sound.

**YouTube test (one full hour)**
1. In YouTube Studio create a live stream set to **Unlisted** (or Private). Copy the **stream key**.
2. In the app set **Send to** to *YouTube / RTMP*, paste the key, keep the URL `rtmp://a.rtmp.youtube.com/live2`.
3. Open Windows **Task Manager** on the Performance tab. Keep it visible.
4. Press **Start stream**. In YouTube Studio press **Go Live** when it shows the stream as received.
5. For the hour, do what a real service does: GO LIVE a name every few minutes, CLEAR ALL, TECH DIFFICULTIES and back, keep the TV open and switch its pattern now and then.
6. Every 15 minutes write down from Task Manager: **CPU %**, **GPU 3D %**, and the **GPU Video Encode %** (under GPU, change a graph to "Video Encode").
7. After an hour press **Stop stream**. Read the **Test result** box.

**Check by eye on a second device** (phone on mobile data, or another PC watching the YouTube link):
- The video is smooth, with no freezing or jumping.
- The burned-in clock moves steadily.
- **Audio sync:** during the test clap once in front of the camera. The clap sound and the hands meeting must line up. If sound comes early or late by more than a quarter of a second, write down which way and about how much.

**Pass (the app's own checklist shows these):**
- Ran 1 hour or more
- Encoder fps stayed at or above 29 (at 30 fps)
- Encoder speed average 0.97 to 1.03x
- Frames dropped 0.1% or less
- Slow redraws 10 or fewer
- App CPU under 70%, and Task Manager shows ffmpeg CPU and GPU also comfortable (all under 70%)
- Backlog stayed under 2048 KB

---

## Test 5: Things going wrong (15 minutes)

None of these should crash the app. Write down what happened for each.

| Do this while streaming | Expected |
|---|---|
| Unplug the HDMI cable from the capture card for 10 seconds, plug it back | Red banner "CAMERA LOST" appears. (Automatic recovery comes in a later phase. If the camera does not come back, press Start camera.) |
| Unplug the internet for 30 seconds | The stream stops with a red message and the app stays open. (Automatic reconnect comes in Phase 7.) |
| Mute or unplug the audio source | After 15 seconds a banner says no audio. |
| Close the app window | ffmpeg closes too (check Task Manager: no leftover `ffmpeg.exe`). |
| Open the TV output on the main screen | A confirm box warns you first. |

---

## What to send back

Please send:
1. The **Test result** box (a screenshot is fine).
2. The newest `session-....csv` and `ffmpeg-....log` files from the logs folder (the app shows the folder location, and **Open logs folder** opens it).
3. Your Task Manager numbers from Test 4.
4. The delay numbers from Test 2.
5. PC details: Windows version, CPU model, NVIDIA graphics card model, capture card model.
6. Anything that looked wrong, even small stutters.

## Decision rule

- **All PASS:** build Phase 2 on this exact engine.
- **Small misses (some dropped frames, mild CPU):** we tune settings and retest.
- **Big misses (stutter, high CPU, delay over 1 frame, audio drift that cannot be fixed with an offset):** switch to the plan where OBS does the video work behind the scenes.

## Troubleshooting

- **The log says the driver does not support the required nvenc API:** the graphics driver is older than the ffmpeg build expects. Update the driver and run `RESET-FFMPEG.bat`. You can still test the rest of the app with the CPU encoder.
- **"ffmpeg.dll was not found" when the app starts:** this is the app's own runtime missing a file, usually because antivirus removed it. Double-click `REPAIR-INSTALL.bat`. If it happens again, open Windows Security > Virus and threat protection > Protection history, restore `ffmpeg.dll`, and add this folder under Manage settings > Exclusions.
- **START.bat says setup failed:** check the internet, run it again, or follow the manual steps it prints.
- **Camera will not start:** another program has it. Close all others. Check Windows Settings > Privacy > Camera and allow desktop apps.
- **Only 720p or low fps offered:** try another HDMI source resolution, a different USB port (use USB 3 blue ports), or set the camera output to 1080p30.
- **No audio source listed:** capture cards often show audio as a separate device (for example "Digital Audio Interface"). Pick it in the Audio list.
- **Stream key rejected:** make sure the YouTube stream is created and the key has no spaces.
- **The test stream key is saved on this PC** inside the app's settings (test build only). Reset the key in YouTube Studio when testing is over.
