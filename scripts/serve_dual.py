"""Run the brain API on IPv6 and IPv4 at once (uvicorn --host :: is IPv6 only on the Pi).

    python scripts/serve_dual.py --port 8001

Phone hotspots often give the Mac only IPv6, while an iPad may come in over IPv4.
"""

import argparse
import socket
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so engram imports from the repo


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8001)
    a = ap.parse_args()
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", a.port))
    uvicorn.run("engram.api:create_app", factory=True, fd=sock.fileno(), log_level="info")


if __name__ == "__main__":
    main()
