import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import robot_skill  # noqa: E402
from robot_agent.agent import RobotAgent, make_handler  # noqa: E402
from robot_agent.driver import FakeDriver  # noqa: E402


def serve(driver):
    a = RobotAgent(driver, {})
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(a))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return a, server, f"http://127.0.0.1:{server.server_address[1]}"


def test_record_then_replay(tmp_path, monkeypatch):
    monkeypatch.setattr(robot_skill, "SKILLS", tmp_path)
    a, server, url = serve(FakeDriver())
    lines = iter(["forward 0.2", "jump", "forward 9", "pick", "turn 90", "place", "save"])
    monkeypatch.setattr("builtins.input", lambda _: next(lines))
    assert robot_skill.record(url, "demo") == 0
    steps = json.loads((tmp_path / "demo.json").read_text())["steps"]
    assert steps == [["forward", "0.2"], ["pick"], ["turn", "90"], ["place"]]  # bad and refused steps left out
    a.driver.calls.clear()
    assert robot_skill.replay(url, "demo", dry=False) == 0
    assert a.driver.calls[0] == ("drive", 0.2) and ("gripper", False) in a.driver.calls
    server.shutdown()


def test_replay_stops_robot_on_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(robot_skill, "SKILLS", tmp_path)
    (tmp_path / "bad.json").write_text(json.dumps({"steps": [["place"], ["forward", "0.1"]]}))
    a, server, url = serve(FakeDriver())
    assert robot_skill.replay(url, "bad", dry=False) == 1  # place with nothing held fails
    assert a.stopped and ("drive", 0.1) not in a.driver.calls
    server.shutdown()


def test_example_skill_is_valid():
    steps = json.loads((robot_skill.SKILLS / "fetch_ahead.json").read_text())["steps"]
    assert all(robot_skill.parse(" ".join(s)) for s in steps)
