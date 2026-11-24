# Beacon: what is in this version

## The name
The app is called **Beacon**. The name lives in one place: `"productName"` in `package.json`. Change it there and the window title, the top bar, the recordings folder and the logs folder all follow. (Your saved settings, pictures and YouTube sign-in stay where they are, so renaming never loses them.)

## Settings (fewer, bigger pages)
- **Full lower thirds**: the Bible verse, Welcome, Thank you, Service starting, Follow us, Give (QR) and Your own message, all on one page. Pick the kind along the top, then its design and everything about it.
- **Slide-in (names)**: the small two-line plate. It does not use pictures.
- **Pictures**: the library of picture backgrounds for the full lower thirds.
- **Camera & sound**: camera, audio device, and the sound viewers hear when a video plays.
- **Stream & recording**: what Start does, the recording folder, YouTube, video quality.
- **Status & log**.

## Design library
- 26 drawn designs in 18 different shapes (classic bar, ribbon, split block, angled, top stripe, solid, neon, glass, frame, outline, card, fade out, wave, lights, pinstripes, minimal...), plus the 10 pictures. Pick one and the kind takes the colours, shape, text style and animation. Tick the box to use it for every full lower third (each keeps its own animation).
- The slide-in has its own 14 name plates made for a name and a title: plate, two blocks, bar and strip, tag, underline, pill, slanted, glass, solid, box.
- You can still mix your own: pick any shape, then change the colours, fonts and sizes.

## Animation
- Entrances and exits: Fade, Rise, Slide in, Wipe, Zoom, Drop in and bounce, Unfold, Swing up, Type the words on, Cut.
- Every kind starts with a different one, and also moves its own way: Welcome's lettering tightens, Thank you rises slowly, the countdown ticks each second, Follow us pulses rings around its icons, Give sweeps a scan line over the QR code, your message types itself on.

## Countdown
- **Countdown**: N minutes from the moment it goes on the Output.
- **Until service starts**: counts down to the time you set under Settings > Full lower thirds > Service starting. One tap on Sunday.

## SEND
- A lower third in Preview is waiting to go up. After SEND (or one-tap) it leaves Preview, and Preview is empty for the next one. A SEND with an empty Preview does not touch the Output. Use Clear All or the x on the lower third to take it off.
- Stepping through Bible verses updates the Output only.

## Recording and streaming
- Settings > Stream & recording > **When you press Start**: *Stream and save a backup recording*, *Stream only*, or *Record only* (nothing goes to the internet, and no YouTube sign-in is needed). The Start button reads START STREAM or START RECORDING to match.
- Recordings go to **Videos\Beacon** by default (your Videos folder, in a folder named after the app). Change it with the Change button, or Use the default.
- Recordings are MP4 files written in a way that survives the app or the PC stopping suddenly.

## Tests
1. Settings > Full lower thirds: click through the kinds and designs. Tick "use for ALL full lower thirds" and click one.
2. Slide-in: try several plates, then use one on the Show screen and drag it around.
3. Lower Thirds tab: add a name, press SEND: Preview empties. Set the service time and tap Until service starts.
4. Try record only with a camera running, then open Videos\Beacon.
5. Tap Welcome, Thank you, Follow us, Give and your own message and watch each come in.

**Not tested in real Electron or with real ffmpeg.** Recording and streaming still need a trial on the church PC (record only first, then stream with a backup).
