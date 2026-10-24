"""Tests for gesture geometry and the 'that one' fill-in. No camera or MediaPipe needed."""

from perception.gestures import (
    HoldFilter, classify, object_pointed_at, pointing_ray, recent_pointing, save_pointing,
)
from perception.voice import fill_pointing

NAMES = ["Sample A", "Sample B", "Safety goggles", "Beaker"]


def hand(tips):
    """A made-up right hand in pixels: wrist at (100, 300), hand pointing up the image."""
    lm = [(100.0, 250.0)] * 21
    lm[0], lm[9], lm[5], lm[6] = (100, 300), (100, 200), (120, 210), (125, 160)
    for k, v in tips.items():
        lm[k] = v
    return lm


POINT = hand({8: (130, 100), 12: (100, 215), 16: (85, 225), 20: (70, 235)})
PALM = hand({8: (130, 100), 12: (100, 95), 16: (70, 100), 20: (45, 115)})
FIST = hand({8: (115, 220), 12: (100, 215), 16: (85, 225), 20: (70, 235)})


def test_classify_shapes():
    assert classify(POINT) == "pointing"
    assert classify(PALM) == "open_palm"
    assert classify(FIST) == "other"


def test_confident_builtin_label_wins():
    assert classify(FIST, "Open_Palm", 0.9) == "open_palm"
    assert classify(FIST, "Open_Palm", 0.3) == "other"


def test_pointing_picks_the_object_on_the_line():
    tip, d = pointing_ray(POINT)
    objects = {1: (150, -100), 3: (400, 100), 4: (140, -300)}
    assert object_pointed_at(tip, d, objects) == 1          # closest to the line
    assert object_pointed_at(tip, d, {3: (400, 100)}) is None  # far off to the side
    assert object_pointed_at(tip, (0, 1), {1: (150, -100)}) is None  # behind the finger


def test_touching_an_object_selects_it():
    tip, d = pointing_ray(POINT)
    assert object_pointed_at(tip, d, {2: (tip[0] + 5, tip[1] + 30)}, touch_radius=60) == 2


def test_hold_filter_fires_once_per_new_value():
    f = HoldFilter(3)
    fired = [f.update(v)[1] for v in [True, True, True, True, False, False, False, True]]
    assert fired == [False, False, True, False, False, False, True, False]


def test_fill_in_that_one():
    p = {"name": "Beaker"}
    assert fill_pointing("Bring me that one", p, NAMES) == "Bring me the Beaker"
    assert fill_pointing("Put this on shelf B", p, NAMES) == "Put the Beaker on shelf B"
    assert fill_pointing("Bring me Sample A", p, NAMES) == "Bring me Sample A"      # already named
    assert fill_pointing("Remember that goggles come first", p, NAMES).startswith("Remember that")
    assert fill_pointing("Bring me that one", None, NAMES) == "Bring me that one"   # nobody pointed


def test_pointing_note_expires(tmp_path):
    path = tmp_path / "p.json"
    save_pointing("beaker", "Beaker", 4, "shelf_B", path)
    assert recent_pointing(8, path)["object_id"] == "beaker"
    assert recent_pointing(-1, path) is None
