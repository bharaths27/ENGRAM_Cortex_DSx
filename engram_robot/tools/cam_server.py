"""Serve a SECOND camera as JPEG frames, next to the robot server (which keeps the first one).

    python3 tools/cam_server.py --device /dev/video0          # http://<pi>:8201/frame
    v4l2-ctl --list-devices                                    # find the right /dev/videoN

Read-only: it never talks to the motor board. A USB camera can be open in only one program,
so give it the camera the robot server is NOT using.
"""
import argparse
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

latest = {"jpg": None, "t": 0.0}


def open_camera(device: str, width: int, height: int):
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))  # MJPG keeps two webcams within USB bandwidth
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened() or not cap.read()[0]:
        raise SystemExit(f"cannot read {device} (busy or not a camera?). Check `v4l2-ctl --list-devices`.")
    return cap


def grab(cap) -> None:
    while True:
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.2)
            continue
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
        if ok:
            latest["jpg"], latest["t"] = jpg.tobytes(), time.time()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        jpg = latest["jpg"]
        if not self.path.startswith("/frame") or jpg is None or time.time() - latest["t"] > 2:
            self.send_response(503 if self.path.startswith("/frame") else 404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(jpg)))
        self.end_headers()
        self.wfile.write(jpg)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", required=True, help="e.g. /dev/video0")
    ap.add_argument("--port", type=int, default=8201)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    args = ap.parse_args()
    cap = open_camera(args.device, args.width, args.height)
    threading.Thread(target=grab, args=(cap,), daemon=True).start()
    print(f"camera {args.device} open; serving http://0.0.0.0:{args.port}/frame", flush=True)
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
