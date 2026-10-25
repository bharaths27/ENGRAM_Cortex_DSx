#!/usr/bin/env bash
# One command for the C920: its video (port 8201) and its mic driving the robot by voice (status on 8202).
# Ctrl C stops both. Extra arguments go to voice.listen, for example:
#
#     bash tools/c920_live.sh --dry-run        # mic test, robot never moves
#     bash tools/c920_live.sh                  # voice drives the robot
#
# Video is compressed MJPG at 640x360, 15 fps, so the C920's mic keeps enough USB bandwidth on the
# same cable. Override with C920_VIDEO=/dev/videoN, C920_SIZE=WxH, C920_FPS=N.
set -u
cd "$(dirname "$0")/.."

[ -f robot.env ] && { set -a; . ./robot.env; set +a; }

VIDEO="${C920_VIDEO:-/dev/video2}"
SIZE="${C920_SIZE:-640x360}"
FPS="${C920_FPS:-15}"

python3 tools/cam_server.py --device "$VIDEO" --width "${SIZE%x*}" --height "${SIZE#*x}" --fps "$FPS" &
CAM=$!
trap 'kill $CAM 2>/dev/null; wait $CAM 2>/dev/null; echo "C920 video stopped."' EXIT

sleep 2
if ! kill -0 "$CAM" 2>/dev/null; then
    echo "C920 video did not start (see the message above). Voice will run without it."
fi

python3 -m voice.listen --mic "${ENGRAM_MIC:-plughw:CARD=C920,DEV=0}" "$@"
