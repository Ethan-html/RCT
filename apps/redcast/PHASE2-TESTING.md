# Church Switcher: Phase 2 Test Guide

(The Phase 1 engine tests in TESTING.md still apply. This covers the operator screen.)

## How the screen works

- **Three areas across the top, edge to edge:** **Preview** on the left, a **control column** in the middle, **Output** on the right. Output is exactly what viewers see on the stream. Nothing reaches Output until you press **SEND**.
- **The control column never changes. Only these buttons:**
  - **SEND** sends Preview to Output. It glows blue when something is waiting.
  - **CLEAR ALL** puts the plain camera on Output.
  - **Tech error** (small button under the Output) shows the "please stand by" screen on Output **and cuts the audio**, right away, without going through Preview. The button turns into **END TECH ERROR**. Press it again to bring back what was on Output and the audio. (Pressing SEND or CLEAR ALL also ends it.)
  - Status lights, **START STREAM**, and **Setup** at the bottom.
- **Under Preview:** small links for Undo, Redo, and Remove selected (they are deliberately quiet).
- **Under Output:** what is on screen (click the x to take something off), **audio level bars (left and right)**, and a **Mute** button.
- **Bottom area:** tabs on top (**Bible**, **Content**, **Lower Thirds**) and the page for the chosen tab fills all the space below. Bible is the default.
- **Bible:** scroll the **books**, tap a **chapter**, tap a **verse**. It goes to Preview. Tap **+ Next verse** to add more verses, or hold Shift and tap to pick a range. Choose KJV, WEB, ASV, or BBE at the top of the verse list. **Save verse** adds it to **Saved this service** on the right. Tap a saved verse to send it to Preview. That list clears when the app closes. The Bible needs the internet for now.
- **Lower Thirds:** type a name and title and Add to Preview, or Save to list for a one-click tile. **Content** is still a note (the next step).
- **The camera picture is locked.** Only verses and names can be dragged and resized in Preview.
- **Setup (two pages):** *Setup* has everyday items (camera, YouTube, TV, recording). *Advanced* has rarely changed items.

## Tests (about 45 minutes, plus the stream hour)

### A. Layout
1. Maximize the window. **Expected:** Preview touches the left screen edge, Output touches the right edge, and the bottom area fills everything under them with **no empty band** in between.
2. Resize the window smaller and larger. **Expected:** it always fits, with no scrollbars on the main screen.
3. Tell me what still looks cluttered, cramped, or hard to find. A screenshot helps most.

### B. Bible and Preview
1. Scroll the book list, tap **John**, tap chapter **3**, tap verse **16**. **Expected:** a verse banner appears in Preview only, and SEND glows.
2. Tap **+ Next verse** twice. **Expected:** the banner grows to verses 16 to 18.
3. Drag the banner and drag a corner. **Expected:** it moves and resizes, and the text refits. Output does not change.
4. Press **Save verse**, then pick other verses and save a few more. **Expected:** they appear under Saved this service. Tap one: it goes to Preview. Tap its x: it is removed.
5. Close and reopen the app. **Expected:** the saved list is empty.
6. Try the other translations. Try a long chapter such as Psalm 119.
7. Click the camera picture in Preview and try to drag it. **Expected:** nothing moves.

### C. Output, tech error, and audio
1. Press **SEND**. **Expected:** a short fade to Output.
2. Make some noise near the microphone. **Expected:** the two level bars move. Press **Mute**: the bars drop to zero and the button says Muted. Press it again to unmute.
3. Press **TECH ERROR**. **Expected:** the blue screen appears instantly, the audio is cut (bars at zero), and the button reads END TECH ERROR. Press it. **Expected:** the previous Output and the audio come back.
4. Do the same thing while streaming (use the test file option) and play the recording back. **Expected:** the picture shows the tech screen and the sound is silent for that time.
5. Press **CLEAR ALL**. **Expected:** the plain camera.

### D. Lower thirds and the rest
Add a name from Lower Thirds, SEND it, and remove it with the x under Output. Check Undo, Redo, Remove selected, the Delete key, and arrow keys on a selected overlay.

### E. YouTube (see YOUTUBE-SETUP.md first)
Same as before: sign in once, set the title template, press START STREAM, check the checklist and the broadcast in YouTube Studio, press STOP STREAM. **I could not test this against real YouTube. Send me any red message.**

### F. Stream hour, recovery, and the volunteer test
The one-hour stream, End task and reopen (Preview, Output, and settings come back), and the volunteer test: sit someone new in front of it and say only *"put John 3:16 up, take it off, then show the be-right-back screen"*. Write down every hesitation.

## What to send back
Screenshots of the full window and of Setup, any red message, the diagnostics list after the long stream, and the volunteer's hesitation notes.

---

# Quick Card (first draft)

**Before service:** open Church Switcher. Check the status lights (Camera, Audio). Press **START STREAM**, read the checklist, press START again.

**Show a verse:** on the Bible page, tap the book, the chapter, then the verse. Check Preview. Press **SEND**.

**Show a name:** open **Lower Thirds**, tap the name, press **SEND**.

**Take something off:** click the x next to it under Output, or press **CLEAR ALL**.

**If something goes wrong:** press **TECH ERROR**. The audio cuts and the "please stand by" screen shows. Press **END TECH ERROR** when it is fixed.

**After service:** press **STOP STREAM** and confirm. The backup recording saves automatically.

**Who to call:** ______________________
