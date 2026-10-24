"""Overhead tag reader for the Logitech C920s (Carther ticket EC04).

No calibration needed. Each zone has its own printed tag (ids 10 to 14). An
object belongs to the zone whose tag is closest to it in the picture, as long
as it is within `max_px` pixels. An object must sit in the same zone for a few
frames in a row before we report it, so a hand passing by does not move it.

The camera only reports what it sees. It never moves the robot.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

DICTIONARY = "DICT_4X4_50"


@dataclass
class Detection:
    tag_id: int
    cx: float
    cy: float


def detect(frame: Any) -> list[Detection]:
    """Find every ArUco tag in a BGR or grayscale frame."""
    import cv2

    gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICTIONARY))
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _ = detector.detectMarkers(gray)
    if ids is None:
        return []
    out = []
    for c, i in zip(corners, ids.flatten()):
        pts = c.reshape(-1, 2)
        out.append(Detection(int(i), float(pts[:, 0].mean()), float(pts[:, 1].mean())))
    return out


def assign_zones(detections: list[Detection], zone_tags: dict[int, str],
                 max_px: float = 250.0) -> dict[int, str]:
    """Map each object tag id to the nearest visible zone tag."""
    zones = [d for d in detections if d.tag_id in zone_tags]
    out: dict[int, str] = {}
    for d in detections:
        if d.tag_id in zone_tags or not zones:
            continue
        best = min(zones, key=lambda z: math.hypot(z.cx - d.cx, z.cy - d.cy))
        if math.hypot(best.cx - d.cx, best.cy - d.cy) <= max_px:
            out[d.tag_id] = zone_tags[best.tag_id]
    return out


@dataclass
class Debouncer:
    """Only report a zone once it has been seen `frames` times in a row."""

    frames: int = 3
    _streak: dict[int, tuple[str, int]] = field(default_factory=dict)
    _reported: dict[int, str] = field(default_factory=dict)

    def update(self, seen: dict[int, str]) -> dict[int, str]:
        changed: dict[int, str] = {}
        for tag, zone in seen.items():
            last_zone, n = self._streak.get(tag, (zone, 0))
            n = n + 1 if last_zone == zone else 1
            self._streak[tag] = (zone, n)
            if n >= self.frames and self._reported.get(tag) != zone:
                self._reported[tag] = zone
                changed[tag] = zone
        return changed
