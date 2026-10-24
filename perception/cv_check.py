"""Quick camera check: does the computer vision work on this computer?

No server, no zones, no setup. Opens the webcam and draws what the code sees:
- every ArUco tag (DICT_4X4_50) with its object name from the arena file
- your hand and its gesture (open_palm, pointing, thumb), if mediapipe is installed,
  plus the pointing line and the tag it lands on

Run from the repo root:

    python -m perception.cv_check                 # live webcam
    python -m perception.cv_check --camera 1      # a different camera
    python -m perception.cv_check --no-hands      # tags only
    python -m perception.cv_check --tags-sheet    # write a printable sheet of tags 1-4

Keys in the window: q = quit, s = save a snapshot.
No tags printed yet? Open the tag sheet on your phone or iPad and hold it up to the camera.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

from .overhead_tags import ARENA, DICT, detect_tags, make_detector

HERE = Path(__file__).resolve().parent


def make_tags_sheet(path: Path) -> None:
    """Tags 1-4 with their object names, big enough to print one page or show on a phone."""
    arena = json.loads(ARENA.read_text())
    d = cv2.aruco.getPredefinedDictionary(DICT)
    tiles = []
    for o in sorted(arena["objects"], key=lambda o: o["tag"]):
        marker = cv2.aruco.generateImageMarker(d, o["tag"], 400)
        tile = np.full((560, 520), 255, np.uint8)
        tile[60:460, 60:460] = marker
        cv2.putText(tile, f"tag {o['tag']}: {o['name']}", (40, 520), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2)
        tiles.append(tile)
    while len(tiles) % 2:
        tiles.append(np.full_like(tiles[0], 255))
    rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]
    cv2.imwrite(str(path), np.vstack(rows))
    print(f"Saved {path}. Print it (keep the white border around each square) or open it on a phone.")


def annotate(frame, detector, hands_tracker, names):
    """Draw tags and hands on the frame. Returns a one-line summary."""
    from .gestures import hand_size, object_pointed_at, pointing_ray

    dets = detect_tags(frame, detector)
    for tag_id, (cx, cy), pts in dets:
        cv2.polylines(frame, [pts.astype(int)], True, (0, 200, 0), 3)
        cv2.putText(frame, f"{tag_id}: {names.get(tag_id, 'not in arena')}", (int(cx) - 60, int(cy) - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2)
    summary = [f"tags: {', '.join(names.get(t, str(t)) for t, _, _ in dets) or 'none'}"]
    if hands_tracker:
        centers = {t: c for t, c, _ in dets}
        hands = hands_tracker.hands(frame)
        for h in hands:
            color = {"open_palm": (60, 60, 230), "pointing": (0, 200, 255),
                     "thumb": (200, 120, 255)}.get(h.label, (180, 180, 180))
            for x, y in h.landmarks:
                cv2.circle(frame, (int(x), int(y)), 4, color, -1)
            wx, wy = h.landmarks[0]
            cv2.putText(frame, f"{h.label} ({h.builtin} {h.score:.2f})", (int(wx) - 60, int(wy) + 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            if h.label == "pointing":
                (x, y), (dx, dy) = pointing_ray(h.landmarks)
                cv2.line(frame, (int(x), int(y)), (int(x + dx * 2000), int(y + dy * 2000)), color, 2)
                target = object_pointed_at((x, y), (dx, dy), centers, touch_radius=0.6 * hand_size(h.landmarks))
                if target is not None:
                    tx, ty = centers[target]
                    cv2.circle(frame, (int(tx), int(ty)), 50, color, 4)
                    summary.append(f"pointing at {names.get(target, target)}")
        summary.append(f"hands: {', '.join(h.label for h in hands) or 'none'}")
    return "   ".join(summary)


def main():
    ap = argparse.ArgumentParser(description="Check that tag and hand detection work on this computer")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--no-hands", action="store_true", help="tags only (no mediapipe needed)")
    ap.add_argument("--image", help="check one photo instead of the webcam; saves an annotated copy")
    ap.add_argument("--tags-sheet", action="store_true", help="write aruco_tags.png (tags 1-4) and exit")
    args = ap.parse_args()

    if args.tags_sheet:
        make_tags_sheet(HERE / "aruco_tags.png")
        return

    names = {o["tag"]: o["name"] for o in json.loads(ARENA.read_text())["objects"]}
    detector = make_detector()
    hands_tracker = None
    if not args.no_hands:
        try:
            from .gestures import HandTracker
            hands_tracker = HandTracker()
        except SystemExit as e:
            print(f"{e}\nContinuing with tags only.")

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            raise SystemExit(f"Could not read {args.image}")
        print(annotate(frame, detector, hands_tracker, names))
        out = Path(args.image).with_name(Path(args.image).stem + "_checked.png")
        cv2.imwrite(str(out), frame)
        print(f"Saved {out}")
        return

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {args.camera}. Try --camera 1. On a Mac, allow camera access "
                         "for Terminal or VS Code in System Settings > Privacy & Security > Camera.")
    print("Camera open. Show a tag and your hand. q = quit, s = save a snapshot.")
    last_print, frames, t0 = "", 0, time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera returned no image.")
            break
        line = annotate(frame, detector, hands_tracker, names)
        frames += 1
        fps = frames / max(time.time() - t0, 1e-6)
        cv2.putText(frame, f"{fps:.0f} fps", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        if line != last_print:
            print(" ", line)
            last_print = line
        cv2.imshow("ENGRAM camera check (q to quit)", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord("s"):
            snap = HERE / f"snapshot_{time.strftime('%H%M%S')}.png"
            cv2.imwrite(str(snap), frame)
            print(f"  saved {snap}")
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
