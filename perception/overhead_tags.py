"""Overhead camera tag reader (the "overhead ArUco reader" in the README).

A webcam looks down at the table. Each object carries a printed ArUco tag
(DICT_4X4_50, numbers in fixtures/lab/arena.json). This program finds the tags,
works out which zone each one is in, and reports it to the ENGRAM server with
POST /observations/tag. Memory then knows where things are, and how fresh that is.

It only reports what it sees. It never moves the robot.

Run from the repo root:

    # 1. Once per camera position: drag a box around each zone, press Enter after each
    python -m perception.overhead_tags calibrate

    # 2. While the demo runs (the ENGRAM server must be running)
    python -m perception.overhead_tags run

    # Check a single photo without the server (prints what it sees)
    python -m perception.overhead_tags image photo.jpg

Needs: pip install opencv-python numpy
On a Mac the first run asks for camera permission for Terminal (or VS Code).
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parent.parent
ARENA = REPO / "fixtures" / "lab" / "arena.json"
ZONES_FILE = Path(__file__).resolve().parent / "zones.json"
DICT = cv2.aruco.DICT_4X4_50


# ---------------------------------------------------------------------------
# Detection and zone lookup (plain functions, tested in tests/test_perception.py)
# ---------------------------------------------------------------------------
def make_detector() -> cv2.aruco.ArucoDetector:
    params = cv2.aruco.DetectorParameters()
    return cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICT), params)


def detect_tags(frame: np.ndarray, detector: cv2.aruco.ArucoDetector | None = None):
    """Return [(tag_id, (cx, cy), corners)] for every tag in the frame."""
    detector = detector or make_detector()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    corners, ids, _ = detector.detectMarkers(gray)
    out = []
    if ids is None:
        return out
    for c, tag_id in zip(corners, ids.flatten()):
        pts = c.reshape(4, 2)
        cx, cy = pts.mean(axis=0)
        out.append((int(tag_id), (float(cx), float(cy)), pts))
    return out


def zone_for(point: tuple[float, float], zones: dict[str, list[float]]) -> str | None:
    """Zones are rectangles [x1, y1, x2, y2] in image pixels. First match wins."""
    x, y = point
    for name, (x1, y1, x2, y2) in zones.items():
        if min(x1, x2) <= x <= max(x1, x2) and min(y1, y2) <= y <= max(y1, y2):
            return name
    return None


@dataclass
class Tracker:
    """Only report a tag once it has sat in the same zone for a few frames.

    That stops flicker (a tag on a zone edge, or a hand passing over) from
    filling memory with noise. A tag is also re-reported every `refresh_s`
    seconds while it stays put, so memory keeps treating its location as fresh.
    """

    stable_frames: int = 5
    refresh_s: float = 60.0
    _candidate: dict[int, tuple[str, int]] = field(default_factory=dict)
    _reported: dict[int, tuple[str, float]] = field(default_factory=dict)

    def update(self, seen: dict[int, str], now: float) -> list[tuple[int, str]]:
        to_report = []
        for tag_id, zone in seen.items():
            prev_zone, count = self._candidate.get(tag_id, (None, 0))
            count = count + 1 if zone == prev_zone else 1
            self._candidate[tag_id] = (zone, count)
            if count < self.stable_frames:
                continue
            last = self._reported.get(tag_id)
            if last is None or last[0] != zone or now - last[1] >= self.refresh_s:
                self._reported[tag_id] = (zone, now)
                to_report.append((tag_id, zone))
        for tag_id in list(self._candidate):
            if tag_id not in seen:  # out of view: start counting again when it returns
                del self._candidate[tag_id]
        return to_report


# ---------------------------------------------------------------------------
# Files, camera and server
# ---------------------------------------------------------------------------
def load_arena() -> dict:
    return json.loads(ARENA.read_text())


def load_zones(path: Path = ZONES_FILE) -> dict[str, list[float]]:
    if not path.exists():
        raise SystemExit(f"No zones file at {path}. Run: python -m perception.overhead_tags calibrate")
    return json.loads(path.read_text())["zones"]


def open_camera(index: int, width: int, height: int) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {index}. Try --camera 1, and check camera permission.")
    for _ in range(5):  # let exposure settle
        cap.read()
    return cap


def report(server: str, tag_id: int, zone: str) -> str | None:
    body = json.dumps({"tag_id": tag_id, "zone": zone}).encode()
    req = urllib.request.Request(server + "/observations/tag", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read()).get("object_id")


def draw(frame, zones, detections, names):
    for name, (x1, y1, x2, y2) in zones.items():
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (200, 160, 0), 2)
        cv2.putText(frame, name, (int(x1) + 4, int(y1) + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 160, 0), 2)
    for tag_id, (cx, cy), pts in detections:
        cv2.polylines(frame, [pts.astype(int)], True, (0, 200, 0), 2)
        label = names.get(tag_id, f"tag {tag_id}")
        cv2.putText(frame, label, (int(cx) - 30, int(cy) - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 0), 2)
    return frame


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_calibrate(args):
    arena = load_arena()
    cap = open_camera(args.camera, args.width, args.height)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("Camera returned no image.")
    zones = {}
    for name in arena["zones"]:
        title = f"Drag a box around '{name}', then press Enter (Esc or c to skip)"
        x, y, w, h = cv2.selectROI(title, frame, showCrosshair=False)
        cv2.destroyWindow(title)
        if w and h:
            zones[name] = [int(x), int(y), int(x + w), int(y + h)]
            cv2.rectangle(frame, (x, y), (x + w, y + h), (200, 160, 0), 2)
            cv2.putText(frame, name, (x + 4, y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 160, 0), 2)
            print(f"  {name}: {zones[name]}")
        else:
            print(f"  {name}: skipped")
    cv2.destroyAllWindows()
    h, w = frame.shape[:2]
    ZONES_FILE.write_text(json.dumps({"image_size": [w, h], "camera": args.camera, "zones": zones}, indent=2))
    cv2.imwrite(str(ZONES_FILE.with_suffix(".png")), frame)
    print(f"Saved {ZONES_FILE} (and a picture of the zones, zones.png)")


def cmd_image(args):
    zones = load_zones()
    names = {o["tag"]: o["name"] for o in load_arena()["objects"]}
    frame = cv2.imread(args.path)
    if frame is None:
        raise SystemExit(f"Could not read {args.path}")
    dets = detect_tags(frame)
    if not dets:
        print("No tags found.")
    for tag_id, center, _ in dets:
        print(f"  tag {tag_id} ({names.get(tag_id, 'unknown object')}) -> {zone_for(center, zones) or 'outside all zones'}")


def cmd_run(args):
    zones = load_zones()
    names = {o["tag"]: o["name"] for o in load_arena()["objects"]}
    detector = make_detector()
    tracker = Tracker(stable_frames=args.stable_frames, refresh_s=args.refresh)
    cap = open_camera(args.camera, args.width, args.height)
    print(f"Watching camera {args.camera}. Reporting to {args.server}. Press q in the window (or Ctrl+C) to stop.")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Camera returned no image; stopping.")
                break
            dets = detect_tags(frame, detector)
            seen = {}
            for tag_id, center, _ in dets:
                zone = zone_for(center, zones)
                if zone:
                    seen[tag_id] = zone
            for tag_id, zone in tracker.update(seen, time.time()):
                label = names.get(tag_id, f"unknown tag {tag_id}")
                try:
                    obj = report(args.server, tag_id, zone)
                    print(f"  {time.strftime('%H:%M:%S')}  {label} at {zone}" + ("" if obj else "  (server: no object has this tag)"))
                except (urllib.error.URLError, OSError) as e:
                    print(f"  could not reach the server ({e}); will retry")
                    tracker._reported.pop(tag_id, None)
            if not args.no_window:
                cv2.imshow("ENGRAM overhead camera", draw(frame, zones, dets, names))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        cv2.destroyAllWindows()


def main():
    ap = argparse.ArgumentParser(description="Overhead ArUco tag reader for ENGRAM Cortex")
    ap.add_argument("--camera", type=int, default=0, help="camera number (0 = first camera)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("calibrate", help="draw the zones on the camera image").set_defaults(func=cmd_calibrate)

    im = sub.add_parser("image", help="read tags from one photo (no server)")
    im.add_argument("path")
    im.set_defaults(func=cmd_image)

    run = sub.add_parser("run", help="watch the table and report to the server")
    run.add_argument("--server", default="http://localhost:8000")
    run.add_argument("--stable-frames", type=int, default=5, help="frames a tag must stay put before reporting")
    run.add_argument("--refresh", type=float, default=60.0, help="seconds between repeat reports of a tag that stays put")
    run.add_argument("--no-window", action="store_true", help="no preview window (for the Jetson without a screen)")
    run.set_defaults(func=cmd_run)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
