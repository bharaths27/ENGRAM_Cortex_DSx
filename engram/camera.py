"""In-memory hub for the overhead camera's latest frame (Carther ticket EC04).

The overhead script (scripts/overhead_camera.py) POSTs JPEG frames to
/camera/frame. The dashboard shows them from /camera/stream (MJPEG, for an
<img>) or /camera/snapshot (one JPEG). This only passes pictures through so the
iPad can watch the table over the network; it never moves the robot.
"""

from __future__ import annotations

import threading
import time


class FrameHub:
    def __init__(self, stale_after_s: float = 5.0):
        self._lock = threading.Lock()
        self._jpeg: bytes | None = None
        self._seq = 0
        self._at = 0.0
        self.stale_after_s = stale_after_s

    def put(self, jpeg: bytes) -> int:
        with self._lock:
            self._jpeg = jpeg
            self._seq += 1
            self._at = time.time()
            return self._seq

    def latest(self) -> tuple[bytes | None, int, float]:
        with self._lock:
            return self._jpeg, self._seq, self._at

    def status(self) -> dict:
        jpeg, seq, at = self.latest()
        age = (time.time() - at) if at else None
        return {
            "online": bool(jpeg) and age is not None and age <= self.stale_after_s,
            "has_frame": bool(jpeg),
            "age_s": round(age, 3) if age is not None else None,
            "bytes": len(jpeg) if jpeg else 0,
            "seq": seq,
        }

    def reset(self) -> None:
        with self._lock:
            self._jpeg = None
            self._seq = 0
            self._at = 0.0


frame_hub = FrameHub()
