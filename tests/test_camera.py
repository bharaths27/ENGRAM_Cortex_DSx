from fastapi.testclient import TestClient

from engram.api import create_app
from engram.camera import frame_hub

# A tiny valid JPEG header is enough; the server only passes bytes through.
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")


def test_frame_roundtrip_and_status(engine):
    frame_hub.reset()
    c = TestClient(create_app(engine))
    assert c.get("/camera/status").json() == {
        "online": False, "has_frame": False, "age_s": None, "bytes": 0, "seq": 0
    }
    assert c.get("/camera/snapshot").status_code == 404
    r = c.post("/camera/frame", content=JPEG, headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 200 and r.json()["bytes"] == len(JPEG)
    status = c.get("/camera/status").json()
    assert status["online"] and status["has_frame"] and status["seq"] == 1
    snap = c.get("/camera/snapshot")
    assert snap.status_code == 200 and snap.content == JPEG
    frame_hub.reset()


def test_empty_frame_rejected(engine):
    frame_hub.reset()
    c = TestClient(create_app(engine))
    assert c.post("/camera/frame", content=b"", headers={"Content-Type": "image/jpeg"}).status_code == 400
    frame_hub.reset()
