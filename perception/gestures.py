"""Hand gestures from the overhead camera, as extra context for ENGRAM.

Adapted from the hand-tracking ideas in the class studio notebook (MediaPipe hand
landmarks, pointing angle, a hold-for-N-frames filter), rewritten in Python for the robot.

Three gestures. None of them moves the robot by itself:

    open palm, held  -> asks the server to STOP (the one command that is always safe)
    pointing         -> works out which tagged object the finger points at, so
                        "bring me that one" can name it, and the robot gets a
                        fresh sighting of that object right away
    thumb out, held  -> PROPOSES "return to rest" (drive to home). Like every plan,
                        it only runs after a person approves it

Used by `python -m perception.overhead_tags run --gestures` (same camera, same frame).
The functions below are plain math on hand landmarks so they can be tested without a camera.

Hand landmarks (MediaPipe numbering, image coordinates 0..1):
    0 wrist   4 thumb tip   5 index base   6 index middle joint   8 index tip
    9 middle base   12 middle tip   16 ring tip   20 pinky tip
"""

from __future__ import annotations

import json
import math
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
             "gesture_recognizer/float16/1/gesture_recognizer.task")
MODEL_PATH = Path(__file__).resolve().parent / "models" / "gesture_recognizer.task"
POINTING_FILE = Path(tempfile.gettempdir()) / "engram_pointing.json"

Point = tuple[float, float]


# ---------------------------------------------------------------------------
# Geometry on landmarks
# ---------------------------------------------------------------------------
def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def hand_size(lm: list[Point]) -> float:
    """Wrist to middle-finger base. Every distance is divided by this, so near and far hands look alike."""
    return max(_dist(lm[0], lm[9]), 1e-6)


def finger_reach(lm: list[Point], tip: int) -> float:
    """How far a fingertip is from the wrist, in hand sizes. About 1 = curled, about 2 = straight."""
    return _dist(lm[tip], lm[0]) / hand_size(lm)


def is_open_palm(lm: list[Point]) -> bool:
    """All four fingers stretched out."""
    return all(finger_reach(lm, t) > 1.6 for t in (8, 12, 16, 20))


def is_pointing(lm: list[Point]) -> bool:
    """Index finger straight, the other three curled. Works in any direction, not just up."""
    index_out = finger_reach(lm, 8) > 1.6 and _dist(lm[8], lm[0]) > _dist(lm[6], lm[0])
    others_in = all(finger_reach(lm, t) < 1.3 for t in (12, 16, 20))
    return index_out and others_in


def is_thumb_out(lm: list[Point]) -> bool:
    """A fist with the thumb sticking out (a thumbs-up turned in any direction).

    Seen from the overhead camera the thumb points along the table, so any direction counts.
    """
    fingers_in = all(finger_reach(lm, t) < 1.3 for t in (8, 12, 16, 20))
    thumb_out = _dist(lm[4], lm[9]) / hand_size(lm) > 0.9
    return fingers_in and thumb_out


def classify(lm: list[Point], builtin: str = "", builtin_score: float = 0.0) -> str:
    """'open_palm', 'pointing', 'thumb', or 'other'. MediaPipe's own label is used when it is confident."""
    if builtin == "Open_Palm" and builtin_score >= 0.6:
        return "open_palm"
    if builtin == "Pointing_Up" and builtin_score >= 0.6:
        return "pointing"
    if builtin in ("Thumb_Up", "Thumb_Down") and builtin_score >= 0.6:
        return "thumb"
    if is_pointing(lm):
        return "pointing"
    if is_thumb_out(lm):
        return "thumb"
    if is_open_palm(lm):
        return "open_palm"
    return "other"


def pointing_ray(lm: list[Point]) -> tuple[Point, Point]:
    """(fingertip, unit direction) of the line from the index base through the index tip."""
    dx, dy = lm[8][0] - lm[5][0], lm[8][1] - lm[5][1]
    n = math.hypot(dx, dy) or 1e-6
    return lm[8], (dx / n, dy / n)


def object_pointed_at(tip: Point, direction: Point, objects: dict[int, Point],
                      max_angle_deg: float = 15.0, touch_radius: float = 0.0) -> int | None:
    """Which tag is the finger pointing at?

    objects: tag_id -> tag centre, in the same units as tip (pixels).
    A tag counts if it lies ahead of the fingertip within `max_angle_deg` of the pointing
    line, or within `touch_radius` of the fingertip. Among those, the one closest to the
    line wins (ties go to the nearer one).
    """
    best, best_key = None, None
    for tag_id, c in objects.items():
        vx, vy = c[0] - tip[0], c[1] - tip[1]
        d = math.hypot(vx, vy)
        if d <= touch_radius:
            key = (0.0, d)
        else:
            along = vx * direction[0] + vy * direction[1]
            if along <= 0:
                continue  # behind the finger
            angle = math.degrees(math.acos(max(-1.0, min(1.0, along / d))))
            if angle > max_angle_deg:
                continue
            key = (abs(vx * direction[1] - vy * direction[0]), d)  # distance from the line, then distance
        if best_key is None or key < best_key:
            best, best_key = tag_id, key
    return best


# ---------------------------------------------------------------------------
# Hold-for-N-frames filter
# ---------------------------------------------------------------------------
@dataclass
class HoldFilter:
    """A value only counts once it has been the same for `frames` frames in a row.

    Same idea as the studio notebook's STABLE_FRAMES. `changed` is True on the frame a
    new value becomes stable, so actions fire once per gesture, not every frame.
    """

    frames: int = 8
    _cand: object = None
    _count: int = 0
    stable: object = None

    def update(self, value) -> tuple[object, bool]:
        if value == self._cand:
            self._count += 1
        else:
            self._cand, self._count = value, 1
        changed = False
        if self._count >= self.frames and self._cand != self.stable:
            self.stable, changed = self._cand, True
        return self.stable, changed


# ---------------------------------------------------------------------------
# Sharing "what is being pointed at" with the voice client
# ---------------------------------------------------------------------------
def save_pointing(object_id: str, name: str, tag_id: int, zone: str | None, path: Path = POINTING_FILE) -> None:
    path.write_text(json.dumps({"object_id": object_id, "name": name, "tag_id": tag_id,
                                "zone": zone, "at": time.time()}))


def recent_pointing(max_age_s: float = 8.0, path: Path = POINTING_FILE) -> dict | None:
    """The last pointed-at object, if it was pointed at within the last few seconds."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if time.time() - data.get("at", 0) <= max_age_s else None


# ---------------------------------------------------------------------------
# MediaPipe wrapper
# ---------------------------------------------------------------------------
def ensure_model(path: Path = MODEL_PATH) -> Path:
    """Download MediaPipe's hand gesture model once (about 8 MB). After that it works offline."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading the hand gesture model to {path} (once)...")
        urllib.request.urlretrieve(MODEL_URL, path)
    return path


@dataclass
class Hand:
    landmarks: list[Point]   # pixels
    label: str               # 'open_palm', 'pointing', 'other'
    builtin: str             # MediaPipe's own gesture name
    score: float


class HandTracker:
    def __init__(self, max_hands: int = 2):
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except ImportError:
            raise SystemExit("mediapipe is not installed: pip install mediapipe")
        self._mp = mp
        options = vision.GestureRecognizerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model())),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=max_hands,
        )
        self._rec = vision.GestureRecognizer.create_from_options(options)
        self._last_ms = 0

    def hands(self, frame_bgr) -> list[Hand]:
        import cv2

        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        ms = max(int(time.monotonic() * 1000), self._last_ms + 1)  # must always increase
        self._last_ms = ms
        result = self._rec.recognize_for_video(image, ms)
        out = []
        for i, lms in enumerate(result.hand_landmarks or []):
            pts = [(p.x * w, p.y * h) for p in lms]
            g = result.gestures[i][0] if result.gestures and result.gestures[i] else None
            name, score = (g.category_name, g.score) if g else ("None", 0.0)
            out.append(Hand(pts, classify(pts, name, score), name, score))
        return out
