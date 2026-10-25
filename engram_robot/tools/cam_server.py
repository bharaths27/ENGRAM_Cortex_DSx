"""Serve a SECOND camera as JPEG frames, next to the robot server (which keeps the first one).

    python3 tools/cam_server.py --device /dev/video2          # http://<pi>:8201/stream (or /frame)
    v4l2-ctl --list-devices                                    # find the right /dev/videoN

Read-only: it never talks to the motor board. A USB camera can be open in only one program,
so give it the camera the robot server is NOT using.
"""
import argparse
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

latest = {"jpg": None, "t": 0.0}
fresh = threading.Condition()


def open_camera(device: str, width: int, height: int):
    # Some OpenCV builds cannot open V4L2 by path, only by number: /dev/video0 -> 0
    m = re.fullmatch(r"(?:/dev/video)?(\d+)", device)
    cap = cv2.VideoCapture(int(m.group(1)) if m else device, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))  # MJPG keeps two webcams within USB bandwidth
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened() or not cap.read()[0]:
        raise SystemExit(f"cannot read {device} (busy or not a camera?). Check `v4l2-ctl --list-devices`.")
    return cap


def grab(cap, quality: int) -> None:
    while True:
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.2)
            continue
        ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok:
            with fresh:
                latest["jpg"], latest["t"] = jpg.tobytes(), time.time()
                fresh.notify_all()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        live = latest["jpg"] is not None and time.time() - latest["t"] < 2
        if self.path.startswith("/stream") and live:
            return self.stream()
        if not self.path.startswith("/frame") or not live:
            self.send_response(503 if self.path.startswith(("/frame", "/stream")) else 404)
            self.end_headers()
            return
        jpg = latest["jpg"]
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(jpg)))
        self.end_headers()
        self.wfile.write(jpg)

    def stream(self):
        """MJPEG: one long response, a new JPEG part per camera frame. No round trip per frame."""
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                with fresh:
                    fresh.wait(timeout=2)
                    jpg = latest["jpg"]
                self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                 + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass  # viewer closed the page

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", required=True, help="e.g. /dev/video0")
    ap.add_argument("--port", type=int, default=8201)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--quality", type=int, default=45, help="JPEG quality; lower is faster over a hotspot")
    args = ap.parse_args()
    cap = open_camera(args.device, args.width, args.height)
    threading.Thread(target=grab, args=(cap, args.quality), daemon=True).start()
    print(f"camera {args.device} open; serving http://0.0.0.0:{args.port}/stream and /frame", flush=True)
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
