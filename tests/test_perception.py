"""Tests for the overhead tag reader and the voice client's reply handling.

Skipped if OpenCV is not installed (pip install -r perception/requirements.txt).
"""

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from perception.overhead_tags import DICT, Tracker, detect_tags, zone_for  # noqa: E402
from perception.voice import describe_reply  # noqa: E402

ZONES = {"shelf_A": [0, 0, 400, 300], "bench": [400, 0, 800, 300]}


def table_with_tags(positions):
    img = np.full((300, 800, 3), 235, np.uint8)
    d = cv2.aruco.getPredefinedDictionary(DICT)
    for tag, (x, y) in positions.items():
        m = cv2.copyMakeBorder(cv2.aruco.generateImageMarker(d, tag, 80), 12, 12, 12, 12,
                               cv2.BORDER_CONSTANT, value=255)
        img[y:y + m.shape[0], x:x + m.shape[1]] = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
    return img


def test_detects_tags_and_finds_their_zones():
    dets = detect_tags(table_with_tags({1: (100, 100), 3: (550, 100)}))
    found = {tag: zone_for(center, ZONES) for tag, center, _ in dets}
    assert found == {1: "shelf_A", 3: "bench"}


def test_point_outside_every_zone_has_no_zone():
    assert zone_for((900, 50), ZONES) is None


def test_tracker_waits_for_a_steady_tag_and_reports_moves_once():
    tr = Tracker(stable_frames=3, refresh_s=60)
    assert tr.update({1: "shelf_A"}, 0) == []
    assert tr.update({1: "shelf_A"}, 1) == []
    assert tr.update({1: "shelf_A"}, 2) == [(1, "shelf_A")]
    assert tr.update({1: "shelf_A"}, 3) == []          # no repeat while it sits still
    for t in (4, 5):
        assert tr.update({1: "bench"}, t) == []         # flicker is ignored
    assert tr.update({1: "bench"}, 6) == [(1, "bench")]
    assert tr.update({1: "bench"}, 70) == [(1, "bench")]  # periodic refresh keeps memory fresh


def test_reply_descriptions():
    screen, _ = describe_reply({"kind": "proposal", "status": "refused", "reason": "No."})
    assert screen.startswith("NOT PLANNED")
    screen, spoken = describe_reply({"kind": "proposal", "status": "proposed", "operation_id": "ep_1",
                                     "check": {"ok": True, "errors": []}, "source": "rules", "planner_calls": 1,
                                     "plan": {"steps": [{"op": "locate_tag", "args": {"object_id": "beaker"}},
                                                        {"op": "speak", "args": {"text": "hi"}}]}})
    assert "locate_tag(beaker)" in screen and "speak" not in screen and "approve" in spoken
