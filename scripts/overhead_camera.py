"""Watch the table with the overhead webcam and send tag positions to ENGRAM.

    python scripts/overhead_camera.py                  # camera 0, server on localhost
    python scripts/overhead_camera.py --camera 1 --show
    python scripts/overhead_camera.py --url http://192.168.1.20:8000
    python scripts/overhead_camera.py --show --gestures  # also hand gestures (needs mediapipe)

Frames are streamed to the ENGRAM server (/camera/frame) so the dashboard can show
the table live. Turn that off with --no-push.

Needs: pip install opencv-contrib-python
Start the server first (uvicorn --factory engram.api:create_app --port 8000).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engram.vision.overhead import Debouncer, assign_zones, detect  # noqa: E402


def post(url: str, body: dict) -> None:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=3).read()


def push_frame(url: str, frame, width: int, quality: int = 70) -> None:
    """Send one JPEG to the dashboard. Stays quiet if the server is busy or down."""
    import cv2

    h, w = frame.shape[:2]
    if width and w > width:
        frame = cv2.resize(frame, (width, int(h * width / w)))
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return
    try:
        req = urllib.request.Request(f"{url}/camera/frame", buf.tobytes(), {"Content-Type": "image/jpeg"})
        urllib.request.urlopen(req, timeout=2).read()
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--arena", default=str(ROOT / "fixtures/lab/arena.json"))
    ap.add_argument("--fps", type=float, default=None, help="frames per second (default 5, or 15 with --gestures)")
    ap.add_argument("--show", action="store_true", help="open a preview window")
    ap.add_argument("--no-push", action="store_true", help="do not stream frames to the dashboard")
    ap.add_argument("--push-fps", type=float, default=10.0, help="max frames per second sent to the dashboard")
    ap.add_argument("--push-width", type=int, default=960, help="downscale streamed frames to this width (0 keeps full size)")
    ap.add_argument("--gestures", action="store_true",
                    help="also watch hands: open palm = stop, point = select object, thumb out = propose return to rest")
    ap.add_argument("--no-palm-stop", action="store_true", help="with --gestures, show palms but don't send stop")
    ap.add_argument("--no-thumb-rest", action="store_true", help="with --gestures, show thumbs but don't propose")
    ap.add_argument("--point-goto", action="store_true",
                    help="with --gestures, pointing at a zone tag for 1 s proposes driving there (needs approval)")
    args = ap.parse_args()
    fps = args.fps or (15.0 if args.gestures else 5.0)

    import cv2

    arena = json.loads(Path(args.arena).read_text())
    zone_tags = {int(k): v for k, v in arena["zone_tags"].items()}
    names = {o["tag"]: o["name"] for o in arena["objects"]}
    gestures = None
    if args.gestures:
        from engram.vision.gestures import GestureActions
        gestures = GestureActions(args.url, arena, fps, palm_stop=not args.no_palm_stop,
                                  thumb_rest=not args.no_thumb_rest, point_goto=args.point_goto)
        print("gestures on: open palm = STOP, point = select object, thumb out = propose return to rest"
              + (", point at a zone tag = propose going there" if args.point_goto else ""))
    cam = cv2.VideoCapture(args.camera)
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cam.isOpened():
        print(f"could not open camera {args.camera}; try --camera 1")
        return 1
    push = not args.no_push
    push_interval = 1.0 / args.push_fps if args.push_fps > 0 else 0.0
    last_push = 0.0
    debounce = Debouncer()
    print("watching; press Ctrl+C to stop" + ("" if not push else "; streaming to the dashboard"))
    try:
        while True:
            ok, frame = cam.read()
            if not ok:
                time.sleep(0.2)
                continue
            if push and time.time() - last_push >= push_interval:
                last_push = time.time()
                push_frame(args.url, frame, args.push_width)
            dets = detect(frame)
            zones_now = assign_zones(dets, zone_tags)
            if gestures:
                gestures.update(frame, dets, zones_now)
            for tag, zone in debounce.update(zones_now).items():
                print(f"{names.get(tag, tag)} -> {zone}")
                try:
                    post(f"{args.url}/observations/tag", {"tag_id": tag, "zone": zone})
                except Exception as e:  # server down: keep watching, report again later
                    print(f"  could not reach server: {e}")
                    debounce._reported.pop(tag, None)
            if args.show:
                for d in dets:
                    label = zone_tags.get(d.tag_id) or names.get(d.tag_id, str(d.tag_id))
                    cv2.putText(frame, label, (int(d.cx), int(d.cy)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                if gestures:
                    gestures.draw(frame, dets)
                cv2.imshow("ENGRAM overhead", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            time.sleep(1.0 / fps)
    except KeyboardInterrupt:
        pass
    cam.release()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
