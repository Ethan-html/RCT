"""
Motion zones + automatic preset switching for Redcam.

How it works
------------
* Watches a camera input on this computer (USB / capture card) or, if none is chosen, the IP camera's snapshot.jpg.
* Divides the picture into a 32 x 18 grid. A "zone" is a set of painted grid cells that
  belongs to ONE preset (the preset the camera is sitting at) and points at a TARGET preset.
* While the camera is parked on a preset, motion inside that preset's zones for long enough
  recalls the zone's target preset.
* Optional conditions per zone: only between two times and/or only on chosen weekdays.
* Reads the camera's real pan/tilt/zoom (VISCA over TCP, port 5678) so it knows when the
  camera was moved by hand, or recalled from somewhere else, and pauses / re-syncs.

Everything lives in tracker.json (next to settings.json).
"""
import math
import os
from pathlib import Path
import re
import socket
import threading
import time
import uuid
from datetime import datetime
import base64

try:
    import cv2
    import numpy as np
    CV_ERROR = ""
except Exception as _exc:  # pragma: no cover
    cv2 = np = None
    CV_ERROR = f"OpenCV is not installed ({_exc}). Run: pip install opencv-python-headless numpy"

from flask import Response, jsonify, request, send_from_directory


GRID_W, GRID_H = 32, 18
CELLS = GRID_W * GRID_H
AN_W, AN_H = 320, 180            # analysis size: exactly 10 x 10 pixels per grid cell
MAX_RULES = 60
MAX_PRESET = 50
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

DEFAULT_SETTINGS = {
    "defaultPreset": 0,                  # preset the camera goes to when tracking starts (0 = none)
    "autoStart": False,                  # start tracking by itself when the app launches
    "minGap": 8.0,                       # seconds that must pass between automatic switches
    "minPerson": 0.4,                    # smallest moving thing counted as a person, % of the picture
    "positionReadback": True,            # read pan/tilt/zoom to notice manual moves
    "tolerance": 20,                     # how far (VISCA units) the camera may drift from a preset
    "viscaPort": 5678,
}


def _clamp(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _hhmm_to_min(s):
    return int(s[:2]) * 60 + int(s[3:])


def clean_rule(raw, fallback_id=None):
    if not isinstance(raw, dict):
        return None
    try:
        source = int(raw.get("source"))
        target = int(raw.get("target"))
    except (TypeError, ValueError):
        return None
    if not (1 <= source <= MAX_PRESET and 1 <= target <= MAX_PRESET):
        return None
    cells = "".join("1" if c == "1" else "0" for c in str(raw.get("cells", "")))[:CELLS].ljust(CELLS, "0")
    days = []
    for d in raw.get("days", []) if isinstance(raw.get("days"), list) else []:
        try:
            d = int(d)
        except (TypeError, ValueError):
            continue
        if 0 <= d <= 6 and d not in days:
            days.append(d)
    start = str(raw.get("start", "08:00"))
    end = str(raw.get("end", "17:00"))
    return {
        "id": str(raw.get("id") or fallback_id or uuid.uuid4().hex[:8])[:16],
        "name": (str(raw.get("name", "")).strip() or "Zone")[:40],
        "source": source,
        "target": target,
        "cells": cells,
        "enabled": bool(raw.get("enabled", True)),
        # exit  = someone walks out of the picture through this zone (default)
        # enter = any motion inside the zone
        "mode": "enter" if raw.get("mode") == "enter" else "exit",
        "sensitivity": round(_clamp(raw.get("sensitivity"), 1, 60, 6), 1),   # enter mode: % of the zone that must move
        "hold": round(_clamp(raw.get("hold"), 0, 10, 0.8), 1),               # exit: seconds gone; enter: seconds of motion
        "condEnabled": bool(raw.get("condEnabled", False)),
        "start": start if TIME_RE.match(start) else "08:00",
        "end": end if TIME_RE.match(end) else "17:00",
        "days": sorted(days),                                                # 0 = Monday ... 6 = Sunday; empty = every day
    }


def clean_settings(raw):
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_SETTINGS)
    out["defaultPreset"] = int(_clamp(raw.get("defaultPreset", out["defaultPreset"]), 0, MAX_PRESET, 0))
    out["autoStart"] = bool(raw.get("autoStart", out["autoStart"]))
    out["minGap"] = round(_clamp(raw.get("minGap", out["minGap"]), 1, 300, 8), 1)
    out["minPerson"] = round(_clamp(raw.get("minPerson", out["minPerson"]), 0.05, 10, 0.4), 2)
    out["positionReadback"] = bool(raw.get("positionReadback", out["positionReadback"]))
    out["tolerance"] = int(_clamp(raw.get("tolerance", out["tolerance"]), 2, 400, 20))
    out["viscaPort"] = int(_clamp(raw.get("viscaPort", out["viscaPort"]), 1, 65535, 5678))
    return out


def condition_ok(rule, now):
    """True if `now` (a datetime) is inside the rule's optional time window / weekdays."""
    if not rule.get("condEnabled"):
        return True
    mins = now.hour * 60 + now.minute
    s, e = _hhmm_to_min(rule["start"]), _hhmm_to_min(rule["end"])
    wd = now.weekday()
    if s == e:                       # same start and end = all day
        in_window, day_ref = True, wd
    elif s < e:
        in_window, day_ref = (s <= mins < e), wd
    else:                            # overnight window, e.g. 22:00 -> 02:00 belongs to the day it started
        if mins >= s:
            in_window, day_ref = True, wd
        elif mins < e:
            in_window, day_ref = True, (wd - 1) % 7
        else:
            in_window, day_ref = False, wd
    if not in_window:
        return False
    days = rule.get("days") or []
    return (not days) or day_ref in days


# ------------------------------------------------------------------ VISCA (camera position)
def _visca(sock, cmd, length):
    sock.sendall(cmd)
    buf = b""
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        try:
            chunk = sock.recv(64)
        except socket.timeout:
            break
        if not chunk:
            break
        buf += chunk
        i = buf.find(b"\x90\x50")
        if i >= 0 and len(buf) >= i + length:
            return buf[i:i + length]
        if b"\x90\x60" in buf:       # camera answered "not supported / error"
            return None
    return None


def _s16(b):
    v = ((b[0] & 15) << 12) | ((b[1] & 15) << 8) | ((b[2] & 15) << 4) | (b[3] & 15)
    return v - 65536 if v >= 32768 else v


def parse_position(pt, z):
    return {
        "pan": _s16(pt[2:6]),
        "tilt": _s16(pt[6:10]),
        "zoom": ((z[2] & 15) << 12) | ((z[3] & 15) << 8) | ((z[4] & 15) << 4) | (z[5] & 15),
    }


def read_position(ip, port, timeout=1.2):
    """Ask the camera where it is pointing. Returns {pan,tilt,zoom} or None."""
    if not ip:
        return None
    try:
        with socket.create_connection((ip, port), timeout=timeout) as s:
            s.settimeout(timeout)
            pt = _visca(s, b"\x81\x09\x06\x12\xff", 11)
            z = _visca(s, b"\x81\x09\x04\x47\xff", 7)
    except OSError:
        return None
    if not pt or not z:
        return None
    return parse_position(pt, z)


def pos_close(a, b, tol):
    return (abs(a["pan"] - b["pan"]) <= tol and abs(a["tilt"] - b["tilt"]) <= tol
            and abs(a["zoom"] - b["zoom"]) <= tol * 3)


# ------------------------------------------------------------------ video inputs on this computer
if cv2 is not None:
    BACKEND = cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
else:  # pragma: no cover
    BACKEND = 0


def _open_device(index):
    """Open a camera / capture card. Returns a capture that has already delivered a frame, or None."""
    for attempt in ("fast", "plain"):
        cap = None
        try:
            cap = cv2.VideoCapture(index, BACKEND)
            if cap is None or not cap.isOpened():
                if cap is not None:
                    cap.release()
                return None                                  # nothing there: don't retry
            if attempt == "fast":                            # most capture cards are much smoother as MJPG
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                cap.set(cv2.CAP_PROP_FPS, 30)
            for _ in range(30):
                ok, frame = cap.read()
                if ok and frame is not None:
                    try:
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    return cap
                time.sleep(0.05)
        except Exception:
            pass
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
    return None


def _thumb(frame, w=176):
    h = max(1, int(frame.shape[0] * w / frame.shape[1]))
    ok, buf = cv2.imencode(".jpg", cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 65])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else ""


# ------------------------------------------------------------------ engine
class Engine:
    def __init__(self, env):
        self.env = env
        self.lock = threading.RLock()
        stored = env["load_json"](env["file"], {})
        self.settings = clean_settings(stored.get("settings"))
        self.rules = []
        for r in stored.get("rules", []) if isinstance(stored.get("rules"), list) else []:
            c = clean_rule(r)
            if c:
                self.rules.append(c)
        self.sigs = {}
        for k, v in (stored.get("signatures") or {}).items():
            try:
                self.sigs[str(int(k))] = {"pan": int(v["pan"]), "tilt": int(v["tilt"]), "zoom": int(v["zoom"])}
            except (TypeError, ValueError, KeyError):
                pass
        self._masks = {}
        self._rebuild_masks()

        self.armed = False
        self.state = "idle"          # idle (no preset known) | settling | ready | manual
        self.current = None
        self.message = "Choose which preset the camera is on"
        self.source = "none"         # device | snapshot | none
        self.video_note = "Snapshots from the IP camera"
        self.fps = 0.0
        self.pos = None
        self.readback = "unknown"    # unknown | ok | unavailable
        self.rule_stat = {}
        self.events = []
        self.last_view = 0.0
        self.last_switch = 0.0
        self.last_frame_at = 0.0
        self.warm_until = 0.0
        self.reset_bg = True
        self.hit_since = {}
        self.jpeg = b""
        self.frame_id = 0
        self.person = None           # [x0,y0,x1,y1] (0..1) of the person to draw, or None
        self.track = None
        self._disp, self._disp_at = None, 0.0
        self._last_small = None
        self._last_frame = None      # newest full-size picture, for scene thumbnails
        self._thread = None
        self._poll_thread = None
        self._video_gen = 0          # bumped when the chosen camera input changes
        self._dev_wanted = -1
        self._open_index = -1
        self._pending = None
        self._connecting = False
        self._device_lock = threading.Lock()
        self._k3 = np.ones((3, 3), np.uint8) if np is not None else None
        self._k5 = np.ones((5, 5), np.uint8) if np is not None else None

    # ---- persistence
    def _save(self):
        with self.lock:
            data = {
                "settings": self.settings,
                "rules": [dict(r) for r in self.rules],
                "signatures": self.sigs,
            }
        self.env["save_json"](self.env["file"], data)

    def _rebuild_masks(self):
        self._masks = {}
        for r in self.rules:
            self._masks[r["id"]] = np.frombuffer(r["cells"].encode(), dtype=np.uint8) == 49 if np is not None else None

    def set_config(self, payload):
        with self.lock:
            if isinstance(payload.get("settings"), dict):
                self.settings = clean_settings(payload["settings"])
            if isinstance(payload.get("rules"), list):
                rules = []
                for r in payload["rules"][:MAX_RULES]:
                    c = clean_rule(r)
                    if c:
                        rules.append(c)
                self.rules = rules
                self._rebuild_masks()
                self.hit_since.clear()
                self.track = None
        self._save()

    def config(self):
        with self.lock:
            return {"settings": dict(self.settings), "rules": [dict(r) for r in self.rules],
                    "signatures": dict(self.sigs)}

    def reload_video(self):
        self._video_gen += 1

    # ---- events / status
    def _event(self, text):
        with self.lock:
            self._event_locked(text)

    def _event_locked(self, text):
        self.events.append({"t": datetime.now().strftime("%H:%M:%S"), "text": text})
        self.events = self.events[-30:]

    def status(self):
        with self.lock:
            return {
                "available": cv2 is not None,
                "error": CV_ERROR,
                "armed": self.armed,
                "state": self.state,
                "message": self.message,
                "current": self.current,
                "source": self.source,
                "device": self._open_index,
                "videoNote": self.video_note,
                "person": self.person,
                "fps": round(self.fps, 1),
                "pos": self.pos,
                "readback": self.readback,
                "signatures": self.sigs,
                "rules": self.rule_stat,
                "events": self.events[-10:],
            }

    def touch_view(self):
        self.last_view = time.time()

    def _want(self):
        return self.armed or (time.time() - self.last_view < 8)

    # ---- lifecycle
    def ensure_running(self):
        if cv2 is None:
            return
        with self.lock:
            if not (self._thread and self._thread.is_alive()):
                self._thread = threading.Thread(target=self._loop, daemon=True)
                self._thread.start()
            if not (self._poll_thread and self._poll_thread.is_alive()):
                self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
                self._poll_thread.start()

    def arm(self, on):
        with self.lock:
            if on and self.current is None:
                raise ValueError("Choose which preset the camera is on first")
            if on and cv2 is None:
                raise ValueError(CV_ERROR)
            changed = self.armed != on
            self.armed = on
            if on:
                self.reset_bg = True
                self.warm_until = time.monotonic() + 2.0
                self.hit_since.clear()
        if changed:
            self._event("Tracking ON" if on else "Tracking OFF")
        if on:
            self.ensure_running()

    # ---- preset switching
    def select(self, preset, move=True, reason="Manual", trigger=False):
        """Go to (or declare we are at) a preset. Runs in the background; poll status()."""
        preset = int(preset)
        if not (1 <= preset <= MAX_PRESET):
            raise ValueError("Invalid preset")
        with self.lock:
            if self.state == "settling" and trigger:
                return
            self.state = "settling"
            self.current = preset
            self.message = f"Moving to preset {preset}..." if move else f"Reading position for preset {preset}..."
        self.ensure_running()
        threading.Thread(target=self._switch_worker, args=(preset, move, reason), daemon=True).start()

    def _switch_worker(self, preset, move, reason):
        try:
            if move:
                self.env["camera_get"](f"cgi-bin/ptzctrl.cgi?ptzcmd&poscall&{preset}")
                self._event(f"{reason}: went to preset {preset}")
            else:
                self._event(f"{reason}: camera is on preset {preset}")
            pos = self._wait_stable()
            with self.lock:
                if pos:
                    self.sigs[str(preset)] = pos
                    self.pos = pos
                self.reset_bg = True
                self.warm_until = time.monotonic() + 2.5
                self.hit_since.clear()
                self.track = None
                self.last_switch = time.monotonic()
                self.current = preset
                self.state = "ready"
                self.message = f"On preset {preset}"
            if pos:
                self._save()
        except Exception as exc:
            with self.lock:
                self.state = "idle" if self.current is None else "manual"
                self.message = f"Could not reach the camera: {exc}"
            self._event(f"Error: {exc}")

    def _wait_stable(self):
        """Wait until the camera stops moving. Returns the final position, or None without readback."""
        st = self.env["get_settings"]()
        ip, port = str(st.get("ip", "")).strip(), self.settings["viscaPort"]
        if not self.settings["positionReadback"] or self.readback == "unavailable":
            time.sleep(2.2)
            return None
        time.sleep(0.7)
        last, started = None, time.monotonic()
        while time.monotonic() - started < 14:
            p = read_position(ip, port)
            if p is None:
                if last is None:
                    with self.lock:
                        self.readback = "unavailable"
                    time.sleep(max(0, 2.2 - (time.monotonic() - started)))
                    return None
                break
            with self.lock:
                self.readback = "ok"
            if last and abs(p["pan"] - last["pan"]) <= 2 and abs(p["tilt"] - last["tilt"]) <= 2 \
                    and abs(p["zoom"] - last["zoom"]) <= 6 and time.monotonic() - started > 1.0:
                return p
            last = p
            time.sleep(0.35)
        return last

    # ---- position watcher (notices manual moves)
    def _poll_loop(self):
        mismatch = fails = 0
        last_try = 0.0
        while self._want():
            for _ in range(15):
                if not self._want():
                    return
                time.sleep(0.1)
            if not self.settings["positionReadback"] or self.state == "settling":
                continue
            if self.readback == "unavailable" and time.monotonic() - last_try < 20:
                continue
            last_try = time.monotonic()
            s = self.env["get_settings"]()
            pos = read_position(str(s.get("ip", "")).strip(), self.settings["viscaPort"])
            if pos is None:
                fails += 1
                if fails >= 3:
                    with self.lock:
                        self.readback = "unavailable"
                        self.pos = None
                continue
            fails = 0
            tol = self.settings["tolerance"]
            with self.lock:
                self.readback, self.pos = "ok", pos
                if self.state not in ("ready", "manual"):
                    continue
                sig = self.sigs.get(str(self.current)) if self.current else None
                if self.state == "ready" and sig and pos_close(pos, sig, tol):
                    mismatch = 0
                    continue
                if self.state == "ready" and not sig and self.current:
                    self.sigs[str(self.current)] = pos
                    continue
                best, best_d = None, None
                for k, v in self.sigs.items():
                    if pos_close(pos, v, tol):
                        d = abs(pos["pan"] - v["pan"]) + abs(pos["tilt"] - v["tilt"]) + abs(pos["zoom"] - v["zoom"]) / 3
                        if best is None or d < best_d:
                            best, best_d = int(k), d
                if best is not None:
                    if self.state == "manual" or best != self.current:
                        self.current, self.state = best, "ready"
                        self.message = f"Camera is on preset {best}"
                        self.reset_bg, self.hit_since = True, {}
                        self.warm_until = time.monotonic() + 2.5
                        self._event_locked(f"Camera found on preset {best}")
                    mismatch = 0
                elif self.state == "ready":
                    mismatch += 1
                    if mismatch >= 2:
                        self.state = "manual"
                        self.message = "The camera was moved by hand. Zones are paused."
                        self._event_locked("Camera moved by hand: zones paused")
                        mismatch = 0

    def learn(self, preset):
        s = self.env["get_settings"]()
        pos = read_position(str(s.get("ip", "")).strip(), self.settings["viscaPort"])
        if not pos:
            raise ValueError("Could not read the camera position")
        with self.lock:
            self.sigs[str(int(preset))] = pos
        self._save()
        return pos

    # ---- video: a camera input on this computer, or snapshots from the IP camera
    def scan_devices(self, limit=8):
        """Look for camera inputs on this computer. Each result carries a small live thumbnail."""
        out = []
        if cv2 is None:
            return out
        with self._device_lock:
            for i in range(limit):
                if i == self._open_index:                     # we are using it right now
                    small = self._last_small
                    h, w = (small.shape[:2] if small is not None else (0, 0))
                    out.append({"index": i, "label": f"Camera input {i}", "inUse": True,
                                "width": w, "height": h, "thumb": _thumb(small) if small is not None else ""})
                    continue
                cap = None
                try:
                    cap = cv2.VideoCapture(i, BACKEND)
                    if cap is None or not cap.isOpened():
                        continue
                    frame = None
                    for _ in range(20):
                        ok, f = cap.read()
                        if ok and f is not None and f.mean() > 0.5:
                            frame = f
                            break
                        time.sleep(0.05)
                    if frame is None:
                        continue
                    h, w = frame.shape[:2]
                    out.append({"index": i, "label": f"Camera input {i}", "inUse": False,
                                "width": w, "height": h, "thumb": _thumb(frame)})
                except Exception:
                    pass
                finally:
                    if cap is not None:
                        try:
                            cap.release()
                        except Exception:
                            pass
        return out

    def _start_connect(self, gen, index):
        if self._connecting:
            return
        self._connecting = True
        threading.Thread(target=self._connect_device, args=(gen, index), daemon=True).start()

    def _connect_device(self, gen, index):
        """Runs in the background so snapshots keep flowing while the device opens."""
        try:
            self.video_note = f"Opening camera input {index}..."
            with self._device_lock:
                cap = _open_device(index)
            if cap is None:
                self.video_note = f"Camera input {index} is not available. Using snapshots from the IP camera."
                return
            if gen != self._video_gen or not self._want():
                cap.release()
                return
            with self.lock:
                old, self._pending = self._pending, (cap, index, gen)
            if old:
                old[0].release()
            self.video_note = f"Using camera input {index}"
        except Exception as exc:
            self.video_note = f"Camera input error: {exc}"
        finally:
            self._connecting = False

    def snapshot_jpeg(self, width=960, wait=5.0):
        """A fresh, larger picture from the chosen camera input (for scene thumbnails). None if it isn't live."""
        if cv2 is None:
            return None
        self.touch_view()
        self.ensure_running()
        start = self.frame_id
        t0 = time.time()
        while time.time() - t0 < wait:
            self.touch_view()
            if self.source == "device" and self._last_frame is not None and self.frame_id > start + 1:
                break
            time.sleep(0.05)
        else:
            return None
        frame = self._last_frame
        h = max(1, int(frame.shape[0] * width / frame.shape[1]))
        ok, buf = cv2.imencode(".jpg", cv2.resize(frame, (width, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes() if ok else None

    def _snapshot_frame(self):
        try:
            data = self.env["camera_get"]("snapshot.jpg", timeout=3)
            return cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        except Exception:
            return None

    def _loop(self):
        cap, fails, retry_at, last_cfg = None, 0, 0.0, 0.0
        gen = self._video_gen
        mog, last_proc, fps_n, fps_t = None, 0.0, 0, time.monotonic()
        try:
            while self._want():
                now = time.monotonic()
                if now - last_cfg > 1.0:                       # follow the Settings choice
                    last_cfg = now
                    try:
                        dev = int(self.env["get_settings"]().get("videoDevice", -1))
                    except (TypeError, ValueError):
                        dev = -1
                    if dev != self._dev_wanted:
                        self._dev_wanted = dev
                        self._video_gen += 1
                        if dev < 0:
                            self.video_note = "Snapshots from the IP camera"
                if gen != self._video_gen:                     # input changed: drop the old one, reconnect
                    gen = self._video_gen
                    if cap is not None:
                        cap.release()
                        cap, self._open_index = None, -1
                        self.source = "none"
                    retry_at = 0.0
                if cap is None and self._dev_wanted >= 0:
                    if now >= retry_at and not self._connecting:
                        self._start_connect(gen, self._dev_wanted)
                        retry_at = now + 12
                    with self.lock:
                        pend, self._pending = self._pending, None
                    if pend:
                        if pend[2] == gen:
                            cap, self._open_index, fails = pend[0], pend[1], 0
                            self.reset_bg = True
                            self.warm_until = time.monotonic() + 2.0
                        else:
                            pend[0].release()

                frame = None
                if cap is not None:
                    if not cap.grab():
                        fails += 1
                        if fails > 20:
                            cap.release()
                            cap, self._open_index, fails, retry_at = None, -1, 0, now + 3
                            self.video_note = "Camera input lost. Using snapshots while it reconnects."
                        time.sleep(0.04)
                        continue
                    fails = 0
                    if now - last_proc < 0.1:
                        continue
                    ok, frame = cap.retrieve()
                    if not ok:
                        frame = None
                    mode = "device"
                else:
                    if now - last_proc < 0.25:
                        time.sleep(0.03)
                        continue
                    frame = self._snapshot_frame()
                    mode = "snapshot"
                if frame is None:
                    if now - self.last_frame_at > 5:
                        self.source = "none"
                    time.sleep(0.05)
                    continue
                last_proc = now
                self.last_frame_at = now
                self.source = mode
                mog = self._process(frame, mog, self._k3)
                fps_n += 1
                if now - fps_t >= 1.0:
                    self.fps = fps_n / (now - fps_t)
                    fps_n, fps_t = 0, now
        finally:
            if cap is not None:
                cap.release()
            with self.lock:
                if self._pending:
                    self._pending[0].release()
                    self._pending = None
            self._video_gen += 1
            self._open_index = -1
            self.source, self.fps, self.person, self.jpeg = "none", 0.0, None, b""

    # ---- analysis
    def _find_person(self, fg):
        """Biggest moving blob (the person) as (x, y, w, h) in analysis pixels, or None."""
        m = cv2.dilate(fg, self._k5, iterations=2)          # glue head / body / legs together
        n, _, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        if n <= 1:
            return None
        i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < AN_W * AN_H * self.settings["minPerson"] / 100.0:
            return None
        return x, y, w, h

    @staticmethod
    def _overlap(box, z):
        """How many zone cells the person's box (plus a one-cell margin) touches."""
        x, y, w, h = box
        cw, ch = AN_W // GRID_W, AN_H // GRID_H
        c0, c1 = max(0, x // cw - 1), min(GRID_W - 1, (x + w - 1) // cw + 1)
        r0, r1 = max(0, y // ch - 1), min(GRID_H - 1, (y + h - 1) // ch + 1)
        return int(z.reshape(GRID_H, GRID_W)[r0:r1 + 1, c0:c1 + 1].sum())

    @staticmethod
    def _heading_box(track):
        """The person's last box, stretched ~0.4 s further in the direction they were walking."""
        x, y, w, h = track["bbox"]
        hist = track["hist"]
        if len(hist) >= 2 and hist[-1][0] - hist[0][0] >= 0.25:
            dt = hist[-1][0] - hist[0][0]
            vx, vy = (hist[-1][1] - hist[0][1]) / dt, (hist[-1][2] - hist[0][2]) / dt
            dx, dy = max(-AN_W, min(AN_W, vx * 0.4)), max(-AN_H, min(AN_H, vy * 0.4))
            x0, y0, x1, y1 = x + min(0, dx), y + min(0, dy), x + w + max(0, dx), y + h + max(0, dy)
            return int(x0), int(y0), int(max(1, x1 - x0)), int(max(1, y1 - y0))
        return x, y, w, h

    @staticmethod
    def _was_moving(track):
        h = track["hist"]
        if len(h) < 2 or h[-1][0] - h[0][0] < 0.25:
            return False
        return math.hypot(h[-1][1] - h[0][1], h[-1][2] - h[0][2]) >= 8   # someone who stood still is not "leaving"

    def _process(self, frame, mog, kernel):
        small = cv2.resize(frame, (AN_W, AN_H), interpolation=cv2.INTER_AREA)
        self._last_small = small
        self._last_frame = frame
        gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        if mog is None or self.reset_bg:
            mog = cv2.createBackgroundSubtractorMOG2(history=250, varThreshold=28, detectShadows=False)
            self.reset_bg = False
        # Learn quickly while warming up, then very slowly, so a person standing still is not
        # absorbed into the background after a second (and no ghost is left when they leave).
        lr = -1 if time.monotonic() < self.warm_until else 0.003
        fg = cv2.morphologyEx(mog.apply(gray, learningRate=lr), cv2.MORPH_OPEN, kernel)
        cells = (fg > 0).astype(np.float32).reshape(GRID_H, AN_H // GRID_H, GRID_W, AN_W // GRID_W).mean(axis=(1, 3))
        flat = (cells >= 0.25).reshape(-1)

        if time.time() - self.last_view < 8:     # only build pictures when someone is watching
            disp = cv2.resize(frame, (640, 360), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", disp, [cv2.IMWRITE_JPEG_QUALITY, 72])
            if ok:
                self.jpeg = buf.tobytes()
                self.frame_id += 1

        now = time.monotonic()
        if now < self.warm_until or self.state != "ready":
            self.rule_stat, self.person, self.track, self._disp = {}, None, None, None
            return mog
        if flat.mean() > 0.5:                      # lights changed / camera shook: start over
            self.reset_bg, self.warm_until = True, now + 1.5
            self.person, self.track, self._disp = None, None, None
            self.hit_since.clear()
            return mog

        # ---- find the person
        box = self._find_person(fg)
        t = self.track
        if box:
            x, y, w, h = box
            if t is None:
                t = self.track = {"hist": []}
            t["bbox"], t["last"] = box, now
            t["hist"].append((now, x + w / 2.0, y + h / 2.0))
            t["hist"] = [e for e in t["hist"] if now - e[0] <= 1.5]
            nb = (x / AN_W, y / AN_H, (x + w) / AN_W, (y + h) / AN_H)
            self._disp = nb if self._disp is None else tuple(0.55 * n + 0.45 * o for n, o in zip(nb, self._disp))
            self._disp_at = now
        elif t is not None and now - t["last"] > 3.0:
            t = self.track = None
        # keep drawing the box for a moment after the person disappears, so it doesn't flicker
        self.person = [round(v, 4) for v in self._disp] if (self._disp and now - self._disp_at < 0.6) else None

        # ---- decide
        wall = datetime.now()
        stats, fire = {}, None
        with self.lock:
            rules = [r for r in self.rules if r["source"] == self.current and r["enabled"]]
            cur_armed = self.armed
            gap_ok = now - self.last_switch >= self.settings["minGap"]
        for r in rules:
            z = self._masks.get(r["id"])
            n = int(z.sum()) if z is not None else 0
            if n == 0:
                continue
            cond = condition_ok(r, wall)
            if r["mode"] == "enter":
                hits = int((flat & z).sum())
                need = 1 if n < 2 else max(2, math.ceil(n * r["sensitivity"] / 100.0))
                hit = hits >= need
                stats[r["id"]] = {"frac": round(hits / n, 3), "need": round(need / n, 3), "cond": cond, "hit": hit}
                if hit and cond:
                    since = self.hit_since.setdefault(r["id"], now)
                    if cur_armed and gap_ok and fire is None and now - since >= r["hold"]:
                        fire = r
                else:
                    self.hit_since.pop(r["id"], None)
                continue
            # exit mode: the person was moving, touched this zone, then vanished
            frac = 0.0
            if t is not None and "bbox" in t:
                in_zone = self._overlap(t["bbox"], z) > 0
                if box is not None:
                    frac = 0.5 if in_zone else 0.0               # person is in the zone right now
                elif self._was_moving(t) and (in_zone or self._overlap(self._heading_box(t), z) > 0):
                    frac = min(1.0, (now - t["last"]) / max(0.05, r["hold"]))
            hit = frac >= 1.0
            stats[r["id"]] = {"frac": round(frac, 3), "need": 1.0, "cond": cond, "hit": hit}
            if hit and cond and cur_armed and gap_ok and fire is None:
                fire = r
        self.rule_stat = stats
        if fire is not None:
            self.track = None
            self.select(fire["target"], move=True, reason=f'Zone "{fire["name"]}"', trigger=True)
        return mog


ENGINE = None


def init(app, resource_dir, data_dir, camera_get, get_settings, load_json, save_json, camera_errors=(),
         settings_file=None):
    """Register the /tracker page and the tracking + video-input routes on the Flask app."""
    global ENGINE
    ENGINE = Engine({
        "file": data_dir / "tracker.json",
        "camera_get": camera_get,
        "get_settings": get_settings,
        "load_json": load_json,
        "save_json": save_json,
    })
    eng = ENGINE

    def fail(msg, code=400):
        return jsonify({"status": "error", "message": str(msg)}), code

    @app.route("/tracker")
    def tracker_page():
        return send_from_directory(resource_dir, "tracker.html")

    @app.route("/api/tracker/config", methods=["GET", "POST"])
    def tracker_config():
        if request.method == "POST":
            eng.set_config(request.get_json(silent=True) or {})
            return jsonify({"status": "ok"})
        return jsonify(eng.config())

    @app.route("/api/tracker/status")
    def tracker_status():
        return jsonify(eng.status())

    @app.route("/api/tracker/select", methods=["POST"])
    def tracker_select():
        p = request.get_json(silent=True) or {}
        try:
            eng.select(p.get("preset"), move=bool(p.get("move", True)), reason="Manual")
        except (TypeError, ValueError) as exc:
            return fail(exc)
        return jsonify({"status": "ok"})

    @app.route("/api/tracker/arm", methods=["POST"])
    def tracker_arm():
        p = request.get_json(silent=True) or {}
        try:
            eng.arm(bool(p.get("armed")))
        except ValueError as exc:
            return fail(exc)
        return jsonify({"status": "ok"})

    @app.route("/api/tracker/position")
    def tracker_position():
        s = get_settings()
        pos = read_position(str(s.get("ip", "")).strip(), eng.settings["viscaPort"])
        if not pos:
            return fail("The camera did not answer position requests on port "
                        f'{eng.settings["viscaPort"]}. Zones still work, but hand-moved cameras cannot be detected.')
        return jsonify({"status": "ok", "pos": pos})

    @app.route("/api/tracker/learn", methods=["POST"])
    def tracker_learn():
        p = request.get_json(silent=True) or {}
        try:
            return jsonify({"status": "ok", "pos": eng.learn(p.get("preset"))})
        except (TypeError, ValueError) as exc:
            return fail(exc)

    # ---- video input
    @app.route("/api/video/devices")
    def video_devices():
        if cv2 is None:
            return fail(CV_ERROR, 503)
        return jsonify({"status": "ok", "devices": eng.scan_devices()})

    @app.route("/api/video/device", methods=["POST"])
    def video_device():
        p = request.get_json(silent=True) or {}
        try:
            idx = int(p.get("index", -1))
        except (TypeError, ValueError):
            return fail("Invalid camera input")
        idx = max(-1, min(31, idx))
        if settings_file is not None:
            cur = load_json(settings_file, {})
            cur["videoDevice"] = idx
            save_json(settings_file, cur)
        eng.reload_video()
        return jsonify({"status": "ok"})

    @app.route("/api/video/frame")
    def video_frame():
        """Latest picture from the chosen camera input (used by the controller's live preview)."""
        if cv2 is None:
            return fail(CV_ERROR, 503)
        eng.touch_view()
        eng.ensure_running()
        t0 = time.time()
        while not eng.jpeg and time.time() - t0 < 6.0:        # a capture card can take a few seconds to open
            time.sleep(0.04)
        if not eng.jpeg:
            return fail("No picture yet", 503)
        resp = Response(eng.jpeg, mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.route("/api/tracker/stream")
    def tracker_stream():
        if cv2 is None:
            return fail(CV_ERROR, 503)
        eng.touch_view()
        eng.ensure_running()

        def gen():
            last, idle_since = -1, time.time()
            while True:
                eng.touch_view()
                jpg = eng.jpeg
                if eng.frame_id != last and jpg:
                    last, idle_since = eng.frame_id, time.time()
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                else:
                    if time.time() - idle_since > 60:
                        return
                    time.sleep(0.04)

        resp = Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    if eng.settings["autoStart"] and eng.settings["defaultPreset"] and cv2 is not None:
        def _auto():
            time.sleep(4)
            try:
                eng.select(eng.settings["defaultPreset"], move=True, reason="Auto-start")
                eng.arm(True)
            except Exception:
                pass
        threading.Thread(target=_auto, daemon=True).start()
    return eng
