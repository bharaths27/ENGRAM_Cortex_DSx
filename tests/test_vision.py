import pytest

from engram.vision.overhead import Debouncer, Detection, assign_zones

ZONES = {10: "home", 14: "bench"}


def test_object_goes_to_nearest_zone():
    dets = [Detection(10, 100, 100), Detection(14, 800, 100), Detection(2, 760, 140), Detection(1, 120, 90)]
    assert assign_zones(dets, ZONES) == {2: "bench", 1: "home"}


def test_far_object_is_not_guessed():
    assert assign_zones([Detection(14, 0, 0), Detection(2, 900, 900)], ZONES, max_px=250) == {}


def test_no_zone_tags_visible_means_no_report():
    assert assign_zones([Detection(2, 10, 10)], ZONES) == {}


def test_debounce_needs_steady_frames_and_reports_once():
    d = Debouncer(frames=3)
    assert d.update({2: "bench"}) == {}
    assert d.update({2: "bench"}) == {}
    assert d.update({2: "bench"}) == {2: "bench"}
    assert d.update({2: "bench"}) == {}
    assert d.update({2: "home"}) == {}  # one frame of a hand passing by


def test_detects_generated_tags():
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    from engram.vision.overhead import detect

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    canvas = np.full((600, 1000), 255, np.uint8)
    for tag, (x, y) in {10: (50, 50), 14: (700, 50), 2: (700, 300)}.items():
        canvas[y:y + 120, x:x + 120] = cv2.aruco.generateImageMarker(dictionary, tag, 120)
    dets = detect(canvas)
    assert sorted(d.tag_id for d in dets) == [2, 10, 14]
    assert assign_zones(dets, ZONES) == {2: "bench"}
